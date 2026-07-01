import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { logAudit } from "./audit.js";

type DuplicatePair = {
  a_id: string;
  a_title: string;
  b_id: string;
  b_title: string;
  similarity: number;
};

const ALL_TYPES = ["DECISION", "CONTEXT", "PATTERN", "NOTE", "BUG_FIX", "ARCHITECTURE", "BRAIN"] as const;

export function registerBrainTools(server: McpServer) {

  // ── Brain Reflect ────────────────────────────────────────────────────────────
  server.tool(
    "brain_reflect",
    "Analisa o estado do cérebro do projeto — detecta gaps de cobertura, memórias obsoletas, possíveis duplicatas e sugere melhorias estruturais. Use no início de sessões longas ou periodicamente para manter o conhecimento saudável.",
    {
      project: z.string().describe("Slug do projeto"),
    },
    async ({ project }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id },
        orderBy: [{ importance: "desc" }, { accessCount: "desc" }],
        include: {
          links:    { select: { relation: true, toId: true } },
          linkedBy: { select: { relation: true, fromId: true } },
        },
      });

      const total = memories.length;
      if (total === 0) {
        return { content: [{ type: "text" as const, text: "Nenhuma memória encontrada. O cérebro está vazio — use memory_add para começar." }] };
      }

      // 1. Distribuição por tipo
      const byType: Record<string, number> = {};
      for (const t of ALL_TYPES) byType[t] = 0;
      for (const m of memories) byType[m.type] = (byType[m.type] ?? 0) + 1;

      const missingTypes = ALL_TYPES.filter(t => t !== "BRAIN" && byType[t] === 0);

      // 2. Memórias obsoletas (importância >= 3, criadas há > 30 dias, nunca ou raramente acessadas)
      const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const stale = memories.filter(m =>
        m.importance >= 3 &&
        m.createdAt < staleCutoff &&
        (!m.accessedAt || m.accessedAt < staleCutoff)
      );

      // 3. Candidatos à remoção (importância baixa, sem links, sem acessos, antigas)
      const orphans = memories.filter(m =>
        m.importance <= 2 &&
        m.links.length === 0 &&
        m.linkedBy.length === 0 &&
        m.accessCount === 0 &&
        m.createdAt < staleCutoff
      );

      // 4. Contagem de embeddings via raw SQL (embedding é Unsupported no Prisma client)
      const [embResult] = await prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        SELECT COUNT(*) AS count FROM memories
        WHERE project_id = ${proj.id} AND embedding IS NOT NULL
      `);
      const withEmbCount = Number(embResult?.count ?? 0);
      const noEmb = total - withEmbCount;

      // 5. Possíveis duplicatas via pgvector
      let duplicates: DuplicatePair[] = [];
      if (withEmbCount >= 2) {
        duplicates = await prisma.$queryRaw<DuplicatePair[]>(Prisma.sql`
          SELECT
            a.id    AS a_id, a.title AS a_title,
            b.id    AS b_id, b.title AS b_title,
            ROUND(CAST(1 - (a.embedding <=> b.embedding) AS NUMERIC), 3)::FLOAT AS similarity
          FROM memories a, memories b
          WHERE a.project_id = ${proj.id}
            AND b.project_id = ${proj.id}
            AND a.id < b.id
            AND a.embedding IS NOT NULL
            AND b.embedding IS NOT NULL
            AND 1 - (a.embedding <=> b.embedding) > 0.88
          ORDER BY similarity DESC
          LIMIT 10
        `);
      }

      // 6. Memórias pinadas
      const pinned = memories.filter(m => m.isPinned);

      // 7. Top 5 mais acessadas
      const topAccessed = [...memories]
        .sort((a, b) => b.accessCount - a.accessCount)
        .slice(0, 5);

      // 8. Memórias sem links (excluindo BRAIN e NOTE)
      const isolated = memories.filter(m =>
        m.links.length === 0 && m.linkedBy.length === 0 &&
        m.importance >= 3 &&
        !["NOTE", "BRAIN"].includes(m.type)
      );

      // Montar relatório
      const typeDistrib = ALL_TYPES
        .map(t => `${t}:${byType[t]}`)
        .join(" | ");

      let text = `# 🧠 Brain Reflect — ${proj.name}\n\n`;

      text += `## 📊 Estado atual\n`;
      text += `- **Total**: ${total} memórias | 📌 Pinadas: ${pinned.length} | 🔗 Com embedding: ${total - noEmb}/${total}\n`;
      text += `- **Distribuição**: ${typeDistrib}\n\n`;

      if (missingTypes.length > 0) {
        text += `## ⚠️ Gaps de cobertura\n`;
        text += missingTypes.map(t => `- Nenhuma memória do tipo **${t}**`).join("\n");
        text += "\n\n";
      }

      if (duplicates.length > 0) {
        text += `## 🔍 Possíveis duplicatas (similaridade > 88%)\n`;
        text += duplicates.map(d =>
          `- **${d.a_title}** ↔ **${d.b_title}** (${Math.round(d.similarity * 100)}%)\n  \`${d.a_id}\` / \`${d.b_id}\` → use brain_relate(SUPERSEDES) para indicar qual é a versão atual`
        ).join("\n");
        text += "\n\n";
      }

      if (stale.length > 0) {
        text += `## 📅 Possivelmente obsoletas (importância ≥ 3, não acessadas em 30+ dias)\n`;
        text += stale.slice(0, 6).map(m => {
          const last = m.accessedAt ? m.accessedAt.toLocaleDateString("pt-BR") : "nunca";
          return `- **${m.title}** [${m.type}] imp:${m.importance} — último acesso: ${last}\n  \`${m.id}\``;
        }).join("\n");
        text += "\n\n";
      }

      if (orphans.length > 0) {
        text += `## 🗑️ Candidatos à remoção (imp ≤ 2, sem links, sem acessos)\n`;
        text += orphans.slice(0, 5).map(m =>
          `- **${m.title}** [${m.type}] — \`${m.id}\``
        ).join("\n");
        text += "\n\n";
      }

      if (isolated.length > 0 && total > 5) {
        text += `## 🏝️ Memórias isoladas (sem links, imp ≥ 3)\n`;
        text += isolated.slice(0, 5).map(m =>
          `- **${m.title}** [${m.type}] — use brain_relate() para conectar`
        ).join("\n");
        text += "\n\n";
      }

      text += `## ⚡ Mais acessadas\n`;
      text += topAccessed.map(m =>
        `- **${m.title}** [${m.type}] — ${m.accessCount} acessos`
      ).join("\n");
      text += "\n\n";

      if (pinned.length > 0) {
        text += `## 📌 Memórias pinadas (sempre no contexto)\n`;
        text += pinned.map(m => `- **${m.title}** [${m.type}]`).join("\n");
        text += "\n\n";
      }

      // Sugestões priorizadas
      const sugestoes: string[] = [];
      if (pinned.length === 0) {
        sugestoes.push("Use **brain_pin** nas 2-3 memórias mais críticas — elas sempre aparecerão no project_context");
      }
      if (missingTypes.length > 0) {
        sugestoes.push(`Crie memórias dos tipos ausentes: **${missingTypes.join(", ")}**`);
      }
      if (duplicates.length > 0) {
        sugestoes.push(`Revise as ${duplicates.length} duplicatas e use **brain_relate(SUPERSEDES)** na versão mais recente`);
      }
      if (stale.length > 0) {
        sugestoes.push(`Revise/atualize as ${stale.length} memórias obsoletas com **memory_update** ou delete com **memory_delete**`);
      }
      if (noEmb > 0) {
        sugestoes.push(`${noEmb} memórias sem embedding — a busca semântica não as alcança; re-save com memory_update para regenerar`);
      }
      if (isolated.length > 3) {
        sugestoes.push(`Use **brain_relate** para criar conexões entre memórias — o grafo de conhecimento melhora a recuperação contextual`);
      }
      sugestoes.push("Salve uma memória do tipo **BRAIN** com insights sobre como usar este projeto — ela orienta sessões futuras");

      text += `## 💡 Sugestões priorizadas\n`;
      text += sugestoes.map((s, i) => `${i + 1}. ${s}`).join("\n");

      await logAudit(proj.id, "brain_reflect", { project }, `${total} memórias analisadas, ${duplicates.length} dup, ${stale.length} obsoletas`);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Brain Relate ─────────────────────────────────────────────────────────────
  server.tool(
    "brain_relate",
    "Cria um link tipado entre duas memórias (A → B). Constrói o grafo de conhecimento do projeto para melhorar a recuperação contextual.",
    {
      fromId:   z.string().describe("ID da memória de origem"),
      toId:     z.string().describe("ID da memória de destino"),
      relation: z.enum(["EXTENDS", "SUPERSEDES", "CONTRADICTS", "DEPENDS_ON", "EXAMPLE_OF", "RELATED"])
                .describe("EXTENDS: B refina/amplia A | SUPERSEDES: B substitui/corrige A (A está desatualizada) | CONTRADICTS: conflito, revisar | DEPENDS_ON: entenda A antes de B | EXAMPLE_OF: B é caso concreto de A | RELATED: relação genérica"),
    },
    async ({ fromId, toId, relation }) => {
      if (fromId === toId) return { content: [{ type: "text" as const, text: "fromId e toId devem ser diferentes." }] };

      const [from, to] = await Promise.all([
        prisma.memory.findUnique({ where: { id: fromId }, select: { id: true, title: true, projectId: true } }),
        prisma.memory.findUnique({ where: { id: toId },   select: { id: true, title: true } }),
      ]);
      if (!from) return { content: [{ type: "text" as const, text: `Memória de origem (${fromId}) não encontrada.` }] };
      if (!to)   return { content: [{ type: "text" as const, text: `Memória de destino (${toId}) não encontrada.` }] };

      const existing = await prisma.memoryLink.findFirst({ where: { fromId, toId, relation } });
      if (existing) return { content: [{ type: "text" as const, text: `Link "${from.title}" ${relation} "${to.title}" já existe.` }] };
      await prisma.memoryLink.create({ data: { fromId, toId, relation } });

      await logAudit(from.projectId, "brain_relate", { fromId, toId, relation }, `"${from.title}" → "${to.title}"`);
      return { content: [{ type: "text" as const, text: `🔗 Link criado: **"${from.title}"** --[${relation}]--> **"${to.title}"**` }] };
    }
  );

  // ── Brain Get Related ────────────────────────────────────────────────────────
  server.tool(
    "brain_get_related",
    "Retorna todas as memórias linkadas a uma memória (em ambas as direções). Use ao explorar um tópico para descobrir conhecimento relacionado.",
    {
      id: z.string().describe("ID da memória"),
    },
    async ({ id }) => {
      const memory = await prisma.memory.findUnique({
        where: { id },
        select: {
          id: true, title: true, type: true, projectId: true,
          links: {
            include: {
              to: { select: { id: true, type: true, title: true, content: true, importance: true } },
            },
          },
          linkedBy: {
            include: {
              from: { select: { id: true, type: true, title: true, content: true, importance: true } },
            },
          },
        },
      });
      if (!memory) return { content: [{ type: "text" as const, text: "Memória não encontrada." }] };

      const totalLinks = memory.links.length + memory.linkedBy.length;
      if (totalLinks === 0) {
        return { content: [{ type: "text" as const, text: `Nenhuma memória linkada a "${memory.title}". Use brain_relate() para criar conexões.` }] };
      }

      let text = `# 🔗 Links de "${memory.title}" [${memory.type}]\n\n`;

      if (memory.links.length > 0) {
        text += `## → Saindo (esta memória aponta para)\n`;
        text += memory.links.map(l => {
          const preview = l.to.content.length > 120 ? l.to.content.slice(0, 120) + "…" : l.to.content;
          return `### [${l.relation}] ${l.to.title} [${l.to.type}] imp:${l.to.importance}\n\`${l.to.id}\`\n${preview}`;
        }).join("\n\n");
        text += "\n\n";
      }

      if (memory.linkedBy.length > 0) {
        text += `## ← Chegando (outras memórias apontam para esta)\n`;
        text += memory.linkedBy.map(l => {
          const preview = l.from.content.length > 120 ? l.from.content.slice(0, 120) + "…" : l.from.content;
          return `### [${l.relation}] ${l.from.title} [${l.from.type}] imp:${l.from.importance}\n\`${l.from.id}\`\n${preview}`;
        }).join("\n\n");
      }

      await logAudit(memory.projectId, "brain_get_related", { id }, `${totalLinks} links`);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Brain Pin ────────────────────────────────────────────────────────────────
  server.tool(
    "brain_pin",
    "Pina ou despina uma memória. Memórias pinadas aparecem SEMPRE no project_context, independente de importância ou acessos — ideal para regras críticas e contexto arquitetural permanente.",
    {
      id:  z.string().describe("ID da memória"),
      pin: z.boolean().default(true).describe("true = pinar | false = despinar"),
    },
    async ({ id, pin }) => {
      const memory = await prisma.memory.findUnique({ where: { id }, select: { id: true, title: true, type: true, projectId: true } });
      if (!memory) return { content: [{ type: "text" as const, text: "Memória não encontrada." }] };

      await prisma.memory.update({ where: { id }, data: { isPinned: pin } });
      await logAudit(memory.projectId, "brain_pin", { id, pin }, `"${memory.title}" ${pin ? "pinada" : "despinada"}`);

      const icon = pin ? "📌" : "📎";
      const action = pin ? "pinada — aparecerá sempre no project_context" : "despinada — voltará ao ranking normal";
      return { content: [{ type: "text" as const, text: `${icon} Memória **"${memory.title}"** [${memory.type}] ${action}.` }] };
    }
  );

  // ── Brain Unrelate ───────────────────────────────────────────────────────────
  server.tool(
    "brain_unrelate",
    "Remove um link entre duas memórias",
    {
      fromId:   z.string(),
      toId:     z.string(),
      relation: z.enum(["EXTENDS", "SUPERSEDES", "CONTRADICTS", "DEPENDS_ON", "EXAMPLE_OF", "RELATED"]),
    },
    async ({ fromId, toId, relation }) => {
      const link = await prisma.memoryLink.findUnique({
        where: { fromId_toId_relation: { fromId, toId, relation } },
        include: {
          from: { select: { title: true, projectId: true } },
          to:   { select: { title: true } },
        },
      });
      if (!link) return { content: [{ type: "text" as const, text: "Link não encontrado." }] };

      await prisma.memoryLink.delete({ where: { fromId_toId_relation: { fromId, toId, relation } } });
      await logAudit(link.from.projectId, "brain_unrelate", { fromId, toId, relation }, `"${link.from.title}" → "${link.to.title}" removido`);
      return { content: [{ type: "text" as const, text: `Link "${link.from.title}" --[${relation}]--> "${link.to.title}" removido.` }] };
    }
  );
}
