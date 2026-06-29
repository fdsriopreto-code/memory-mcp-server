/**
 * Rotas para Claude Code hooks — autenticadas via MCP key (não JWT)
 * Montadas em /hooks (sem /api) para serem acessíveis sem sessão frontend
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { mcpAuth } from "../middleware/auth.js";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { extractMemoriesFromText } from "../services/ai.service.js";
import { getEmbedding } from "../services/embedding.service.js";
import { cacheGetOrSet } from "../services/cache.service.js";

export const hookRoutes = Router();
hookRoutes.use(mcpAuth);

// Mapa de segmentos de caminho → slug do projeto
const PATH_MAP: Record<string, string> = {
  "ilemanager":        "ilemanager",
  "back-ilemanager":   "ilemanager",
  "front-ilemanager":  "ilemanager",
  "admin-ilemanager":  "ilemanager",
  "memory-mcp-server": "memory-mcp-server",
  "front-tarot":       "front-tarot",
};

function detectProject(cwd: string): string | null {
  const normalized = cwd.replace(/\\/g, "/").toLowerCase();
  for (const [seg, slug] of Object.entries(PATH_MAP)) {
    if (normalized.includes(`/${seg.toLowerCase()}`)) return slug;
  }
  return null;
}

// ── GET /hooks/mcp-key/verify ─────────────────────────────────────────────────
// Hook scripts chamam isso como auto-check de que a key está configurada
hookRoutes.get("/mcp-key/verify", (_req, res) => {
  const key = env.MCP_API_KEY;
  res.json({ configured: !!key, keyLength: key?.length ?? 0 });
});

// ── GET /hooks/session-inject ──────────────────────────────────────────────────
// Retorna contexto brain_session_start formatado para injeção no hook UserPromptSubmit
// Query params: project (slug), focus (string), cwd (absolute path)
hookRoutes.get("/session-inject", async (req, res) => {
  try {
    const cwd     = typeof req.query.cwd     === "string" ? req.query.cwd     : "";
    const focus   = typeof req.query.focus   === "string" ? req.query.focus   : "sessão geral";
    let   project = typeof req.query.project === "string" ? req.query.project : "";

    if (!project && cwd) project = detectProject(cwd) ?? "";
    if (!project) { res.json({ context: "", project: null }); return; }

    const proj = await prisma.project.findUnique({ where: { slug: project } });
    if (!proj) { res.json({ context: "", project }); return; }

    const [pinned, tasks, stats] = await Promise.all([
      prisma.memory.findMany({
        where: { projectId: proj.id, isPinned: true },
        orderBy: [{ importance: "desc" }],
        take: 6,
        select: { type: true, title: true, content: true, importance: true, tags: true },
      }),
      prisma.task.findMany({
        where: { projectId: proj.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: { title: true, priority: true, status: true, description: true },
      }),
      cacheGetOrSet(`brain:stats:${proj.id}`, async () => {
        const total = await prisma.memory.count({ where: { projectId: proj.id } });
        const withEmb = await prisma.$queryRaw<[{ count: bigint }]>(
          Prisma.sql`SELECT COUNT(*) AS count FROM memories WHERE project_id = ${proj.id} AND embedding IS NOT NULL`
        ).then(r => Number(r[0]?.count ?? 0));
        return { total, withEmb };
      }, 120),
    ]);

    let context = `# 🧠 Brain — ${proj.name}\n`;
    context += `> ${stats.total} memórias | ${pinned.length} pinadas | ${tasks.length} tasks | foco: ${focus}\n\n`;

    if (pinned.length > 0) {
      context += `## Conhecimento Crítico (Pinado)\n`;
      for (const m of pinned) {
        const snippet = m.content.length > 500 ? m.content.slice(0, 500) + "…" : m.content;
        context += `\n### [${m.type}] ${m.title}\n${snippet}\n`;
      }
    }

    if (tasks.length > 0) {
      context += `\n## Tasks Abertas\n`;
      for (const t of tasks) {
        context += `- [${t.priority}] **${t.title}** (${t.status})`;
        if (t.description) context += ` — ${t.description.slice(0, 80)}`;
        context += "\n";
      }
    }

    res.json({ context, project, projectName: proj.name, stats });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /hooks/git-learn ──────────────────────────────────────────────────────
// Chamado pelo git post-commit hook — cria memórias a partir do commit
hookRoutes.post("/git-learn", async (req, res) => {
  try {
    const {
      project,
      commitMessage,
      diffStat   = "",
      branch     = "main",
      repoPath   = "",
    } = req.body ?? {};

    if (!project || !commitMessage) {
      res.status(400).json({ error: "project e commitMessage são obrigatórios" });
      return;
    }

    const proj = await prisma.project.findUnique({ where: { slug: project } });
    if (!proj) {
      res.status(404).json({ error: `Projeto "${project}" não encontrado` });
      return;
    }

    const isBugFix = /^fix(\(.+\))?:/i.test(commitMessage.trim());
    const text = [
      `Commit em ${branch}${repoPath ? ` (${repoPath})` : ""}:`,
      "",
      commitMessage,
      diffStat ? `\nArquivos alterados:\n${diffStat}` : "",
    ].join("\n");

    const extracted = await extractMemoriesFromText(text, proj.name);

    const created: { id: string; title: string; type: string }[] = [];
    for (const m of extracted) {
      // Bug-fix commits → força tipo BUG_FIX quando AI retorna ARCHITECTURE
      const type = isBugFix && m.type === "ARCHITECTURE" ? ("BUG_FIX" as const) : m.type;

      let embedding: number[] | null = null;
      try { embedding = await getEmbedding(`${m.title} ${m.content}`); } catch {}

      const mem = await prisma.memory.create({
        data: {
          projectId: proj.id,
          type,
          title:     m.title,
          content:   m.content,
          tags:      m.tags,
          importance: m.importance,
          ...(embedding ? { embedding } : {}),
        },
      });
      created.push({ id: mem.id, title: mem.title, type: mem.type });
    }

    res.json({ ok: true, memoriesCreated: created.length, isBugFix, memories: created });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
