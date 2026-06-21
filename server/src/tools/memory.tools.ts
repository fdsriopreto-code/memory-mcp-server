import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { getEmbedding } from "../services/embedding.service.js";
import { logAudit } from "./audit.js";

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  type: string;
  tags: string[];
  importance: number;
  similarity: number;
  created_at: Date;
};

export function registerMemoryTools(server: McpServer) {

  // ── Busca semântica ──────────────────────────────────────────────────────────
  server.tool(
    "memory_search",
    "Busca memórias por similaridade semântica dentro de um projeto",
    {
      project: z.string().describe("Slug do projeto (ex: ile-manager, operax)"),
      query:   z.string().describe("Texto da busca — descreva o que quer encontrar"),
      limit:   z.number().min(1).max(20).default(5).describe("Número máximo de resultados"),
      type:    z.enum(["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE","BRAIN"])
               .optional().describe("Filtrar por tipo de memória"),
    },
    async ({ project, query, limit, type }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const embedding = await getEmbedding(query);
      const vectorStr = `[${embedding.join(",")}]`;

      const typeCondition = type ? Prisma.sql`AND m.type = ${type}` : Prisma.empty;
      let results = await prisma.$queryRaw<MemoryRow[]>(Prisma.sql`
        SELECT m.id, m.title, m.content, m.type, m.tags, m.importance, m.created_at,
               1 - (m.embedding <=> ${vectorStr}::vector) as similarity
        FROM memories m
        WHERE m.project_id = ${proj.id}
          AND m.embedding IS NOT NULL
          ${typeCondition}
        ORDER BY m.embedding <=> ${vectorStr}::vector
        LIMIT ${limit}
      `);

      // Fallback ILIKE para memórias sem embedding ainda
      if (results.length === 0) {
        const fallback = await prisma.memory.findMany({
          where: {
            projectId: proj.id,
            ...(type ? { type } : {}),
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { content: { contains: query, mode: "insensitive" } },
              { tags: { has: query.toLowerCase() } },
            ],
          },
          take: limit,
          orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        });
        results = fallback.map(m => ({
          id: m.id, title: m.title, content: m.content,
          type: m.type, tags: m.tags, importance: m.importance,
          similarity: 0, created_at: m.createdAt,
        }));
      }

      if (results.length > 0) {
        await prisma.memory.updateMany({
          where: { id: { in: results.map(r => r.id) } },
          data: { accessCount: { increment: 1 }, accessedAt: new Date() },
        });
      }

      await logAudit(proj.id, "memory_search", { project, query, limit, type }, `${results.length} resultados`);

      const text = results.length === 0
        ? "Nenhuma memória encontrada para essa busca."
        : results.map((r, i) =>
            `## ${i + 1}. [${r.type}] ${r.title}\n` +
            `Relevância: ${r.similarity > 0 ? `${(r.similarity * 100).toFixed(0)}%` : "texto"} | Tags: ${r.tags.join(", ") || "—"} | Importância: ${r.importance}/5\n\n` +
            r.content
          ).join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Adicionar memória ────────────────────────────────────────────────────────
  server.tool(
    "memory_add",
    "Salva uma nova memória persistente no projeto",
    {
      project:    z.string().describe("Slug do projeto"),
      type:       z.enum(["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE","BRAIN"]),
      title:      z.string().describe("Título curto e descritivo"),
      content:    z.string().describe("Conteúdo completo da memória"),
      tags:       z.array(z.string()).default([]).describe("Tags para categorização"),
      importance: z.number().min(1).max(5).default(3).describe("Importância de 1 a 5"),
    },
    async ({ project, type, title, content, tags, importance }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const memory = await prisma.memory.create({
        data: { projectId: proj.id, type, title, content, tags, importance },
      });

      // Gera embedding de forma assíncrona (não bloqueia a resposta)
      setImmediate(async () => {
        try {
          const embedding = await getEmbedding(`${title}\n\n${content}`);
          await prisma.$executeRaw`
            UPDATE memories SET embedding = ${`[${embedding.join(",")}]`}::vector WHERE id = ${memory.id}
          `;
        } catch (e) {
          console.error("[Embedding] Erro ao gerar:", e);
        }
      });

      await logAudit(proj.id, "memory_add", { project, type, title }, `ID: ${memory.id}`);
      return { content: [{ type: "text" as const, text: `Memória salva com sucesso! ID: ${memory.id}` }] };
    }
  );

  // ── Atualizar memória ────────────────────────────────────────────────────────
  server.tool(
    "memory_update",
    "Atualiza uma memória existente pelo ID",
    {
      id:         z.string().describe("ID da memória"),
      title:      z.string().optional(),
      content:    z.string().optional(),
      tags:       z.array(z.string()).optional(),
      importance: z.number().min(1).max(5).optional(),
    },
    async ({ id, title, content, tags, importance }) => {
      const memory = await prisma.memory.findUnique({ where: { id } });
      if (!memory) return { content: [{ type: "text" as const, text: "Memória não encontrada." }] };

      await prisma.memory.update({ where: { id }, data: { title, content, tags, importance } });
      await logAudit(memory.projectId, "memory_update", { id, title, tags, importance }, `Memória ${id} atualizada`);

      if (content || title) {
        setImmediate(async () => {
          try {
            const newTitle   = title   ?? memory.title;
            const newContent = content ?? memory.content;
            const embedding  = await getEmbedding(`${newTitle}\n\n${newContent}`);
            await prisma.$executeRaw`
              UPDATE memories SET embedding = ${`[${embedding.join(",")}]`}::vector WHERE id = ${id}
            `;
          } catch (e) {
            console.error("[Embedding] Erro ao atualizar:", e);
          }
        });
      }

      return { content: [{ type: "text" as const, text: `Memória ${id} atualizada.` }] };
    }
  );

  // ── Contexto do projeto ──────────────────────────────────────────────────────
  server.tool(
    "project_context",
    "Retorna snapshot do projeto: top memórias por importância + tasks abertas. Use no início de cada conversa.",
    {
      project: z.string().describe("Slug do projeto"),
    },
    async ({ project }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const [pinnedMemories, topMemories, tasks] = await Promise.all([
        // Memórias pinadas — sempre incluídas
        prisma.memory.findMany({
          where: { projectId: proj.id, isPinned: true },
          orderBy: [{ importance: "desc" }],
          select: { id: true, type: true, title: true, content: true, tags: true, importance: true, isPinned: true,
            _count: { select: { links: true, linkedBy: true } } },
        }),
        // Top memórias por importância/acesso (excluindo já pinadas)
        prisma.memory.findMany({
          where: { projectId: proj.id, isPinned: false },
          orderBy: [{ importance: "desc" }, { accessCount: "desc" }],
          take: 8,
          select: { id: true, type: true, title: true, content: true, tags: true, importance: true, isPinned: true,
            _count: { select: { links: true, linkedBy: true } } },
        }),
        prisma.task.findMany({
          where: { projectId: proj.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 10,
        }),
      ]);

      const renderMemory = (m: typeof pinnedMemories[0], pinBadge = false) => {
        const linkCount = m._count.links + m._count.linkedBy;
        const badge = pinBadge ? "📌 " : "";
        const links = linkCount > 0 ? ` 🔗${linkCount}` : "";
        return `### ${badge}[${m.type}] ${m.title} (imp: ${m.importance}/5${links})\n${m.content}`;
      };

      let memoriesText = "";
      if (pinnedMemories.length > 0) {
        memoriesText += `## 📌 Memórias pinadas (${pinnedMemories.length})\n\n`;
        memoriesText += pinnedMemories.map(m => renderMemory(m, true)).join("\n\n---\n\n");
        memoriesText += "\n\n";
      }
      if (topMemories.length > 0) {
        memoriesText += `## Memórias principais (${topMemories.length})\n\n`;
        memoriesText += topMemories.map(m => renderMemory(m)).join("\n\n---\n\n");
      }

      const totalMemories = pinnedMemories.length + topMemories.length;

      const tasksText = tasks.length === 0
        ? "Nenhuma task aberta."
        : tasks.map(t => `- [${t.priority}] ${t.title} (${t.status})${t.description ? `: ${t.description}` : ""}`).join("\n");

      const text =
        `# Contexto: ${proj.name}\n\n` +
        `${proj.description ?? ""}\n\n` +
        memoriesText + "\n" +
        `## Tasks abertas\n\n${tasksText}`;

      await logAudit(proj.id, "project_context", { project }, `${totalMemories} memórias (${pinnedMemories.length} pinadas), ${tasks.length} tasks`);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Listar memórias ──────────────────────────────────────────────────────────
  server.tool(
    "memory_list",
    "Lista memórias de um projeto com filtros opcionais",
    {
      project: z.string(),
      type:    z.enum(["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE","BRAIN"]).optional(),
      tag:     z.string().optional().describe("Filtrar por tag"),
      limit:   z.number().default(20),
    },
    async ({ project, type, tag, limit }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const memories = await prisma.memory.findMany({
        where: {
          projectId: proj.id,
          ...(type ? { type } : {}),
          ...(tag   ? { tags: { has: tag } } : {}),
        },
        orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        take: limit,
      });

      await logAudit(proj.id, "memory_list", { project, type, tag, limit }, `${memories.length} memórias`);

      const text = memories.map(m =>
        `- [${m.id}] [${m.type}] **${m.title}** (imp: ${m.importance}) tags: ${m.tags.join(", ") || "—"}`
      ).join("\n");

      return { content: [{ type: "text" as const, text: text || "Nenhuma memória encontrada." }] };
    }
  );

  // ── Listar projetos ──────────────────────────────────────────────────────────
  server.tool(
    "project_list",
    "Lista todos os projetos disponíveis no Memory MCP com contagem de memórias e tasks",
    {},
    async () => {
      const projects = await prisma.project.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { memories: true, tasks: true } } },
      });
      await logAudit(null, "project_list", {}, `${projects.length} projetos`);
      const text = projects.map(p =>
        `- **${p.name}** (slug: \`${p.slug}\`) — ${p._count.memories} memórias, ${p._count.tasks} tasks${p.description ? `\n  ${p.description}` : ""}`
      ).join("\n");
      return { content: [{ type: "text" as const, text: text || "Nenhum projeto encontrado." }] };
    }
  );

  // ── Deletar memória ──────────────────────────────────────────────────────────
  server.tool(
    "memory_delete",
    "Remove uma memória pelo ID. Use com cautela — a operação é irreversível.",
    { id: z.string().describe("ID da memória a deletar") },
    async ({ id }) => {
      const memory = await prisma.memory.findUnique({ where: { id } });
      if (!memory) return { content: [{ type: "text" as const, text: "Memória não encontrada." }] };
      await prisma.memory.delete({ where: { id } });
      await logAudit(memory.projectId, "memory_delete", { id }, `"${memory.title}" deletada`);
      return { content: [{ type: "text" as const, text: `Memória "${memory.title}" (${id}) deletada.` }] };
    }
  );

  // ── Adicionar múltiplas memórias ─────────────────────────────────────────────
  server.tool(
    "memory_add_batch",
    "Salva múltiplas memórias de uma vez — ideal para consolidar contexto ao fim de uma sessão longa",
    {
      project:  z.string().describe("Slug do projeto"),
      memories: z.array(z.object({
        type:       z.enum(["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE","BRAIN"]),
        title:      z.string(),
        content:    z.string(),
        tags:       z.array(z.string()).default([]),
        importance: z.number().min(1).max(5).default(3),
      })).min(1).max(20).describe("Lista de memórias (máx 20 por chamada)"),
    },
    async ({ project, memories }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const created = await Promise.all(
        memories.map(m => prisma.memory.create({
          data: { projectId: proj.id, type: m.type, title: m.title, content: m.content, tags: m.tags, importance: m.importance },
        }))
      );

      setImmediate(async () => {
        for (let i = 0; i < created.length; i++) {
          try {
            const embedding = await getEmbedding(`${memories[i].title}\n\n${memories[i].content}`);
            await prisma.$executeRaw`UPDATE memories SET embedding = ${`[${embedding.join(",")}]`}::vector WHERE id = ${created[i].id}`;
          } catch {}
        }
      });

      await logAudit(proj.id, "memory_add_batch", { project, count: created.length }, `${created.length} memórias criadas`);
      const ids = created.map(m => m.id).join(", ");
      return { content: [{ type: "text" as const, text: `${created.length} memórias salvas!\nIDs: ${ids}` }] };
    }
  );
}
