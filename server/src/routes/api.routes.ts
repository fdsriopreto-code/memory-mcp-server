import { Router } from "express";
import { prisma } from "../config/database.js";
import { jwtAuth } from "../middleware/auth.js";
import { encrypt } from "../services/crypto.service.js";
import { executeWrite } from "../services/connection.service.js";

export const apiRoutes = Router();
apiRoutes.use(jwtAuth);

// ── Projetos ──────────────────────────────────────────────────────────────────
apiRoutes.get("/projects", async (_req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { memories: true, tasks: true, writeRequests: true } },
    },
  });
  res.json(projects);
});

apiRoutes.post("/projects", async (req, res) => {
  const { name, slug, description, color } = req.body;
  const project = await prisma.project.create({ data: { name, slug, description, color } });
  res.status(201).json(project);
});

apiRoutes.get("/projects/:slug", async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { slug: req.params.slug },
    include: {
      connections: { select: { id: true, name: true, type: true, isActive: true, createdAt: true } },
      _count: { select: { memories: true, tasks: true } },
    },
  });
  if (!project) { res.status(404).json({ error: "Não encontrado" }); return; }
  res.json(project);
});

// ── Conexões ──────────────────────────────────────────────────────────────────
apiRoutes.post("/projects/:slug/connections", async (req, res) => {
  const { name, type, connectionString } = req.body;
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
  const conn = await prisma.projectConnection.create({
    data: { projectId: proj.id, name, type, connectionString: encrypt(connectionString) },
  });
  res.status(201).json({ id: conn.id, name: conn.name, type: conn.type, isActive: conn.isActive });
});

apiRoutes.delete("/connections/:id", async (req, res) => {
  await prisma.projectConnection.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Memórias ──────────────────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/memories", async (req, res) => {
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
  const memories = await prisma.memory.findMany({
    where: { projectId: proj.id },
    select: { id: true, type: true, title: true, content: true, tags: true, importance: true, accessCount: true, createdAt: true },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
  });
  res.json(memories);
});

apiRoutes.post("/projects/:slug/memories", async (req, res) => {
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
  const { type, title, content, tags, importance } = req.body;
  const memory = await prisma.memory.create({ data: { projectId: proj.id, type, title, content, tags: tags ?? [], importance: importance ?? 3 } });
  res.status(201).json(memory);
});

apiRoutes.delete("/memories/:id", async (req, res) => {
  await prisma.memory.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/tasks", async (req, res) => {
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
  const tasks = await prisma.task.findMany({
    where: { projectId: proj.id },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
  res.json(tasks);
});

apiRoutes.patch("/tasks/:id", async (req, res) => {
  const { status, title, description, priority } = req.body;
  const task = await prisma.task.update({ where: { id: req.params.id }, data: { status, title, description, priority } });
  res.json(task);
});

apiRoutes.delete("/tasks/:id", async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── Write Requests ────────────────────────────────────────────────────────────
apiRoutes.get("/write-requests", async (req, res) => {
  const { status } = req.query as { status?: string };
  const requests = await prisma.writeRequest.findMany({
    where: status ? { status: status as "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" } : {},
    include: { project: { select: { name: true, slug: true } }, connection: { select: { name: true, type: true } } },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });
  res.json(requests);
});

apiRoutes.patch("/write-requests/:id/approve", async (req, res) => {
  const wr = await prisma.writeRequest.findUnique({
    where: { id: req.params.id },
    include: { connection: true },
  });
  if (!wr) { res.status(404).json({ error: "Não encontrada" }); return; }
  if (wr.status !== "PENDING") { res.status(400).json({ error: "Apenas requests PENDING podem ser aprovados" }); return; }

  await prisma.writeRequest.update({ where: { id: wr.id }, data: { status: "APPROVED" } });

  try {
    const result = await executeWrite(wr.connection.connectionString, wr.sql);
    await prisma.writeRequest.update({
      where: { id: wr.id },
      data: { status: "EXECUTED", result: JSON.stringify(result), resolvedAt: new Date() },
    });
    res.json({ ok: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.writeRequest.update({
      where: { id: wr.id },
      data: { status: "REJECTED", result: `Erro na execução: ${msg}`, resolvedAt: new Date() },
    });
    res.status(500).json({ error: msg });
  }
});

apiRoutes.patch("/write-requests/:id/reject", async (req, res) => {
  const { reason } = req.body as { reason?: string };
  await prisma.writeRequest.update({
    where: { id: req.params.id },
    data: { status: "REJECTED", result: reason ?? "Rejeitado pelo administrador", resolvedAt: new Date() },
  });
  res.json({ ok: true });
});

// ── Audit Log ─────────────────────────────────────────────────────────────────
apiRoutes.get("/audit-logs", async (req, res) => {
  const { projectSlug } = req.query as { projectSlug?: string };
  let projectId: string | undefined;
  if (projectSlug) {
    const proj = await prisma.project.findUnique({ where: { slug: projectSlug } });
    projectId = proj?.id;
  }
  const logs = await prisma.auditLog.findMany({
    where: projectId ? { projectId } : {},
    include: { project: { select: { name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(logs);
});
