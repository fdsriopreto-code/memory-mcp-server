import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { getEmbedding } from "../services/embedding.service.js";
import { extractMemoriesFromText, consolidateMemoriesWithAI } from "../services/ai.service.js";
import { logAudit } from "./audit.js";
import { cacheGetOrSet } from "../services/cache.service.js";
import { openAiBreaker, withRetry } from "../services/circuit-breaker.service.js";

type SemanticRow = {
  id: string; title: string; content: string; type: string;
  importance: number; tags: string[]; similarity: number;
};

export function registerBrain2Tools(server: McpServer) {

  // ── Brain Session Start ──────────────────────────────────────────────────────
  server.tool(
    "brain_session_start",
    "Ponto de entrada de cada sessão de trabalho — retorna memórias pinadas, contexto relevante ao foco, tasks abertas e estado do cérebro. Use SEMPRE no início de uma nova conversa sobre o projeto para orientar a IA.",
    {
      project: z.string().describe("Slug do projeto"),
      focus:   z.string().optional().describe("Tópico, módulo ou área da sessão — personaliza quais memórias são priorizadas (ex: 'pagamentos mercadopago', 'módulo tarot')"),
    },
    async ({ project, focus }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const [pinnedMemories, tasks, brainNotes, stats] = await Promise.all([
        cacheGetOrSet(
          `brain:pinned:${proj.id}`,
          () => prisma.memory.findMany({
            where: { projectId: proj.id, isPinned: true },
            orderBy: [{ importance: "desc" }],
            include: {
              links:    { select: { relation: true, to:   { select: { id: true, title: true, type: true } } } },
              linkedBy: { select: { relation: true, from: { select: { id: true, title: true, type: true } } } },
            },
          }),
          120
        ),
        prisma.task.findMany({
          where: { projectId: proj.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 10,
        }),
        prisma.memory.findMany({
          where: { projectId: proj.id, type: "BRAIN" },
          orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
          take: 2,
          select: { title: true, content: true, importance: true },
        }),
        cacheGetOrSet(
          `brain:stats:${proj.id}`,
          async () => {
            const [totalCount, embRow] = await Promise.all([
              prisma.memory.count({ where: { projectId: proj.id } }),
              prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
                SELECT COUNT(*) AS count FROM memories WHERE project_id = ${proj.id} AND embedding IS NOT NULL
              `),
            ]);
            return { totalCount, withEmb: Number(embRow[0]?.count ?? 0) };
          },
          60
        ),
      ]);

      const totalCount = stats.totalCount;
      const withEmb = stats.withEmb;

      const pinnedIds = pinnedMemories.map(m => m.id);

      // Busca semântica pelo foco (ou top por importância se sem foco)
      let focusMemories: { id: string; title: string; content: string; type: string; importance: number }[] = [];
      if (focus && withEmb > 0) {
        const focusEmb = await openAiBreaker.execute(() => withRetry(() => getEmbedding(focus)));
        const vec = `[${focusEmb.join(",")}]`;
        const exclude = pinnedIds.length > 0 ? Prisma.sql`AND m.id NOT IN (${Prisma.join(pinnedIds)})` : Prisma.empty;
        focusMemories = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
          SELECT m.id, m.title, m.content, m.type, m.importance
          FROM memories m
          WHERE m.project_id = ${proj.id}
            AND m.embedding IS NOT NULL
            ${exclude}
          ORDER BY m.embedding <=> ${vec}::vector
          LIMIT 6
        `);
      } else {
        const exclude = pinnedIds.length > 0 ? { id: { notIn: pinnedIds } } : {};
        focusMemories = await prisma.memory.findMany({
          where: { projectId: proj.id, isPinned: false, ...exclude },
          orderBy: [{ importance: "desc" }, { accessCount: "desc" }],
          take: 6,
          select: { id: true, title: true, content: true, type: true, importance: true },
        });
      }

      let text = `# 🚀 Brain Session Start — ${proj.name}\n`;
      if (focus) text += `_Foco: **${focus}**_\n`;
      text += `\n> 📊 ${totalCount} memórias | 🔢 ${withEmb} embeddings | 📌 ${pinnedMemories.length} pinadas | 📋 ${tasks.length} tasks abertas\n\n`;

      // Notas do cérebro (BRAIN type memories = meta-knowledge)
      if (brainNotes.length > 0) {
        text += `## 🧠 Como trabalhar com este projeto\n\n`;
        text += brainNotes.map(n =>
          `**${n.title}**\n${n.content.slice(0, 600)}${n.content.length > 600 ? "…" : ""}`
        ).join("\n\n");
        text += "\n\n";
      }

      // Memórias pinadas (críticas)
      if (pinnedMemories.length > 0) {
        text += `## 📌 Conhecimento crítico\n\n`;
        text += pinnedMemories.map(m => {
          const linkCount = m.links.length + m.linkedBy.length;
          const linksStr  = linkCount > 0 ? ` 🔗${linkCount}` : "";
          let block = `### [${m.type}] ${m.title} imp:${m.importance}/5${linksStr}\n${m.content}`;
          if (m.links.length > 0) {
            block += `\n_Relacionado: ${m.links.slice(0, 3).map(l => `${l.relation}→${l.to.title}`).join(" | ")}_`;
          }
          return block;
        }).join("\n\n---\n\n");
        text += "\n\n";
      }

      // Memórias relevantes ao foco
      if (focusMemories.length > 0) {
        const label = focus ? `Mais relevante para "${focus}"` : "Top memórias por importância";
        text += `## 💡 ${label}\n\n`;
        text += focusMemories.map(m =>
          `### [${m.type}] ${m.title} imp:${m.importance}/5\n${m.content}`
        ).join("\n\n---\n\n");
        text += "\n\n";
      }

      // Tasks
      const tasksText = tasks.length === 0
        ? "Nenhuma task aberta."
        : tasks.map(t => `- [${t.priority}] **${t.title}** (${t.status})${t.description ? `: ${t.description}` : ""}`).join("\n");
      text += `## 📋 Tasks abertas\n\n${tasksText}\n\n`;

      text += `---\n💡 _Dica: use **brain_query(focus)** para aprofundar • **brain_learn(summary)** ao final para salvar o aprendizado_`;

      await logAudit(proj.id, "brain_session_start", { project, focus }, `${pinnedMemories.length} pinadas, ${focusMemories.length} foco, ${tasks.length} tasks`);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Brain Learn ──────────────────────────────────────────────────────────────
  server.tool(
    "brain_learn",
    "Digere um resumo de sessão com IA e extrai automaticamente memórias estruturadas do tipo correto. A ferramenta de auto-alimentação do cérebro — quanto mais usada, mais inteligente o cérebro fica. Use ao final de toda sessão longa.",
    {
      project: z.string().describe("Slug do projeto"),
      text:    z.string().describe("Resumo da sessão — o que foi feito, bugs encontrados/corrigidos, decisões tomadas, padrões descobertos, contexto novo aprendido"),
      dry_run: z.boolean().default(false).describe("true = mostra o que seria criado sem salvar"),
    },
    async ({ project, text, dry_run }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const extracted = await extractMemoriesFromText(text, proj.name);
      if (extracted.length === 0) {
        return { content: [{ type: "text" as const, text: "A IA não encontrou memórias relevantes para extrair. Tente um resumo mais detalhado com decisões, bugs e padrões descobertos." }] };
      }

      if (dry_run) {
        const preview = extracted.map((m, i) =>
          `**${i + 1}. [${m.type}]** ${m.title} (imp:${m.importance})\n   Tags: ${m.tags.join(", ") || "—"}\n   ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`
        ).join("\n\n");
        return { content: [{ type: "text" as const, text: `# 👁️ Dry Run — ${extracted.length} memórias seriam criadas\n\n${preview}\n\n_Use dry_run: false para salvar._` }] };
      }

      const created = await Promise.all(
        extracted.map(m =>
          prisma.memory.create({
            data: {
              projectId:  proj.id,
              type:       m.type as any,
              title:      m.title,
              content:    m.content,
              tags:       m.tags,
              importance: m.importance,
            },
          })
        )
      );

      // Embeddings async
      setImmediate(async () => {
        for (let i = 0; i < created.length; i++) {
          try {
            const emb = await getEmbedding(`${extracted[i].title}\n\n${extracted[i].content}`);
            await prisma.$executeRaw`UPDATE memories SET embedding = ${`[${emb.join(",")}]`}::vector WHERE id = ${created[i].id}`;
          } catch {}
        }
      });

      const summary = created.map((m, i) =>
        `- **[${extracted[i].type}]** ${extracted[i].title} (imp:${extracted[i].importance}/5) — \`${m.id}\``
      ).join("\n");

      await logAudit(proj.id, "brain_learn", { project, chars: text.length }, `${created.length} memórias criadas via IA`);
      return { content: [{ type: "text" as const, text: `# 🧠 Brain Learn — ${created.length} memórias absorvidas\n\n${summary}\n\n✅ O cérebro cresceu. Use brain_reflect() para ver o estado atual.` }] };
    }
  );

  // ── Brain Query ──────────────────────────────────────────────────────────────
  server.tool(
    "brain_query",
    "Busca semântica enriquecida com traversal do grafo — retorna memórias similares + suas conexões (1-2 saltos) + pinadas. Muito mais rica que memory_search. Use quando precisar de contexto profundo sobre um tópico.",
    {
      project:    z.string(),
      query:      z.string(),
      limit:      z.number().min(1).max(10).default(5),
      graph_hops: z.number().min(0).max(2).default(1).describe("0 = só similares | 1 = + links diretos (padrão) | 2 = + links de links"),
    },
    async ({ project, query, limit, graph_hops }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const embedding = await getEmbedding(query);
      const vec = `[${embedding.join(",")}]`;

      // Busca semântica base
      const semanticResults = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
        SELECT m.id, m.title, m.content, m.type, m.tags, m.importance, m.created_at,
               1 - (m.embedding <=> ${vec}::vector) AS similarity
        FROM memories m
        WHERE m.project_id = ${proj.id}
          AND m.embedding IS NOT NULL
        ORDER BY m.embedding <=> ${vec}::vector
        LIMIT ${limit}
      `);

      const coreIds  = new Set(semanticResults.map(r => r.id));
      const graphIds = new Set<string>(coreIds);

      // Expansão via grafo — hop 1
      if (graph_hops >= 1 && coreIds.size > 0) {
        const links1 = await prisma.memoryLink.findMany({
          where: { OR: [{ fromId: { in: [...coreIds] } }, { toId: { in: [...coreIds] } }] },
          select: { fromId: true, toId: true },
        });
        for (const l of links1) { graphIds.add(l.fromId); graphIds.add(l.toId); }
      }

      // Expansão via grafo — hop 2
      if (graph_hops >= 2 && graphIds.size > coreIds.size) {
        const hop1Only = [...graphIds].filter(id => !coreIds.has(id));
        const links2   = await prisma.memoryLink.findMany({
          where: { OR: [{ fromId: { in: hop1Only } }, { toId: { in: hop1Only } }] },
          select: { fromId: true, toId: true },
        });
        for (const l of links2) { graphIds.add(l.fromId); graphIds.add(l.toId); }
      }

      // Memórias pinadas (sempre incluídas)
      const pinnedMems = await prisma.memory.findMany({
        where: { projectId: proj.id, isPinned: true },
        select: { id: true },
      });
      for (const m of pinnedMems) graphIds.add(m.id);

      // Buscar todos os ids acumulados
      const allMemories = await prisma.memory.findMany({
        where: { id: { in: [...graphIds] } },
        include: {
          links:    { select: { relation: true, toId: true,   to:   { select: { title: true } } } },
          linkedBy: { select: { relation: true, fromId: true, from: { select: { title: true } } } },
        },
      });

      // Atualizar access count nos resultados semânticos
      if (semanticResults.length > 0) {
        await prisma.memory.updateMany({
          where: { id: { in: semanticResults.map(r => r.id) } },
          data: { accessCount: { increment: 1 }, accessedAt: new Date() },
        });
      }

      let text = `# 🔎 Brain Query: "${query}"\n\n`;

      const pinned  = allMemories.filter(m => m.isPinned && !coreIds.has(m.id));
      const core    = allMemories.filter(m => coreIds.has(m.id));
      const graphEx = allMemories.filter(m => !coreIds.has(m.id) && !m.isPinned);

      if (pinned.length > 0) {
        text += `## 📌 Pinadas (contexto crítico)\n\n`;
        text += pinned.map(m => `### [${m.type}] ${m.title}\n${m.content}`).join("\n\n---\n\n");
        text += "\n\n";
      }

      if (core.length > 0) {
        text += `## 🎯 Resultados diretos (${core.length})\n\n`;
        text += core.map(m => {
          const sim  = semanticResults.find(r => r.id === m.id);
          const pct  = sim ? ` ${Math.round(sim.similarity * 100)}%` : "";
          const lnks = m.links.length + m.linkedBy.length;
          return `### [${m.type}] ${m.title}${pct}${lnks > 0 ? ` 🔗${lnks}` : ""} imp:${m.importance}\n${m.content}`;
        }).join("\n\n---\n\n");
        text += "\n\n";
      }

      if (graphEx.length > 0) {
        text += `## 🔗 Contexto via grafo (${graphEx.length} memórias, ${graph_hops} salto${graph_hops > 1 ? "s" : ""})\n\n`;
        text += graphEx.map(m => {
          const preview = m.content.length > 350 ? m.content.slice(0, 350) + "…" : m.content;
          return `### [${m.type}] ${m.title} imp:${m.importance}\n${preview}`;
        }).join("\n\n---\n\n");
      }

      await logAudit(proj.id, "brain_query", { project, query, limit, graph_hops },
        `${core.length} diretos + ${graphEx.length} grafo + ${pinned.length} pinadas`);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Brain Evolve ─────────────────────────────────────────────────────────────
  server.tool(
    "brain_evolve",
    "Auto-melhoria do cérebro baseada em padrões de uso — eleva importância de memórias muito acessadas, rebaixa obsoletas não acessadas. Quanto mais sessões, mais preciso fica o ranking. Use semanalmente.",
    {
      project:    z.string(),
      auto_apply: z.boolean().default(false).describe("false = dry run (mostra mudanças) | true = aplica"),
    },
    async ({ project, auto_apply }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id },
        select: { id: true, title: true, type: true, importance: true, accessCount: true, accessedAt: true, createdAt: true, isPinned: true },
      });

      const staleCutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      const toPromote: typeof memories = [];
      const toDemote:  typeof memories = [];

      for (const m of memories) {
        if (m.isPinned) continue;

        // Promover: muito acessada e pode subir
        if (m.accessCount >= 8 && m.importance < 5) toPromote.push(m);

        // Rebaixar: velha + nunca/raramente acessada + não é crítica
        const isStale = m.createdAt < staleCutoff &&
          (!m.accessedAt || m.accessedAt < staleCutoff) &&
          m.accessCount < 3 && m.importance > 1;
        if (isStale) toDemote.push(m);
      }

      let text = `# 🧬 Brain Evolve — ${proj.name}\n\n`;
      text += auto_apply ? "✅ Mudanças **aplicadas**\n\n" : "👁️ Modo **dry run** — use auto_apply: true para aplicar\n\n";

      if (toPromote.length === 0 && toDemote.length === 0) {
        text += "O cérebro está bem calibrado. Nenhum ajuste necessário no momento.";
        return { content: [{ type: "text" as const, text }] };
      }

      if (toPromote.length > 0) {
        text += `## ⬆️ Promover (muito acessadas, +1 importância)\n`;
        text += toPromote.map(m =>
          `- **${m.title}** [${m.type}] imp: ${m.importance} → **${Math.min(5, m.importance + 1)}** (${m.accessCount} acessos)`
        ).join("\n");
        text += "\n\n";
      }

      if (toDemote.length > 0) {
        text += `## ⬇️ Rebaixar (obsoletas, -1 importância)\n`;
        text += toDemote.map(m => {
          const last = m.accessedAt ? m.accessedAt.toLocaleDateString("pt-BR") : "nunca";
          return `- **${m.title}** [${m.type}] imp: ${m.importance} → **${Math.max(1, m.importance - 1)}** (último acesso: ${last})`;
        }).join("\n");
        text += "\n\n";
      }

      if (auto_apply) {
        await Promise.all([
          ...toPromote.map(m =>
            prisma.memory.update({ where: { id: m.id }, data: { importance: Math.min(5, m.importance + 1) } })
          ),
          ...toDemote.map(m =>
            prisma.memory.update({ where: { id: m.id }, data: { importance: Math.max(1, m.importance - 1) } })
          ),
        ]);
        await logAudit(proj.id, "brain_evolve", { project, auto_apply },
          `+${toPromote.length} promovidas, -${toDemote.length} rebaixadas`);
        text += `✅ ${toPromote.length + toDemote.length} memórias recalibradas.`;
      } else {
        text += `_Execute com auto_apply: true para aplicar ${toPromote.length + toDemote.length} mudanças._`;
      }

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Brain Knowledge Map ───────────────────────────────────────────────────────
  server.tool(
    "brain_knowledge_map",
    "Retorna mapa textual do grafo de conhecimento — visualiza como as memórias se conectam por tipo e relação. Use para entender a estrutura do conhecimento acumulado.",
    {
      project:  z.string(),
      focus_id: z.string().optional().describe("ID de memória para focar no subgrafo em torno dela"),
    },
    async ({ project, focus_id }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const [memories, links] = await Promise.all([
        prisma.memory.findMany({
          where: { projectId: proj.id },
          orderBy: [{ importance: "desc" }],
          select: { id: true, title: true, type: true, importance: true, isPinned: true, accessCount: true },
        }),
        prisma.memoryLink.findMany({
          where: { from: { projectId: proj.id } },
          include: {
            from: { select: { id: true, title: true, type: true, importance: true, isPinned: true } },
            to:   { select: { id: true, title: true, type: true, importance: true } },
          },
        }),
      ]);

      const total      = memories.length;
      const linkedIds  = new Set([...links.map(l => l.fromId), ...links.map(l => l.toId)]);
      const isolated   = memories.filter(m => !linkedIds.has(m.id));

      let text = `# 🗺️ Knowledge Map — ${proj.name}\n`;
      text += `📊 ${total} memórias | 🔗 ${links.length} links | 🏝️ ${isolated.length} isoladas\n\n`;

      if (links.length === 0) {
        text += `⚠️ Grafo vazio — use brain_relate() para construir conexões.\n\n`;
        const byType: Record<string, typeof memories> = {};
        for (const m of memories) {
          if (!byType[m.type]) byType[m.type] = [];
          byType[m.type].push(m);
        }
        for (const [type, mems] of Object.entries(byType)) {
          text += `**[${type}]** (${mems.length})\n`;
          text += mems.map(m => `  ${m.isPinned ? "📌 " : ""}${m.title} imp:${m.importance}`).join("\n") + "\n\n";
        }
        return { content: [{ type: "text" as const, text }] };
      }

      // Agrupar links por from
      const nodeMap = new Map<string, { mem: typeof links[0]["from"]; outgoing: typeof links }>();
      for (const link of links) {
        if (!nodeMap.has(link.fromId)) {
          nodeMap.set(link.fromId, { mem: link.from, outgoing: [] });
        }
        nodeMap.get(link.fromId)!.outgoing.push(link);
      }

      // Filtrar por foco se fornecido
      let nodesToShow = [...nodeMap.values()];
      if (focus_id) {
        const neighborIds = new Set<string>([focus_id]);
        for (const l of links) {
          if (l.fromId === focus_id) neighborIds.add(l.toId);
          if (l.toId   === focus_id) neighborIds.add(l.fromId);
        }
        nodesToShow = nodesToShow.filter(n => neighborIds.has(n.mem.id));
        text += `_Subgrafo em torno de \`${focus_id.slice(-8)}\`_\n\n`;
      }

      // Ordenar por importância
      nodesToShow.sort((a, b) => b.mem.importance - a.mem.importance);

      for (const { mem, outgoing } of nodesToShow) {
        const pin = mem.isPinned ? "📌 " : "";
        text += `**${pin}[${mem.type}] ${mem.title}** imp:${mem.importance} \`…${mem.id.slice(-6)}\`\n`;
        for (const link of outgoing) {
          const arrowMap: Record<string, string> = {
            EXTENDS:    "──extends──▶",
            SUPERSEDES: "══super══▶",
            CONTRADICTS:"──✗──",
            DEPENDS_ON: "──needs──▶",
            EXAMPLE_OF: "──e.g.──▶",
            RELATED:    "──────▶",
            CAUSES:     "──causes──▶",
          };
          const arrow = arrowMap[link.relation] ?? "──▶";
          text += `  ${arrow} [${link.to.type}] ${link.to.title}\n`;
        }
        text += "\n";
      }

      if (!focus_id && isolated.length > 0) {
        text += `## 🏝️ Memórias sem links (${isolated.length})\n`;
        text += isolated.map(m => `- [${m.type}] ${m.title} imp:${m.importance}`).join("\n");
      }

      await logAudit(proj.id, "brain_knowledge_map", { project, focus_id }, `${links.length} links visualizados`);
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Brain Consolidate ────────────────────────────────────────────────────────
  server.tool(
    "brain_consolidate",
    "Usa IA para mesclar múltiplas memórias em uma única mais completa e estruturada. Elimina fragmentação e duplicatas. Os links das memórias originais são preservados e migrados para a nova.",
    {
      ids:     z.array(z.string()).min(2).max(8).describe("IDs das memórias a mesclar (2–8)"),
      title:   z.string().optional().describe("Título da memória resultante (opcional — a IA sugere se omitido)"),
      dry_run: z.boolean().default(true).describe("true = mostra preview sem salvar | false = aplica"),
    },
    async ({ ids, title, dry_run }) => {
      const memories = await prisma.memory.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, content: true, type: true, importance: true, tags: true, projectId: true },
      });

      if (memories.length < 2) {
        return { content: [{ type: "text" as const, text: `Apenas ${memories.length} memória(s) encontradas dos IDs fornecidos. Verifique os IDs.` }] };
      }

      const projectId     = memories[0].projectId;
      const maxImportance = Math.max(...memories.map(m => m.importance));
      const allTags       = [...new Set(memories.flatMap(m => m.tags))];

      const consolidated = await consolidateMemoriesWithAI(
        memories.map(m => ({ title: m.title, content: m.content, type: m.type }))
      );
      const finalTitle = title ?? consolidated.title;

      if (dry_run) {
        const sourceList = memories.map(m => `- [${m.type}] **${m.title}** \`${m.id}\``).join("\n");
        return { content: [{ type: "text" as const, text: `# 👁️ Preview de Consolidação\n\n## Fontes (${memories.length})\n${sourceList}\n\n## Resultado proposto\n**Tipo**: ${consolidated.type}\n**Título**: ${finalTitle}\n**Importância**: ${maxImportance}/5\n**Tags**: ${allTags.join(", ") || "—"}\n\n${consolidated.content}\n\n---\n_Use dry_run: false para aplicar e deletar as ${memories.length} memórias originais._` }] };
      }

      // Coletar links existentes antes de deletar
      const existingLinks = await prisma.memoryLink.findMany({
        where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
        select: { fromId: true, toId: true, relation: true },
      });

      // Criar nova memória
      const newMem = await prisma.memory.create({
        data: { projectId, type: consolidated.type as any, title: finalTitle, content: consolidated.content, tags: allTags, importance: maxImportance },
      });

      // Deletar originais (cascade deleta links)
      await prisma.memory.deleteMany({ where: { id: { in: ids } } });

      // Recriar links apontando para nova memória (deduplica)
      const newLinks = existingLinks
        .map(l => ({
          fromId:   ids.includes(l.fromId) ? newMem.id : l.fromId,
          toId:     ids.includes(l.toId)   ? newMem.id : l.toId,
          relation: l.relation,
        }))
        .filter(l => l.fromId !== l.toId)
        .filter((l, i, arr) => arr.findIndex(x => x.fromId === l.fromId && x.toId === l.toId && x.relation === l.relation) === i);

      if (newLinks.length > 0) {
        await prisma.memoryLink.createMany({ data: newLinks, skipDuplicates: true });
      }

      // Embedding async
      setImmediate(async () => {
        try {
          const emb = await getEmbedding(`${finalTitle}\n\n${consolidated.content}`);
          await prisma.$executeRaw`UPDATE memories SET embedding = ${`[${emb.join(",")}]`}::vector WHERE id = ${newMem.id}`;
        } catch {}
      });

      await logAudit(projectId, "brain_consolidate", { ids, title: finalTitle }, `${memories.length} → 1, novo ID: ${newMem.id}`);
      return { content: [{ type: "text" as const, text: `# ✅ Consolidação concluída\n\n**[${consolidated.type}] ${finalTitle}** imp:${maxImportance}/5\n**ID**: \`${newMem.id}\`\n**${memories.length} memórias originais deletadas** | ${newLinks.length} links migrados\n\n${consolidated.content}` }] };
    }
  );
}
