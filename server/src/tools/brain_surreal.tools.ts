import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function registerSurrealTools(server: McpServer) {

  // ── Tool 1: brain_epistemic ──────────────────────────────────────────────────
  server.tool(
    "brain_epistemic",
    "Visualiza e promove status epistêmico das memórias: HYPOTHESIS → VALIDATED → CONTESTED → DEPRECATED",
    {
      project_slug: z.string().describe("Slug do projeto"),
      action:       z.enum(["report", "promote", "demote", "contest"]).describe("Ação a executar"),
      memory_id:    z.string().optional().describe("ID da memória (obrigatório para promote/demote/contest)"),
      reason:       z.string().optional().describe("Razão para contest"),
    },
    async ({ project_slug, action, memory_id, reason }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project_slug } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project_slug}" não encontrado.` }] };

      if (action === "report") {
        const [counts, contested] = await Promise.all([
          prisma.memory.groupBy({
            by: ["epistemicStatus"],
            where: { projectId: proj.id },
            _count: { id: true },
          }),
          prisma.memory.findMany({
            where: { projectId: proj.id, epistemicStatus: "CONTESTED" },
            select: { id: true, title: true, type: true, driftScore: true, validatedCount: true },
          }),
        ]);

        const dist = counts.map(c => `  ${c.epistemicStatus}: ${c._count.id}`).join("\n");
        const contestedList = contested.length === 0
          ? "  Nenhuma contestada."
          : contested.map(m => `  [${m.type}] ${m.title} (drift: ${m.driftScore.toFixed(2)}, validações: ${m.validatedCount}) id:${m.id}`).join("\n");

        return { content: [{ type: "text" as const, text: `# Epistemic Status Report — ${proj.name}\n\n## Distribuição\n${dist}\n\n## Memórias Contestadas\n${contestedList}` }] };
      }

      if (!memory_id) {
        return { content: [{ type: "text" as const, text: `Ação "${action}" requer memory_id.` }] };
      }

      const mem = await prisma.memory.findFirst({ where: { id: memory_id, projectId: proj.id } });
      if (!mem) return { content: [{ type: "text" as const, text: `Memória ${memory_id} não encontrada neste projeto.` }] };

      if (action === "promote") {
        const next = mem.epistemicStatus === "HYPOTHESIS" ? "VALIDATED"
          : mem.epistemicStatus === "CONTESTED" ? "VALIDATED"
          : null;
        if (!next) return { content: [{ type: "text" as const, text: `Status ${mem.epistemicStatus} não pode ser promovido.` }] };
        await prisma.memory.update({
          where: { id: memory_id },
          data: { epistemicStatus: next as never, validatedCount: { increment: 1 } },
        });
        return { content: [{ type: "text" as const, text: `Memória "${mem.title}" promovida: ${mem.epistemicStatus} → ${next}` }] };
      }

      if (action === "demote") {
        const next = mem.epistemicStatus === "VALIDATED" ? "CONTESTED"
          : mem.epistemicStatus === "CONTESTED" ? "DEPRECATED"
          : null;
        if (!next) return { content: [{ type: "text" as const, text: `Status ${mem.epistemicStatus} não pode ser rebaixado.` }] };
        await prisma.memory.update({ where: { id: memory_id }, data: { epistemicStatus: next as never } });
        return { content: [{ type: "text" as const, text: `Memória "${mem.title}" rebaixada: ${mem.epistemicStatus} → ${next}` }] };
      }

      if (action === "contest") {
        await prisma.memory.update({
          where: { id: memory_id },
          data: { epistemicStatus: "CONTESTED" as never },
        });
        const note = reason ? `\n\nRazão da contestação: ${reason}` : "";
        return { content: [{ type: "text" as const, text: `Memória "${mem.title}" marcada como CONTESTED.${note}` }] };
      }

      return { content: [{ type: "text" as const, text: "Ação inválida." }] };
    }
  );

  // ── Tool 2: brain_causal_discover ────────────────────────────────────────────
  server.tool(
    "brain_causal_discover",
    "Descobre relações CAUSES automaticamente analisando padrões de co-acesso nos logs dos últimos 90 dias",
    {
      project_slug:    z.string().describe("Slug do projeto"),
      dry_run:         z.boolean().default(false).describe("true = só mostra, não salva"),
      window_minutes:  z.number().default(30).describe("Janela de tempo para co-acesso (minutos)"),
      min_confidence:  z.number().default(0.65).describe("Confiança mínima P(B|A)"),
    },
    async ({ project_slug, dry_run, window_minutes, min_confidence }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project_slug } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project_slug}" não encontrado.` }] };

      const logs = await prisma.$queryRaw<{ memory_id: string; accessed_at: Date }[]>`
        SELECT memory_id, accessed_at::timestamp FROM memory_access_logs
        WHERE project_id = ${proj.id}
          AND accessed_at > NOW() - INTERVAL '90 days'
        ORDER BY accessed_at ASC
      `;

      if (logs.length < 2) {
        return { content: [{ type: "text" as const, text: "Logs insuficientes para análise causal (mínimo 2 acessos)." }] };
      }

      // Contar co-acessos: para cada (A, B) onde B foi acessado dentro de window_minutes após A
      const windowMs = window_minutes * 60 * 1000;
      const coAccess = new Map<string, number>(); // "A|B" -> count
      const totalByA = new Map<string, number>(); // A -> total acessos

      for (let i = 0; i < logs.length; i++) {
        const a = logs[i];
        totalByA.set(a.memory_id, (totalByA.get(a.memory_id) ?? 0) + 1);
        for (let j = i + 1; j < logs.length; j++) {
          const b = logs[j];
          const diff = b.accessed_at.getTime() - a.accessed_at.getTime();
          if (diff > windowMs) break;
          if (b.memory_id !== a.memory_id) {
            const key = `${a.memory_id}|${b.memory_id}`;
            coAccess.set(key, (coAccess.get(key) ?? 0) + 1);
          }
        }
      }

      // Calcular P(B|A) e filtrar candidatos
      const candidates: { fromId: string; toId: string; confidence: number; coCount: number }[] = [];
      for (const [key, coCount] of coAccess.entries()) {
        if (coCount < 3) continue;
        const [fromId, toId] = key.split("|");
        const totalA = totalByA.get(fromId) ?? 1;
        const confidence = coCount / totalA;
        if (confidence >= min_confidence) {
          candidates.push({ fromId, toId, confidence, coCount });
        }
      }

      candidates.sort((a, b) => b.confidence - a.confidence);

      if (candidates.length === 0) {
        return { content: [{ type: "text" as const, text: `Nenhum par com P(B|A) >= ${min_confidence} e co-acessos >= 3 encontrado.` }] };
      }

      let created = 0;
      if (!dry_run) {
        for (const c of candidates) {
          try {
            await prisma.memoryLink.upsert({
              where: { fromId_toId_relation: { fromId: c.fromId, toId: c.toId, relation: "CAUSES" as never } },
              create: { fromId: c.fromId, toId: c.toId, relation: "CAUSES" as never, confidence: c.confidence, weight: c.confidence },
              update: { confidence: c.confidence, weight: c.confidence },
            });
            created++;
          } catch {}
        }
      }

      // Buscar títulos dos top 5
      const top5 = candidates.slice(0, 5);
      const ids = [...new Set(top5.flatMap(c => [c.fromId, c.toId]))];
      const memTitles = await prisma.memory.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      });
      const titleMap = new Map(memTitles.map(m => [m.id, m.title]));

      const top5Lines = top5.map(c =>
        `  ${titleMap.get(c.fromId) ?? c.fromId} → ${titleMap.get(c.toId) ?? c.toId} (P=${(c.confidence * 100).toFixed(0)}%, co=${c.coCount}×)`
      ).join("\n");

      const header = dry_run
        ? `# brain_causal_discover (dry run) — ${candidates.length} candidatos\n`
        : `# brain_causal_discover — ${created} links CAUSES criados\n`;

      return { content: [{ type: "text" as const, text: `${header}\n## Top 5 pares causais\n${top5Lines}` }] };
    }
  );

  // ── Tool 3: brain_predict_context ────────────────────────────────────────────
  server.tool(
    "brain_predict_context",
    "Prediz quais memórias você precisará agora baseado em padrões horários/diários de acesso",
    {
      project_slug: z.string().describe("Slug do projeto"),
    },
    async ({ project_slug }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project_slug } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project_slug}" não encontrado.` }] };

      const now = new Date();
      const dayOfWeek = now.getDay();
      const hourOfDay = now.getHours();

      const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

      const preds = await prisma.$queryRaw<{ memory_id: string; freq: bigint; title: string; type: string; epistemic_status: string }[]>`
        SELECT mal.memory_id, COUNT(*) as freq, m.title, m.type::text, m.epistemic_status::text
        FROM memory_access_logs mal
        JOIN memories m ON mal.memory_id = m.id
        WHERE mal.project_id = ${proj.id}
          AND mal.day_of_week = ${dayOfWeek}
          AND ABS(mal.hour_of_day - ${hourOfDay}) <= 1
          AND m.epistemic_status != 'DEPRECATED'
        GROUP BY mal.memory_id, m.title, m.type, m.epistemic_status
        HAVING COUNT(*) >= 2
        ORDER BY freq DESC
        LIMIT 5
      `;

      if (preds.length === 0) {
        return { content: [{ type: "text" as const, text: `# brain_predict_context\n\nAinda não há dados suficientes para predições em ${DAYS[dayOfWeek]} às ${hourOfDay}h.\n\nAcesse mais memórias para o sistema aprender seus padrões.` }] };
      }

      const lines = preds.map((p, i) =>
        `${i + 1}. [${p.type}] **${p.title}** (${p.epistemic_status}) — ${Number(p.freq)} acessos neste horário`
      ).join("\n");

      const topTypes = [...new Set(preds.map(p => p.type))].join(", ");

      return {
        content: [{
          type: "text" as const,
          text: `# 🔮 brain_predict_context — ${DAYS[dayOfWeek]} ${hourOfDay}h\n\n## Previsão para este momento\n\n${lines}\n\n## Tendência\nAs ${hourOfDay}h de ${DAYS[dayOfWeek]}, você costuma trabalhar em: **${topTypes}**`,
        }],
      };
    }
  );

  // ── Tool 4: brain_cross_transfer ─────────────────────────────────────────────
  server.tool(
    "brain_cross_transfer",
    "Busca conhecimento em outros projetos quando o projeto atual não tem resposta suficiente",
    {
      source_project: z.string().describe("Slug do projeto de origem (será excluído da busca)"),
      query:          z.string().describe("Query semântica para buscar"),
      min_similarity: z.number().default(0.78).describe("Similaridade mínima (0-1)"),
      max_results:    z.number().default(6).describe("Máximo de resultados"),
    },
    async ({ source_project, query, min_similarity, max_results }) => {
      const sourceProj = await prisma.project.findUnique({ where: { slug: source_project } });
      const allProjects = await prisma.project.findMany({
        where: { slug: { not: source_project } },
        select: { id: true, name: true, slug: true },
      });

      if (allProjects.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhum outro projeto disponível para transferência de conhecimento." }] };
      }

      const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: query });
      const vec = `[${embRes.data[0].embedding.join(",")}]`;
      const minSim = min_similarity;

      const allResults: { projectName: string; projectSlug: string; id: string; title: string; content: string; type: string; similarity: number }[] = [];

      for (const p of allProjects) {
        try {
          const rows = await prisma.$queryRaw<{ id: string; title: string; content: string; type: string; similarity: number }[]>`
            SELECT id, title, content, type::text,
              (1 - (embedding <=> ${vec}::vector))::float AS similarity
            FROM memories
            WHERE project_id = ${p.id}
              AND embedding IS NOT NULL
              AND (1 - (embedding <=> ${vec}::vector)) >= ${minSim}
            ORDER BY embedding <=> ${vec}::vector
            LIMIT 3
          `;
          for (const r of rows) {
            allResults.push({ ...r, projectName: p.name, projectSlug: p.slug });
          }
        } catch {}
      }

      if (allResults.length === 0) {
        return { content: [{ type: "text" as const, text: `Nenhum resultado com similaridade >= ${(minSim * 100).toFixed(0)}% em outros projetos.` }] };
      }

      allResults.sort((a, b) => b.similarity - a.similarity);
      const top = allResults.slice(0, max_results);

      const srcName = sourceProj?.name ?? source_project;
      const lines = top.map((r, i) =>
        `## ${i + 1}. [TRANSFER from ${r.projectName}] [${r.type}] ${r.title}\n` +
        `Similaridade: ${(r.similarity * 100).toFixed(0)}% | Projeto: ${r.projectSlug}\n\n${r.content}`
      ).join("\n\n---\n\n");

      return {
        content: [{
          type: "text" as const,
          text: `# brain_cross_transfer — "${query}"\nBuscando fora de "${srcName}"\n\n${lines}`,
        }],
      };
    }
  );

  // ── Tool 5: brain_infer ──────────────────────────────────────────────────────
  server.tool(
    "brain_infer",
    "Inferência zero-shot: atravessa o grafo de links para responder sem memória direta",
    {
      project_slug: z.string().describe("Slug do projeto"),
      query:        z.string().describe("Pergunta a ser respondida por inferência"),
      max_hops:     z.number().default(2).describe("Máximo de saltos no grafo (1-3)"),
    },
    async ({ project_slug, query, max_hops }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project_slug } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project_slug}" não encontrado.` }] };

      // Fase 1: busca semântica para seeds
      const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: query });
      const vec = `[${embRes.data[0].embedding.join(",")}]`;

      const seeds = await prisma.$queryRaw<{ id: string; title: string; content: string; type: string; similarity: number }[]>`
        SELECT id, title, content, type::text,
          (1 - (embedding <=> ${vec}::vector))::float AS similarity
        FROM memories
        WHERE project_id = ${proj.id}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector
        LIMIT 3
      `;

      if (seeds.length === 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ inferred: false, reason: "Sem memórias relevantes" }) }] };
      }

      // Fase 2: WITH RECURSIVE — traversal completo em 1 query, com cycle detection nativo
      const seedIds = seeds.map((s: {id: string}) => s.id);
      const maxHopsVal = Number(max_hops ?? 2);

      const chainRows = await prisma.$queryRaw<{
        id: string; title: string; content: string; type: string; depth: number; via: string;
      }[]>`
        WITH RECURSIVE graph_walk(id, title, content, type, depth, via, path) AS (
          SELECT m.id, m.title, m.content, m.type::text, 0, 'direct'::text, ARRAY[m.id]
          FROM memories m
          WHERE m.id = ANY(${seedIds}::text[])
            AND m.project_id = ${proj.id}

          UNION ALL

          SELECT
            next_m.id, next_m.title, next_m.content, next_m.type::text,
            gw.depth + 1,
            ml.relation::text || ' from "' || gw.title || '"',
            gw.path || next_m.id
          FROM graph_walk gw
          JOIN memory_links ml ON (
            (ml.from_id = gw.id AND ml.relation::text IN ('EXTENDS','DEPENDS_ON','EXAMPLE_OF','CAUSES'))
            OR
            (ml.to_id = gw.id AND ml.relation::text IN ('DEPENDS_ON','EXTENDS'))
          )
          JOIN memories next_m ON (
            CASE WHEN ml.from_id = gw.id THEN next_m.id = ml.to_id
                 ELSE next_m.id = ml.from_id END
          )
          WHERE gw.depth < ${maxHopsVal}
            AND NOT (next_m.id = ANY(gw.path))
            AND next_m.project_id = ${proj.id}
            AND next_m.epistemic_status::text != 'DEPRECATED'
        )
        SELECT DISTINCT ON (id) id, title, content, type, depth, via
        FROM graph_walk
        ORDER BY id, depth ASC
      `;

      const allMems = chainRows;
      const path: string[] = seeds.map((s: {title: string}) => s.title);

      // Adicionar títulos de memórias expandidas ao path
      for (const m of allMems) {
        if (!seeds.find((s: {id: string}) => s.id === m.id)) {
          path.push(`[via grafo] ${m.title}`);
        }
      }

      const chainText = allMems.map(m =>
        `[${m.type}] ${m.title}:\n${m.content.slice(0, 500)}${m.content.length > 500 ? "…" : ""}`
      ).join("\n\n---\n\n");

      // Fase 3: GPT-4o-mini raciocina sobre a chain
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a reasoning engine traversing a knowledge graph. Use the provided memory chain to infer an answer. Be explicit about what is directly known vs inferred. Respond in the same language as the query.",
          },
          {
            role: "user",
            content: `Query: ${query}\n\nKnowledge chain (${allMems.length} memories, ${max_hops} hops):\n\n${chainText}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 600,
      });

      const answer = completion.choices[0]?.message?.content ?? "Não foi possível inferir uma resposta.";

      // Estimar confiança baseada na similaridade das seeds
      const avgSim = seeds.reduce((s: number, r: {similarity: number}) => s + r.similarity, 0) / seeds.length;
      const confidence = Math.min(0.99, avgSim * (allMems.length > seeds.length ? 1.15 : 1.0));

      const result = {
        answer,
        confidence: parseFloat(confidence.toFixed(2)),
        chainLength: allMems.length,
        path,
        reasoning: `Partiu de ${seeds.length} seeds semânticas, expandiu para ${allMems.length} memórias em ${maxHopsVal} salto(s).`,
      };

      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Tool 6: brain_consensus ──────────────────────────────────────────────────
  server.tool(
    "brain_consensus",
    "Debate multi-agente: 2 GPTs debatem memórias conflitantes e um árbitro sintetiza",
    {
      project_slug: z.string().describe("Slug do projeto"),
      memory_ids:   z.array(z.string()).min(2).max(5).describe("IDs das memórias para debate (2-5)"),
      dry_run:      z.boolean().default(false).describe("true = só mostra resultado sem salvar"),
    },
    async ({ project_slug, memory_ids, dry_run }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project_slug } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project_slug}" não encontrado.` }] };

      // Busca e valida que todas pertencem ao projeto
      const memories = await prisma.memory.findMany({
        where: { id: { in: memory_ids }, projectId: proj.id },
        select: { id: true, title: true, content: true, type: true, epistemicStatus: true },
      });

      if (memories.length < 2) {
        return { content: [{ type: "text" as const, text: `Apenas ${memories.length} memória(s) encontradas neste projeto dos IDs fornecidos.` }] };
      }

      const memoriesText = memories.map((m, i) =>
        `Memória ${i + 1} [${m.type}] "${m.title}" (${m.epistemicStatus}):\n${m.content}`
      ).join("\n\n---\n\n");

      // Rodar 2 agentes em paralelo
      const [criticResult, synthResult] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Você é um agente crítico. Analise as memórias fornecidas e identifique contradições, inconsistências e conflitos. Seja específico e cite trechos." },
            { role: "user", content: `Analise criticamente estas memórias:\n\n${memoriesText}` },
          ],
          temperature: 0.4,
          max_tokens: 500,
        }),
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Você é um agente sintetizador. Analise as memórias fornecidas e encontre pontos em comum, complementaridades e como elas se reforçam mutuamente." },
            { role: "user", content: `Sintetize os pontos convergentes destas memórias:\n\n${memoriesText}` },
          ],
          temperature: 0.4,
          max_tokens: 500,
        }),
      ]);

      const criticOutput = criticResult.choices[0]?.message?.content ?? "";
      const synthOutput = synthResult.choices[0]?.message?.content ?? "";

      // Árbitro sintetiza com base nos outputs dos outros dois
      const arbiterResult = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Você é um árbitro de conhecimento. Com base na análise crítica e na síntese fornecidas, crie uma memória consolidada em JSON com os campos:
{
  "title": "título conciso da memória consolidada",
  "content": "conteúdo completo e estruturado que resolve os conflitos",
  "epistemic_status": "VALIDATED" ou "CONTESTED",
  "conflicts_resolved": ["lista de conflitos resolvidos"],
  "key_insights": ["lista de insights-chave extraídos"]
}
Responda APENAS com o JSON.`,
          },
          {
            role: "user",
            content: `Memórias originais:\n${memoriesText}\n\nAnálise Crítica:\n${criticOutput}\n\nSíntese:\n${synthOutput}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 800,
      });

      const arbiterText = arbiterResult.choices[0]?.message?.content ?? "{}";
      let arbiterJSON: {
        title: string;
        content: string;
        epistemic_status: string;
        conflicts_resolved: string[];
        key_insights: string[];
      };
      try {
        arbiterJSON = JSON.parse(arbiterText);
      } catch {
        return { content: [{ type: "text" as const, text: `Erro ao parsear resposta do árbitro:\n${arbiterText}` }] };
      }

      if (dry_run) {
        return {
          content: [{
            type: "text" as const,
            text: `# brain_consensus (dry run)\n\n## Análise Crítica\n${criticOutput}\n\n## Síntese\n${synthOutput}\n\n## Árbitro — Resultado proposto\n${JSON.stringify(arbiterJSON, null, 2)}\n\n_Use dry_run: false para criar a memória consolidada._`,
          }],
        };
      }

      // Criar nova memória BRAIN com título prefixado
      const newMem = await prisma.memory.create({
        data: {
          projectId: proj.id,
          type: "BRAIN",
          title: `⚖ ${arbiterJSON.title ?? "Consenso"}`,
          content: arbiterJSON.content ?? "",
          tags: ["consensus", "brain_consensus"],
          importance: 4,
          epistemicStatus: (arbiterJSON.epistemic_status === "VALIDATED" ? "VALIDATED" : "CONTESTED") as never,
        },
      });

      // Criar links SUPERSEDES da nova para cada original (skipDuplicates evita erros Prisma)
      const supersedes = memories
        .map(m => ({ fromId: newMem.id, toId: m.id, relation: "SUPERSEDES" as never }))
        .filter(l => l.fromId !== l.toId);
      if (supersedes.length > 0) {
        await prisma.memoryLink.createMany({ data: supersedes, skipDuplicates: true });
      }

      return {
        content: [{
          type: "text" as const,
          text: `# brain_consensus — Consenso criado\n\n**[BRAIN] ${newMem.title}**\nID: \`${newMem.id}\`\nStatus: ${arbiterJSON.epistemic_status}\n\n${arbiterJSON.content}\n\n## Conflitos resolvidos\n${(arbiterJSON.conflicts_resolved ?? []).map(c => `- ${c}`).join("\n")}\n\n## Insights-chave\n${(arbiterJSON.key_insights ?? []).map(k => `- ${k}`).join("\n")}`,
        }],
      };
    }
  );
}
