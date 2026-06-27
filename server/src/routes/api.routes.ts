import { Router } from "express";
import { prisma } from "../config/database.js";
import { jwtAuth } from "../middleware/auth.js";
import { encrypt, decrypt } from "../services/crypto.service.js";
import { executeWrite } from "../services/connection.service.js";
import { broadcast } from "../ws.js";
import { getComputerAgents, sendToComputer } from "../ws.js";
import { getLogBuffer } from "../logger.js";
import { readdirSync, statSync } from "fs";
import { join, extname, relative } from "path";

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

apiRoutes.patch("/memories/:id", async (req, res) => {
  try {
    const { title, content, importance, epistemicStatus, isPinned } = req.body as {
      title?: string; content?: string; importance?: number;
      epistemicStatus?: string; isPinned?: boolean;
    };
    const memory = await prisma.memory.update({
      where: { id: req.params.id },
      data: {
        ...(title      !== undefined && { title }),
        ...(content    !== undefined && { content }),
        ...(importance !== undefined && { importance }),
        ...(epistemicStatus !== undefined && { epistemicStatus: epistemicStatus as never }),
        ...(isPinned   !== undefined && { isPinned }),
      },
    });
    broadcast("refresh", { resource: "memory" });
    res.json(memory);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.get("/memories/:id/versions", async (req, res) => {
  try {
    const versions = await prisma.$queryRaw<{id:string;content:string;title:string;importance:number;changed_at:Date;change_reason:string|null}[]>`
      SELECT id, content, title, importance, changed_at, change_reason
      FROM memory_versions
      WHERE memory_id = ${req.params.id}
      ORDER BY changed_at DESC
      LIMIT 20
    `;
    res.json(versions);
  } catch {
    res.json([]);
  }
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
apiRoutes.get("/jobs", async (_req, res) => {
  try {
    const { brainQueue } = await import("../services/queue.service.js");
    if (!brainQueue) { res.json([]); return; }
    const [active, waiting, completed, failed] = await Promise.all([
      brainQueue.getJobs(["active"],    0, 20),
      brainQueue.getJobs(["waiting"],   0, 20),
      brainQueue.getJobs(["completed"], 0, 10),
      brainQueue.getJobs(["failed"],    0, 10),
    ]);
    const all = [...active, ...waiting, ...completed, ...failed];
    const result = await Promise.all(all.map(async j => ({
      id: j.id,
      type: j.name,
      data: j.data,
      state: await j.getState(),
      progress: typeof j.progress === "number" ? j.progress : 0,
      result: j.returnvalue,
      error: j.failedReason,
      createdAt: new Date(j.timestamp).toISOString(),
    })));
    res.json(result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  } catch { res.json([]); }
});

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

// ── Brain Chat (agêntico) ─────────────────────────────────────────────────────
apiRoutes.post("/projects/:slug/brain/chat", async (req, res) => {
  try {
    const { query, history = [], attachments = [] } = req.body as {
      query: string;
      history?: { role: "user"|"assistant"; content: string }[];
      attachments?: { type: "image"; mimeType: string; data: string }[];
    };
    if (!query?.trim()) { res.status(400).json({ error: "Query obrigatória" }); return; }

    const { agentChat } = await import("../services/agentic-chat.service.js");
    const slug = req.params.slug;

    // "__free__" slug = chat livre sem projeto (sem RAG, mas com ferramentas)
    if (slug === "__free__") {
      const result = await agentChat("", "__free__", query.trim(), history, attachments);
      res.json(result); return;
    }

    const proj = await prisma.project.findUnique({ where: { slug } });
    if (!proj) { res.status(404).json({ error: "Projeto não encontrado" }); return; }
    const result = await agentChat(proj.id, proj.slug, query.trim(), history, attachments);
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ── TTS — OpenAI Text-to-Speech ───────────────────────────────────────────────
apiRoutes.post("/tts", async (req, res) => {
  try {
    const { text, voice = "nova" } = req.body as { text: string; voice?: string };
    if (!text?.trim()) { res.status(400).json({ error: "text obrigatório" }); return; }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY não configurada" }); return; }
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey });
    const audio  = await openai.audio.speech.create({
      model: "tts-1",
      input: text.slice(0, 4096),
      voice: voice as "nova" | "alloy" | "echo" | "fable" | "onyx" | "shimmer",
      response_format: "mp3",
    });
    const buffer = Buffer.from(await audio.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, max-age=600");
    res.end(buffer);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── System Keys ───────────────────────────────────────────────────────────────
apiRoutes.get("/system/keys", async (_req, res) => {
  const key = process.env.MCP_API_KEY ?? "";
  const masked = key ? key.slice(0, 6) + "••••••••••••••••" + key.slice(-4) : "";
  const tavilySet = !!(process.env.TAVILY_API_KEY ||
    await (prisma as any).aIConfig.findUnique({ where: { role: "search" } }).catch(() => null));
  res.json({ mcpKeyMasked: masked, tavilySet });
});

apiRoutes.post("/system/reveal-mcp-key", async (_req, res) => {
  const key = process.env.MCP_API_KEY ?? "";
  if (!key) { res.status(404).json({ error: "MCP_API_KEY não configurada" }); return; }
  res.json({ key });
});

apiRoutes.post("/system/renew-mcp-key", async (_req, res) => {
  try {
    const { randomBytes } = await import("node:crypto");
    const newKey = randomBytes(32).toString("hex");
    process.env.MCP_API_KEY = newKey;
    // Persist to /data/.secrets if possible (EasyPanel volume)
    try {
      const { writeFileSync, readFileSync } = await import("node:fs");
      const secretsPath = "/data/.secrets";
      let content = "";
      try { content = readFileSync(secretsPath, "utf8"); } catch {}
      const lines = content.split("\n").filter(l => !l.startsWith("MCP_API_KEY="));
      lines.push(`MCP_API_KEY=${newKey}`);
      writeFileSync(secretsPath, lines.join("\n") + "\n", "utf8");
    } catch { /* sem volume /data, persiste só em memória */ }
    res.json({ key: newKey, message: "Chave renovada. Copie agora — não será exibida novamente." });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── System Health ─────────────────────────────────────────────────────────────
apiRoutes.get("/system/health", async (_req, res) => {
  try {
    const { openAiBreaker } = await import("../services/circuit-breaker.service.js");
    const { brainQueue } = await import("../services/queue.service.js");

    // Redis ping
    let redisStatus = "unavailable";
    try {
      const IORedis = (await import("ioredis")).default;
      if (process.env.REDIS_URL) {
        const r = new IORedis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
        await r.connect();
        await r.ping();
        await r.quit();
        redisStatus = "connected";
      }
    } catch { redisStatus = "error"; }

    // Queue counts
    let queueCounts = { active: 0, waiting: 0, completed: 0, failed: 0 };
    if (brainQueue) {
      const counts = await brainQueue.getJobCounts("active", "waiting", "completed", "failed");
      queueCounts = {
        active: counts.active ?? 0,
        waiting: counts.waiting ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      };
    }

    // Token costs today
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const costRow = await prisma.$queryRaw<[{total_cost: number|null; total_tokens: number|null}]>`
      SELECT SUM(estimated_cost_usd) as total_cost, SUM(prompt_tokens + completion_tokens) as total_tokens
      FROM audit_logs WHERE created_at >= ${todayStart}
    `;

    res.json({
      circuitBreaker: openAiBreaker.status,
      redis: redisStatus,
      queue: queueCounts,
      tokensToday: Number(costRow[0]?.total_tokens ?? 0),
      costTodayUsd: Number(costRow[0]?.total_cost ?? 0),
      uptime: Math.floor(process.uptime()),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
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

// ── Memory Anchors ────────────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/anchors", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
    const anchors = await (prisma as any).memoryAnchor.findMany({
      where: { projectId: proj.id },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });
    res.json(anchors);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.post("/projects/:slug/anchors", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
    const { name, description, pattern, patternType, memoryIds, priority } = req.body;
    const anchor = await (prisma as any).memoryAnchor.create({
      data: { projectId: proj.id, name, description, pattern, patternType: patternType ?? "KEYWORD", memoryIds: memoryIds ?? [], priority: priority ?? 3 },
    });
    broadcast("refresh", { resource: "anchor", projectSlug: req.params.slug });
    res.status(201).json(anchor);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.patch("/anchors/:id", async (req, res) => {
  try {
    const { name, description, pattern, patternType, memoryIds, priority, isActive } = req.body;
    const anchor = await (prisma as any).memoryAnchor.update({
      where: { id: req.params.id },
      data: {
        ...(name        !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(pattern     !== undefined && { pattern }),
        ...(patternType !== undefined && { patternType }),
        ...(memoryIds   !== undefined && { memoryIds }),
        ...(priority    !== undefined && { priority }),
        ...(isActive    !== undefined && { isActive }),
      },
    });
    broadcast("refresh", { resource: "anchor" });
    res.json(anchor);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.delete("/anchors/:id", async (req, res) => {
  try {
    await (prisma as any).memoryAnchor.delete({ where: { id: req.params.id } });
    broadcast("refresh", { resource: "anchor" });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Brain Timeline ─────────────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/timeline", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

    const days = Math.min(Math.max(1, Number(req.query.days) || 90), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Criações por dia
    const createdByDay = await prisma.$queryRaw<{ day: Date; type: string; count: bigint }[]>`
      SELECT DATE_TRUNC('day', created_at) AS day, type::text, COUNT(*) AS count
      FROM memories
      WHERE project_id = ${proj.id} AND created_at >= ${since}
      GROUP BY day, type
      ORDER BY day ASC
    `;

    // Total histórico de memórias criadas por semana (para linha de crescimento)
    const growthByWeek = await prisma.$queryRaw<{ week: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('week', created_at) AS week, COUNT(*) AS count
      FROM memories
      WHERE project_id = ${proj.id}
      GROUP BY week
      ORDER BY week ASC
    `;

    // Marcos importantes: memórias com importância 5 no período
    const milestones = await prisma.memory.findMany({
      where: { projectId: proj.id, importance: 5, createdAt: { gte: since } },
      select: { id: true, title: true, type: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Atividade de acesso por dia (acesso = uso)
    const accessByDay = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', accessed_at) AS day, COUNT(*) AS count
      FROM memory_access_logs
      WHERE project_id = ${proj.id} AND accessed_at >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `;

    // Totais gerais
    const [totalNow, totalThen] = await Promise.all([
      prisma.memory.count({ where: { projectId: proj.id } }),
      prisma.memory.count({ where: { projectId: proj.id, createdAt: { lt: since } } }),
    ]);

    res.json({
      project: { name: proj.name, slug: proj.slug, color: proj.color },
      period: { days, since: since.toISOString() },
      totals: { now: totalNow, atStart: totalThen, created: totalNow - totalThen },
      createdByDay: createdByDay.map(r => ({
        day: r.day.toISOString().split("T")[0],
        type: r.type,
        count: Number(r.count),
      })),
      growthByWeek: growthByWeek.map(r => ({
        week: r.week.toISOString().split("T")[0],
        count: Number(r.count),
      })),
      milestones: milestones.map(m => ({
        id: m.id,
        title: m.title,
        type: m.type,
        date: m.createdAt.toISOString().split("T")[0],
      })),
      accessByDay: accessByDay.map(r => ({
        day: r.day.toISOString().split("T")[0],
        count: Number(r.count),
      })),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
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

// ── Memory Atlas (2D Semantic Map) ───────────────────────────────────────────
apiRoutes.get("/projects/:slug/atlas", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

    // Buscar memórias com embeddings (top 150 por importância)
    const rows = await prisma.$queryRaw<{
      id: string; title: string; type: string; importance: number;
      tags: string[]; is_pinned: boolean; emb_text: string;
    }[]>`
      SELECT id, title, type::text, importance, tags, is_pinned,
             embedding::text AS emb_text
      FROM memories
      WHERE project_id = ${proj.id} AND embedding IS NOT NULL
      ORDER BY importance DESC, created_at DESC
      LIMIT 150
    `;

    if (rows.length < 3) {
      res.json({ nodes: [], message: "Memórias insuficientes para gerar o atlas (mínimo 3 com embeddings)." });
      return;
    }

    // Parsear embeddings
    const embeddings = rows.map(r => JSON.parse(r.emb_text) as number[]);
    const n = embeddings.length;

    // Projeção 2D: usa os dois eixos com maior variância (aprox PCA via power iteration)
    // Abordagem rápida: projeção em 2 direções ortogonais fixas baseadas nos dados
    const dim = embeddings[0].length;

    // Vetor 1: diferença entre a memória mais importante e a menos importante
    const v1 = new Array(dim).fill(0).map((_, d) => embeddings[0][d] - embeddings[n - 1][d]);
    const norm1 = Math.sqrt(v1.reduce((s, x) => s + x * x, 0)) + 1e-10;
    v1.forEach((_, i) => { v1[i] /= norm1; });

    // Vetor 2: diferença entre memória do meio e a média dos extremos — ortogonalizar em relação a v1
    const mid = Math.floor(n / 2);
    const v2raw = new Array(dim).fill(0).map((_, d) => embeddings[mid][d] - (embeddings[0][d] + embeddings[n - 1][d]) / 2);
    const dot12 = v2raw.reduce((s, x, i) => s + x * v1[i], 0);
    const v2 = v2raw.map((x, i) => x - dot12 * v1[i]);
    const norm2 = Math.sqrt(v2.reduce((s, x) => s + x * x, 0)) + 1e-10;
    v2.forEach((_, i) => { v2[i] /= norm2; });

    // Projetar todos os embeddings
    const rawPositions = embeddings.map(emb => ({
      x: emb.reduce((s, v, i) => s + v * v1[i], 0),
      y: emb.reduce((s, v, i) => s + v * v2[i], 0),
    }));

    // Normalizar para [-1, 1]
    const xs = rawPositions.map(p => p.x);
    const ys = rawPositions.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xRange = xMax - xMin + 1e-10;
    const yRange = yMax - yMin + 1e-10;

    const nodes = rows.map((r, i) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      importance: r.importance,
      tags: r.tags,
      isPinned: r.is_pinned,
      x: (rawPositions[i].x - xMin) / xRange * 2 - 1,
      y: (rawPositions[i].y - yMin) / yRange * 2 - 1,
    }));

    res.json({ nodes, total: n, project: { name: proj.name, color: proj.color } });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Brain Heatmap (GitHub-style activity calendar) ────────────────────────────
apiRoutes.get("/projects/:slug/heatmap", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

    const weeks = Math.min(Math.max(1, Number(req.query.weeks) || 52), 104);
    const since = new Date(Date.now() - weeks * 7 * 86_400_000);

    const [created, accessed, modified] = await Promise.all([
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*) AS count
        FROM memories WHERE project_id = ${proj.id} AND created_at >= ${since}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT TO_CHAR(DATE_TRUNC('day', accessed_at), 'YYYY-MM-DD') AS day, COUNT(*) AS count
        FROM memory_access_logs WHERE project_id = ${proj.id} AND accessed_at >= ${since}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT TO_CHAR(DATE_TRUNC('day', updated_at), 'YYYY-MM-DD') AS day, COUNT(*) AS count
        FROM memories WHERE project_id = ${proj.id} AND updated_at >= ${since} AND updated_at != created_at
        GROUP BY day ORDER BY day
      `,
    ]);

    // Montar mapa de atividade por dia
    const activityMap = new Map<string, { created: number; accessed: number; modified: number }>();
    const addToMap = (rows: { day: string; count: bigint }[], field: "created" | "accessed" | "modified") => {
      rows.forEach(r => {
        if (!activityMap.has(r.day)) activityMap.set(r.day, { created: 0, accessed: 0, modified: 0 });
        activityMap.get(r.day)![field] = Number(r.count);
      });
    };
    addToMap(created, "created");
    addToMap(accessed, "accessed");
    addToMap(modified, "modified");

    // Gerar todas as semanas (array de dias)
    const allDays: { date: string; level: number; created: number; accessed: number; modified: number }[] = [];
    const now = new Date();
    for (let d = 0; d < weeks * 7; d++) {
      const date = new Date(now.getTime() - (weeks * 7 - 1 - d) * 86_400_000);
      const dateStr = date.toISOString().split("T")[0];
      const act = activityMap.get(dateStr) ?? { created: 0, accessed: 0, modified: 0 };
      const total = act.created * 3 + act.accessed + act.modified * 2;
      const level = total === 0 ? 0 : total < 3 ? 1 : total < 8 ? 2 : total < 15 ? 3 : 4;
      allDays.push({ date: dateStr, level, ...act });
    }

    const maxActivity = Math.max(...allDays.map(d => d.created * 3 + d.accessed + d.modified * 2), 1);

    res.json({
      days: allDays,
      weeks,
      maxActivity,
      totals: {
        created: created.reduce((s, r) => s + Number(r.count), 0),
        accessed: accessed.reduce((s, r) => s + Number(r.count), 0),
        modified: modified.reduce((s, r) => s + Number(r.count), 0),
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Knowledge Debt (cobertura de conhecimento por arquivo) ───────────────────
apiRoutes.get("/projects/:slug/knowledge-debt", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

    const repoPath = req.query.repoPath as string;
    if (!repoPath) { res.status(400).json({ error: "repoPath é obrigatório" }); return; }

    // Listar arquivos de código recursivamente
    const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".cs", ".rb"]);
    const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".cache", "coverage"]);

    function listFiles(dir: string, base = dir): string[] {
      try {
        return readdirSync(dir).flatMap(entry => {
          if (IGNORE_DIRS.has(entry)) return [];
          const full = join(dir, entry);
          try {
            if (statSync(full).isDirectory()) return listFiles(full, base);
            if (CODE_EXTS.has(extname(entry))) return [relative(base, full).replace(/\\/g, "/")];
          } catch {}
          return [];
        });
      } catch { return []; }
    }

    const files = listFiles(repoPath).slice(0, 500);
    if (files.length === 0) {
      res.status(400).json({ error: `Nenhum arquivo de código encontrado em: ${repoPath}` });
      return;
    }

    // Buscar todas as memórias do projeto
    const memories = await prisma.memory.findMany({
      where: { projectId: proj.id },
      select: { id: true, title: true, content: true, tags: true, type: true },
    });

    const allText = memories.map(m =>
      `${m.title} ${m.content} ${m.tags.join(" ")}`.toLowerCase()
    ).join("\n");

    // Verificar cobertura: arquivo é "coberto" se seu nome aparece em alguma memória
    const covered: string[] = [];
    const uncovered: string[] = [];

    for (const file of files) {
      const fileName = file.split("/").pop()!.replace(/\.(ts|tsx|js|jsx|py|go)$/, "").toLowerCase();
      const moduleParts = file.toLowerCase().split("/").slice(-3);

      const isCovered = moduleParts.some(part =>
        part.length > 3 && allText.includes(part.replace(/\.(ts|tsx|js|jsx)$/, ""))
      ) || allText.includes(fileName);

      if (isCovered) covered.push(file);
      else uncovered.push(file);
    }

    const coverage = Math.round((covered.length / files.length) * 100);

    // Agrupar uncovered por diretório
    const uncoveredByDir = uncovered.reduce((acc, f) => {
      const dir = f.split("/").slice(0, -1).join("/") || ".";
      if (!acc[dir]) acc[dir] = [];
      acc[dir].push(f);
      return acc;
    }, {} as Record<string, string[]>);

    res.json({
      coverage,
      totalFiles: files.length,
      coveredFiles: covered.length,
      uncoveredFiles: uncovered.length,
      uncoveredByDir,
      coveredSample: covered.slice(0, 30),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Memory Conflicts (contradições e duplicatas) ──────────────────────────────
apiRoutes.get("/projects/:slug/conflicts", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

    // Conflitos explícitos (links CONTRADICTS)
    const explicitConflicts = await prisma.memoryLink.findMany({
      where: { from: { projectId: proj.id }, relation: "CONTRADICTS" },
      include: {
        from: { select: { id: true, title: true, type: true, content: true, importance: true, createdAt: true } },
        to:   { select: { id: true, title: true, type: true, content: true, importance: true, createdAt: true } },
      },
    });

    // Duplicatas semânticas (cosine similarity > 0.92) via pgvector
    const duplicates = await prisma.$queryRaw<{
      id1: string; title1: string; type1: string;
      id2: string; title2: string; type2: string;
      similarity: number;
    }[]>`
      SELECT a.id AS id1, a.title AS title1, a.type::text AS type1,
             b.id AS id2, b.title AS title2, b.type::text AS type2,
             1 - (a.embedding <=> b.embedding) AS similarity
      FROM memories a
      JOIN memories b ON b.project_id = a.project_id AND b.id > a.id
      WHERE a.project_id = ${proj.id}
        AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
        AND 1 - (a.embedding <=> b.embedding) > 0.92
      ORDER BY similarity DESC
      LIMIT 20
    `;

    res.json({
      explicit: explicitConflicts.map(l => ({
        type: "CONTRADICTS",
        from: l.from,
        to: l.to,
      })),
      duplicates: duplicates.map(d => ({
        type: "DUPLICATE",
        similarity: d.similarity,
        from: { id: d.id1, title: d.title1, type: d.type1 },
        to:   { id: d.id2, title: d.title2, type: d.type2 },
      })),
      total: explicitConflicts.length + duplicates.length,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Computer Agents ────────────────────────────────────────────────────────────
apiRoutes.get("/computer-agents", (_req, res) => {
  const agents = getComputerAgents();
  res.json({ agents, total: agents.length });
});

// POST /api/computer-exec — chamado pelo terminal remoto no frontend
apiRoutes.post("/computer-exec", async (req, res) => {
  try {
    const { command, workdir, agent_id } = req.body as { command: string; workdir?: string; agent_id?: string };
    if (!command) { res.status(400).json({ error: "command obrigatório" }); return; }

    const agents = getComputerAgents();
    if (!agents.length) { res.status(503).json({ error: "Nenhum computador conectado" }); return; }

    const targetId = agent_id ?? agents[0].agentId;
    const result = await sendToComputer(targetId, command, workdir);
    res.json({ output: result.output, exitCode: result.exitCode, agentId: targetId });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Brain Digest & Pulse ──────────────────────────────────────────────────────
apiRoutes.get("/projects/:slug/digest/latest", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
    const digest = await (prisma as any).brainDigest.findFirst({
      where: { projectId: proj.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(digest ?? null);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.get("/projects/:slug/digest/history", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
    const digests = await (prisma as any).brainDigest.findMany({
      where: { projectId: proj.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, period: true, type: true, healthScore: true, memoriesIn: true, newSyntheses: true, createdAt: true, summary: true },
    });
    res.json(digests);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.get("/projects/:slug/pulse", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }

    const day7  = new Date(Date.now() - 7  * 86_400_000);
    const day30 = new Date(Date.now() - 30 * 86_400_000);

    const [hotRows, totalMems, synthMems, recentMems] = await Promise.all([
      prisma.$queryRaw<{ memory_id: string; cnt: bigint }[]>`
        SELECT memory_id, COUNT(*) AS cnt FROM memory_access_logs
        WHERE project_id = ${proj.id} AND accessed_at >= ${day7}
        GROUP BY memory_id ORDER BY cnt DESC LIMIT 8
      `,
      prisma.memory.count({ where: { projectId: proj.id } }),
      prisma.memory.count({ where: { projectId: proj.id, type: "SYNTHESIS" as never } }),
      prisma.memory.count({ where: { projectId: proj.id, createdAt: { gte: day7 } } }),
    ]);

    const hotIds  = hotRows.map(r => r.memory_id);
    const hotMems = hotIds.length
      ? await prisma.memory.findMany({
          where: { id: { in: hotIds } },
          select: { id: true, title: true, type: true, importance: true, tags: true },
        })
      : [];

    const coldMems = await prisma.memory.findMany({
      where: {
        projectId: proj.id, importance: { gte: 3 },
        OR: [{ accessedAt: null }, { accessedAt: { lt: day30 } }],
        type: { not: "SYNTHESIS" as never },
      },
      select: { id: true, title: true, type: true, importance: true },
      take: 8,
    });

    const [validated, deprecated] = await Promise.all([
      prisma.memory.count({ where: { projectId: proj.id, epistemicStatus: "VALIDATED" as never } }),
      prisma.memory.count({ where: { projectId: proj.id, epistemicStatus: "DEPRECATED" as never } }),
    ]);

    const withEmb = await prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*) AS c FROM memories WHERE project_id = ${proj.id} AND embedding IS NOT NULL
    `;
    const embCount = Number((withEmb as any)[0]?.c ?? 0);
    const healthScore = totalMems === 0 ? 0 : Math.max(0, Math.min(100, Math.round(
      (validated / totalMems) * 35 +
      (1 - deprecated / totalMems) * 20 +
      (embCount / totalMems) * 25 +
      Math.min(20, hotMems.length * 2.5) -
      Math.min(15, coldMems.length)
    )));

    res.json({
      healthScore,
      total: totalMems,
      syntheses: synthMems,
      recentWeek: recentMems,
      validated,
      deprecated,
      withEmbedding: embCount,
      hot: hotMems.map((m, i) => ({ ...m, accessCount: Number(hotRows[i]?.cnt ?? 0) })),
      cold: coldMems,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.post("/projects/:slug/synthesize", async (req, res) => {
  try {
    const proj = await prisma.project.findUnique({ where: { slug: req.params.slug } });
    if (!proj) { res.status(404).json({ error: "Não encontrado" }); return; }
    res.json({ ok: true, message: "Síntese iniciada em background" });
    const { triggerSynthesis } = await import("../workers/synthesis.scheduler.js");
    triggerSynthesis(proj.id).catch(e => console.error("[synthesis] trigger falhou:", e));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── AI Config (chaves e modelos por role) ─────────────────────────────────────
apiRoutes.get("/ai-config", async (_req, res) => {
  try {
    const configs = await (prisma as any).aIConfig.findMany({ orderBy: { role: "asc" } });
    res.json(configs.map((c: any) => ({ ...c, apiKey: c.apiKey ? "***" : "" })));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.put("/ai-config/:role", async (req, res) => {
  try {
    const { provider, model, apiKey, isActive } = req.body as {
      provider: string; model: string; apiKey?: string; isActive?: boolean;
    };
    const data: Record<string, unknown> = { provider, model, isActive: isActive ?? true };
    if (apiKey && apiKey !== "***") data.apiKey = encrypt(apiKey);
    const cfg = await (prisma as any).aIConfig.upsert({
      where: { role: req.params.role },
      create: { role: req.params.role, provider, model, apiKey: encrypt(apiKey ?? "") },
      update: data,
    });
    res.json({ ...cfg, apiKey: "***" });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.delete("/ai-config/:role", async (req, res) => {
  try {
    await (prisma as any).aIConfig.delete({ where: { role: req.params.role } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Config não encontrada" });
  }
});

// ── Quick Capture (captura rápida de ideia/URL/código) ───────────────────────
apiRoutes.post("/quick-capture", async (req, res) => {
  try {
    const { text, projectSlug, fetchUrl } = req.body as { text: string; projectSlug?: string; fetchUrl?: boolean };
    if (!text?.trim()) { res.status(400).json({ error: "text obrigatório" }); return; }

    let content = text.trim();
    let title = text.slice(0, 80).trim();
    let detectedType: string = "NOTE";
    let fetchedUrl: string | null = null;

    // Detecta URL e faz fetch
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch && fetchUrl !== false) {
      fetchedUrl = urlMatch[0];
      try {
        const r = await fetch(fetchedUrl, {
          headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000)
        });
        if (r.ok) {
          const html = await r.text();
          const clean = html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s{3,}/g,"\n").trim().slice(0,6000);
          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          title = titleMatch ? titleMatch[1].trim().slice(0,80) : fetchedUrl.slice(0,80);
          content = `URL: ${fetchedUrl}\n\n${clean}`;
          detectedType = "CONTEXT";
        }
      } catch { /* continua com texto original */ }
    }

    // Detecta código
    if (/```[\s\S]+```/.test(text) || /^(import|export|function|const|class|def |public |private )/m.test(text)) {
      detectedType = "PATTERN";
    }

    // Usa IA para classificar e extrair título se a entrada for longa
    let aiTitle = title; let aiType = detectedType;
    if (content.length > 200) {
      try {
        const openaiKey = process.env.OPENAI_API_KEY;
        if (openaiKey) {
          const OpenAI = (await import("openai")).default;
          const openai = new OpenAI({ apiKey: openaiKey });
          const r = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: `Dado este texto, responda em JSON com: {"title":"título curto (máx 70 chars)","type":"DECISION|CONTEXT|PATTERN|NOTE|ARCHITECTURE|BRAIN","tags":["tag1","tag2"]}\n\nTexto: ${content.slice(0,1500)}` }],
            max_tokens: 150, temperature: 0.3, response_format: { type: "json_object" },
          });
          const parsed = JSON.parse(r.choices[0].message.content ?? "{}");
          if (parsed.title) aiTitle = parsed.title;
          if (parsed.type && ["DECISION","CONTEXT","PATTERN","NOTE","ARCHITECTURE","BRAIN"].includes(parsed.type)) aiType = parsed.type;
        }
      } catch { /* usa valores padrão */ }
    }

    // Resolve projeto
    let projectId: string | null = null;
    if (projectSlug) {
      const proj = await prisma.project.findUnique({ where: { slug: projectSlug } });
      projectId = proj?.id ?? null;
    }
    if (!projectId) {
      const first = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
      projectId = first?.id ?? null;
    }
    if (!projectId) { res.status(400).json({ error: "Nenhum projeto encontrado. Crie um projeto primeiro." }); return; }

    const memory = await prisma.memory.create({
      data: { projectId, type: aiType as never, title: aiTitle, content, tags: [], importance: 3 },
    });
    res.status(201).json({ ok: true, memoryId: memory.id, title: memory.title, type: memory.type, fetchedUrl });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────
apiRoutes.get("/notifications", async (req, res) => {
  try {
    const { unread } = req.query as { unread?: string };
    const where = unread === "true" ? { isDismissed: false } : {};
    const notifs = await (prisma as any).notification.findMany({
      where, orderBy: { createdAt: "desc" }, take: 50,
    });
    res.json(notifs);
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

apiRoutes.patch("/notifications/:id/read", async (req, res) => {
  try {
    await (prisma as any).notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ ok: true });
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

apiRoutes.delete("/notifications/:id", async (req, res) => {
  try {
    await (prisma as any).notification.update({ where: { id: req.params.id }, data: { isDismissed: true } });
    res.json({ ok: true });
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

apiRoutes.delete("/notifications", async (_req, res) => {
  try {
    await (prisma as any).notification.updateMany({ data: { isDismissed: true } });
    res.json({ ok: true });
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

apiRoutes.post("/notifications/generate", async (_req, res) => {
  try {
    const now = new Date();
    const ago30 = new Date(now.getTime() - 30 * 86_400_000);
    const ago45 = new Date(now.getTime() - 45 * 86_400_000);
    const created: string[] = [];

    // Já existem notificações não dismissed para esses memoryIds?
    const existing = await (prisma as any).notification.findMany({
      where: { isDismissed: false }, select: { memoryId: true },
    });
    const existingIds = new Set((existing as { memoryId: string | null }[]).map(n => n.memoryId).filter(Boolean));

    // HYPOTHESIS sem acesso há 30+ dias
    const hypotheses = await prisma.memory.findMany({
      where: { epistemicStatus: "HYPOTHESIS", OR: [{ accessedAt: null }, { accessedAt: { lt: ago30 } }] },
      select: { id: true, title: true, projectId: true }, take: 8,
    });
    for (const m of hypotheses) {
      if (existingIds.has(m.id)) continue;
      await (prisma as any).notification.create({
        data: { projectId: m.projectId, type: "hypothesis_review", memoryId: m.id,
          title: "Hipótese para validar", body: `"${m.title.slice(0,60)}" está como HYPOTHESIS há mais de 30 dias. Confirma ou descarta?`,
          metadata: { memoryId: m.id } }
      });
      created.push(m.id);
    }

    // Alta importância (≥4) idle há 45+ dias
    const idle = await prisma.memory.findMany({
      where: { importance: { gte: 4 }, OR: [{ accessedAt: null }, { accessedAt: { lt: ago45 } }], epistemicStatus: { not: "DEPRECATED" } },
      select: { id: true, title: true, projectId: true }, take: 6,
    });
    for (const m of idle) {
      if (existingIds.has(m.id) || created.includes(m.id)) continue;
      await (prisma as any).notification.create({
        data: { projectId: m.projectId, type: "idle_memory", memoryId: m.id,
          title: "Memória importante esquecida", body: `"${m.title.slice(0,60)}" tem importância alta mas não é acessada há mais de 45 dias.`,
          metadata: { memoryId: m.id } }
      });
      created.push(m.id);
    }

    // Clusters para síntese — projetos com 20+ memórias sem SYNTHESIS recente
    const projects = await prisma.project.findMany({ select: { id: true, name: true, slug: true } });
    for (const p of projects) {
      const [total, synthCount] = await Promise.all([
        prisma.memory.count({ where: { projectId: p.id } }),
        prisma.memory.count({ where: { projectId: p.id, type: "SYNTHESIS", createdAt: { gte: ago30 } } }),
      ]);
      if (total >= 20 && synthCount === 0 && !existingIds.has(`synth_${p.id}`)) {
        await (prisma as any).notification.create({
          data: { projectId: p.id, type: "synthesis_ready", memoryId: `synth_${p.id}`,
            title: "Síntese recomendada", body: `O projeto "${p.name}" tem ${total} memórias sem síntese recente. Quer que eu crie uma síntese automática?`,
            metadata: { projectSlug: p.slug, total } }
        });
      }
    }

    res.json({ ok: true, created: created.length });
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

// ── Day State ─────────────────────────────────────────────────────────────────
apiRoutes.get("/day-state", async (req, res) => {
  try {
    const date = (req.query.date as string) ?? new Date().toISOString().split("T")[0];
    const state = await (prisma as any).dayState.findUnique({ where: { date } });
    res.json(state ?? null);
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

apiRoutes.put("/day-state", async (req, res) => {
  try {
    const { date, focus, energy, notes } = req.body as { date?: string; focus?: string; energy?: number; notes?: string };
    const d = date ?? new Date().toISOString().split("T")[0];
    const state = await (prisma as any).dayState.upsert({
      where: { date: d },
      create: { date: d, focus, energy, notes },
      update: { focus, energy, notes },
    });
    res.json(state);
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

// ── Quiz / Revisão de Memórias ────────────────────────────────────────────────
apiRoutes.get("/quiz", async (req, res) => {
  try {
    const { projectSlug, limit = "5" } = req.query as { projectSlug?: string; limit?: string };
    const ago30 = new Date(Date.now() - 30 * 86_400_000);
    const where: Record<string, unknown> = {
      OR: [{ accessedAt: null }, { accessedAt: { lt: ago30 } }],
      type: { not: "SYNTHESIS" },
      epistemicStatus: { not: "DEPRECATED" },
    };
    if (projectSlug) {
      const proj = await prisma.project.findUnique({ where: { slug: projectSlug } });
      if (proj) where.projectId = proj.id;
    }
    const memories = await prisma.memory.findMany({
      where: where as never,
      orderBy: [{ importance: "desc" }, { accessedAt: "asc" }],
      take: Number(limit),
      select: { id: true, title: true, content: true, type: true, importance: true, epistemicStatus: true, accessedAt: true,
        project: { select: { name: true, slug: true, color: true } } },
    });
    res.json(memories);
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

apiRoutes.post("/quiz/:id/answer", async (req, res) => {
  try {
    const { result } = req.body as { result: "easy" | "hard" | "forgot" };
    const memory = await prisma.memory.findUnique({ where: { id: req.params.id } });
    if (!memory) { res.status(404).json({ error: "Memória não encontrada" }); return; }

    const updates: Record<string, unknown> = { accessedAt: new Date() };
    if (result === "easy") {
      updates.validatedCount = (memory.validatedCount ?? 0) + 1;
      if ((memory.validatedCount ?? 0) >= 2 && memory.epistemicStatus === "HYPOTHESIS") {
        updates.epistemicStatus = "VALIDATED";
      }
    } else if (result === "forgot") {
      updates.importance = Math.max(1, memory.importance - 1);
    }
    await prisma.memory.update({ where: { id: memory.id }, data: updates as never });
    res.json({ ok: true, result });
  } catch (e: unknown) { res.status(500).json({ error: e instanceof Error ? e.message : String(e) }); }
});

// ── Chat Sessions (persistência cross-device) ─────────────────────────────────
apiRoutes.get("/chat-sessions", async (_req, res) => {
  try {
    const sessions = await (prisma as any).chatSession.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    res.json(sessions);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.post("/chat-sessions", async (req, res) => {
  try {
    const { id, projectSlug, projectName, title, messages } = req.body as {
      id?: string; projectSlug: string; projectName: string; title: string; messages: unknown[];
    };
    const data: Record<string, unknown> = { projectSlug, projectName, title, messages: messages ?? [] };
    if (id) data.id = id;
    const session = await (prisma as any).chatSession.create({ data });
    res.status(201).json(session);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.patch("/chat-sessions/:id", async (req, res) => {
  try {
    const { title, messages, projectSlug, projectName } = req.body as {
      title?: string; messages?: unknown[]; projectSlug?: string; projectName?: string;
    };
    const data: Record<string, unknown> = {};
    if (title         !== undefined) data.title       = title;
    if (messages      !== undefined) data.messages    = messages;
    if (projectSlug   !== undefined) data.projectSlug = projectSlug;
    if (projectName   !== undefined) data.projectName = projectName;
    const session = await (prisma as any).chatSession.update({ where: { id: req.params.id }, data });
    res.json(session);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.delete("/chat-sessions/:id", async (req, res) => {
  try {
    await (prisma as any).chatSession.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

apiRoutes.delete("/chat-sessions", async (_req, res) => {
  try {
    await (prisma as any).chatSession.deleteMany({});
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// POST /api/agent-run — chamado pela AgentRunPage no frontend (fire and forget, progresso via WebSocket)
apiRoutes.post("/agent-run", async (req, res) => {
  try {
    const { project, goal, max_steps = 8, workdir, computer_agent_id } = req.body as {
      project: string; goal: string; max_steps?: number; workdir?: string; computer_agent_id?: string;
    };
    if (!project || !goal) { res.status(400).json({ error: "project e goal obrigatórios" }); return; }

    // Retorna imediatamente — o progresso chega via WebSocket events:
    // agent_run_start, agent_run_plan, agent_run_step, agent_run_step_done, agent_run_done
    res.json({ status: "started", project, goal });

    // Executa de forma async (fire and forget)
    const { runAgentAsync } = await import("../services/agent.runner.js");
    runAgentAsync({ project, goal, max_steps, workdir, computer_agent_id }).catch(() => {});
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
