import { Router } from "express";
import { prisma } from "../config/database.js";
import { jwtAuth } from "../middleware/auth.js";
import { encrypt, decrypt } from "../services/crypto.service.js";
import { executeWrite } from "../services/connection.service.js";
import { broadcast } from "../ws.js";
import { getLogBuffer } from "../logger.js";

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
  broadcast("refresh", { resource: "project" });
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
  try {
    const { name, type, connectionString } = req.body;
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
    const conn = await prisma.projectConnection.create({
      data: { projectId: proj.id, name, type, connectionString: encrypt(connectionString) },
    });
    res.status(201).json({ id: conn.id, name: conn.name, type: conn.type, isActive: conn.isActive });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
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
    select: { id: true, type: true, title: true, content: true, tags: true, importance: true, accessCount: true, epistemicStatus: true, createdAt: true },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
  });
  res.json(memories);
});

apiRoutes.post("/projects/:slug/memories", async (req, res) => {
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
  const { type, title, content, tags, importance } = req.body;
  const memory = await prisma.memory.create({ data: { projectId: proj.id, type, title, content, tags: tags ?? [], importance: importance ?? 3 } });
  broadcast("refresh", { resource: "memory", projectSlug: req.params.slug });
  res.status(201).json(memory);
});

apiRoutes.delete("/memories/:id", async (req, res) => {
  await prisma.memory.delete({ where: { id: req.params.id } });
  broadcast("refresh", { resource: "memory" });
  res.json({ ok: true });
});

// ── Brain Graph ───────────────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/brain-graph", async (req, res) => {
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

  const [memories, links] = await Promise.all([
    prisma.memory.findMany({
      where: { projectId: proj.id },
      select: { id: true, title: true, type: true, importance: true, accessCount: true, isPinned: true, content: true },
      orderBy: [{ importance: "desc" }],
    }),
    prisma.memoryLink.findMany({
      where: { from: { projectId: proj.id } },
      select: { fromId: true, toId: true, relation: true },
    }),
  ]);

  res.json({ nodes: memories, edges: links });
});

// ── Brain Stats ───────────────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/brain-stats", async (req, res) => {
  const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
  if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

  const [total, pinned, byType, topAccessed, pinnedMemories, brainMemories, linksCount, recentLinks, embRow, epistemicDist] = await Promise.all([
    prisma.memory.count({ where: { projectId: proj.id } }),
    prisma.memory.count({ where: { projectId: proj.id, isPinned: true } }),
    prisma.memory.groupBy({ by: ["type"], where: { projectId: proj.id }, _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
    prisma.memory.findMany({
      where: { projectId: proj.id },
      orderBy: [{ accessCount: "desc" }],
      take: 7,
      select: { id: true, title: true, type: true, importance: true, accessCount: true, epistemicStatus: true },
    }),
    prisma.memory.findMany({
      where: { projectId: proj.id, isPinned: true },
      include: {
        links:    { select: { id: true } },
        linkedBy: { select: { id: true } },
      },
      take: 10,
    }),
    prisma.memory.findMany({
      where: { projectId: proj.id, type: "BRAIN" },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, title: true, content: true, importance: true, createdAt: true, epistemicStatus: true },
    }),
    prisma.memoryLink.count({ where: { from: { projectId: proj.id } } }),
    prisma.memoryLink.findMany({
      where: { from: { projectId: proj.id } },
      include: { from: { select: { title: true, type: true } }, to: { select: { title: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM memories WHERE project_id = ${proj.id} AND embedding IS NOT NULL
    `,
    prisma.memory.groupBy({
      by: ["epistemicStatus"],
      where: { projectId: proj.id },
      _count: { id: true },
    }),
  ]);

  res.json({
    total,
    pinned,
    withEmbedding: Number((embRow as any)[0]?.count ?? 0),
    links: linksCount,
    byType: byType.map(t => ({ type: t.type, count: t._count.id })),
    epistemicDist: epistemicDist.map(e => ({ status: e.epistemicStatus, count: e._count.id })),
    topAccessed,
    pinnedMemories: pinnedMemories.map(m => ({
      id: m.id, title: m.title, type: m.type, importance: m.importance, content: m.content,
      linkCount: m.links.length + m.linkedBy.length,
      epistemicStatus: m.epistemicStatus,
    })),
    brainMemories,
    recentLinks: recentLinks.map(l => ({
      id: l.id,
      fromId: l.fromId,
      toId: l.toId,
      fromTitle: l.from.title,
      fromType: l.from.type,
      toTitle: l.to.title,
      toType: l.to.type,
      relation: l.relation,
      weight: l.weight,
    })),
  });
});

// ── Memory Links ─────────────────────────────────────────────────────────────
apiRoutes.post("/projects/:slug/memories/link", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
    const { fromId, toId, relation } = req.body as { fromId: string; toId: string; relation: string };
    if (!fromId || !toId || !relation) {
      res.status(400).json({ error: "fromId, toId e relation são obrigatórios" }); return;
    }
    if (fromId === toId) {
      res.status(400).json({ error: "Uma memória não pode se conectar a si mesma" }); return;
    }
    const [from, to] = await Promise.all([
      prisma.memory.findFirst({ where: { id: fromId, projectId: proj.id } }),
      prisma.memory.findFirst({ where: { id: toId,   projectId: proj.id } }),
    ]);
    if (!from || !to) { res.status(404).json({ error: "Memória não encontrada neste projeto" }); return; }
    const link = await prisma.memoryLink.upsert({
      where: { fromId_toId_relation: { fromId, toId, relation: relation as never } },
      create: { fromId, toId, relation: relation as never },
      update: {},
    });
    broadcast("refresh", { resource: "memory_link" });
    res.status(201).json(link);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

apiRoutes.delete("/memories/links/:id", async (req, res) => {
  try {
    await prisma.memoryLink.delete({ where: { id: req.params.id } });
    broadcast("refresh", { resource: "memory_link" });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Link não encontrado" });
  }
});

// ── Jobs assíncronos ─────────────────────────────────────────────────────────
apiRoutes.get("/jobs/:id", async (req, res) => {
  try {
    const { getJobStatus } = await import("../services/queue.service.js");
    const status = await getJobStatus(req.params.id);
    if (!status) { res.status(404).json({ error: "Job não encontrado" }); return; }
    res.json(status);
  } catch {
    res.status(500).json({ error: "Queue não disponível" });
  }
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
  broadcast("refresh", { resource: "task" });
  res.json(task);
});

apiRoutes.delete("/tasks/:id", async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } });
  broadcast("refresh", { resource: "task" });
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
    broadcast("refresh", { resource: "write_request" });
    res.json({ ok: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.writeRequest.update({
      where: { id: wr.id },
      data: { status: "REJECTED", result: `Erro na execução: ${msg}`, resolvedAt: new Date() },
    });
    broadcast("refresh", { resource: "write_request" });
    res.status(500).json({ error: msg });
  }
});

apiRoutes.patch("/write-requests/:id/reject", async (req, res) => {
  const { reason } = req.body as { reason?: string };
  await prisma.writeRequest.update({
    where: { id: req.params.id },
    data: { status: "REJECTED", result: reason ?? "Rejeitado pelo administrador", resolvedAt: new Date() },
  });
  broadcast("refresh", { resource: "write_request" });
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
apiRoutes.get("/stats", async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalProjects,
    totalMemories,
    totalTasks,
    totalAuditLogs,
    logsToday,
    memoriesByType,
    tasksByStatus,
    tasksByPriority,
    topTools,
    mostAccessed,
    activityByDay,
    searchCount,
  ] = await Promise.all([
    prisma.project.count(),
    prisma.memory.count(),
    prisma.task.count(),
    prisma.auditLog.count(),
    prisma.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.memory.groupBy({ by: ["type"], _count: { id: true } }),
    prisma.task.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.task.groupBy({ by: ["priority"], _count: { id: true } }),
    prisma.auditLog.groupBy({ by: ["tool"], _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 8 }),
    prisma.memory.findMany({
      where: { accessCount: { gt: 0 } },
      orderBy: { accessCount: "desc" },
      take: 5,
      select: {
        id: true, title: true, type: true, accessCount: true,
        project: { select: { name: true, color: true } },
      },
    }),
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*) AS count
      FROM audit_logs
      WHERE created_at > NOW() - INTERVAL '14 days'
      GROUP BY day ORDER BY day ASC
    `,
    prisma.auditLog.count({ where: { tool: "memory_search" } }),
  ]);

  const estimatedTokens = totalMemories * 150 + searchCount * 15;
  const estimatedCostUSD = Math.round((estimatedTokens / 1_000_000) * 0.02 * 100000) / 100000;

  res.json({
    totals: { projects: totalProjects, memories: totalMemories, tasks: totalTasks, auditLogs: totalAuditLogs, logsToday },
    memoriesByType:  memoriesByType.map(m => ({ type: m.type, count: m._count.id })),
    tasksByStatus:   tasksByStatus.map(t => ({ status: t.status, count: t._count.id })),
    tasksByPriority: tasksByPriority.map(t => ({ priority: t.priority, count: t._count.id })),
    topTools:        topTools.map(t => ({ tool: t.tool, count: t._count.id })),
    mostAccessed,
    activityByDay:   activityByDay.map(a => ({ day: a.day.toISOString().split("T")[0], count: Number(a.count) })),
    embeddings: { estimatedTokens, estimatedCostUSD, searchCount, memoriesWithEmbeddings: totalMemories },
  });
});

// ── External Services ─────────────────────────────────────────────────────────
apiRoutes.get("/external-services", async (_req, res) => {
  const services = await prisma.externalService.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, displayName: true, apiUrl: true, adminEmail: true, isActive: true, createdAt: true },
  });
  res.json(services);
});

apiRoutes.post("/external-services", async (req, res) => {
  const { name, displayName, apiUrl, adminEmail, adminPassword } = req.body;
  const svc = await prisma.externalService.create({
    data: { name, displayName, apiUrl, adminEmail, adminPassword: encrypt(adminPassword) },
    select: { id: true, name: true, displayName: true, apiUrl: true, adminEmail: true, isActive: true, createdAt: true },
  });
  res.status(201).json(svc);
});

apiRoutes.patch("/external-services/:id", async (req, res) => {
  const { name, displayName, apiUrl, adminEmail, adminPassword, isActive } = req.body;
  const data: Record<string, unknown> = { name, displayName, apiUrl, adminEmail, isActive };
  if (adminPassword) data.adminPassword = encrypt(adminPassword);
  const svc = await prisma.externalService.update({
    where: { id: req.params.id },
    data,
    select: { id: true, name: true, displayName: true, apiUrl: true, adminEmail: true, isActive: true, createdAt: true },
  });
  res.json(svc);
});

apiRoutes.delete("/external-services/:id", async (req, res) => {
  await prisma.externalService.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

apiRoutes.post("/external-services/:id/test", async (req, res) => {
  const svc = await prisma.externalService.findUnique({ where: { id: req.params.id } });
  if (!svc) { res.status(404).json({ error: "Não encontrado" }); return; }
  try {
    const password = decrypt(svc.adminPassword);
    const r = await fetch(`${svc.apiUrl}/api/platform-admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: svc.adminEmail, password }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) { res.status(400).json({ ok: false, error: `Login retornou HTTP ${r.status}` }); return; }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Server Logs ───────────────────────────────────────────────────────────────
apiRoutes.get("/server-logs", (req, res) => {
  const { level, limit = "300" } = req.query as { level?: string; limit?: string };
  let logs = getLogBuffer();
  if (level && level !== "all") logs = logs.filter(l => l.level === level);
  res.json(logs.slice(-Number(limit)));
});

// ── Busca global ─────────────────────────────────────────────────────────────
apiRoutes.get("/search", async (req, res) => {
  const { q } = req.query as { q?: string };
  if (!q || q.trim().length < 2) { res.json({ memories: [] }); return; }
  const memories = await prisma.memory.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
      ],
    },
    include: { project: { select: { name: true, slug: true, color: true } } },
    orderBy: [{ importance: "desc" }, { accessCount: "desc" }],
    take: 40,
  });
  res.json({ memories });
});

// ── Audit Log ─────────────────────────────────────────────────────────────────
apiRoutes.get("/audit-logs", async (req, res) => {
  const { projectSlug, limit = "200" } = req.query as { projectSlug?: string; limit?: string };
  let projectId: string | undefined;
  if (projectSlug) {
    const proj = await prisma.project.findUnique({ where: { slug: projectSlug } });
    projectId = proj?.id;
  }
  const take = Math.min(Math.max(1, Number(limit) || 200), 500);
  const logs = await prisma.auditLog.findMany({
    where: projectId ? { projectId } : {},
    include: { project: { select: { name: true, slug: true, color: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
  res.json(logs);
});
