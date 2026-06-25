import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { getEmbedding } from "../services/embedding.service.js";
import { logAudit } from "./audit.js";
import { Prisma } from "@prisma/client";
import OpenAI from "openai";
import { readdirSync, statSync } from "fs";
import { join, extname, relative } from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export function registerBrain3Tools(server: McpServer) {

  // ── brain_interview ───────────────────────────────────────────────────────────
  server.tool(
    "brain_interview",
    "Analisa lacunas no conhecimento do projeto e gera perguntas específicas para preencher os buracos — a IA detecta o que NÃO está documentado e pergunta proativamente",
    {
      project: z.string().describe("Slug do projeto"),
      focus:   z.string().optional().describe("Área específica a investigar (opcional)"),
    },
    async ({ project, focus }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id },
        select: { type: true, title: true, content: true, tags: true, importance: true },
        orderBy: [{ importance: "desc" }],
        take: 80,
      });

      if (memories.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhuma memória encontrada. Adicione memórias primeiro com memory_add ou brain_learn." }] };
      }

      const memSummary = memories.map(m =>
        `[${m.type}] ${m.title} (imp:${m.importance}) tags:${m.tags.join(",")}`
      ).join("\n");

      const prompt = `Você é um auditor de conhecimento de software. Analise este inventário de memórias do projeto "${proj.name}"${focus ? ` (foco: ${focus})` : ""} e identifique:

1. LACUNAS CRÍTICAS: o que parece estar faltando que seria importante documentar
2. INCONSISTÊNCIAS: memórias que parecem contraditórias ou desatualizadas
3. BLIND SPOTS: áreas do projeto que não têm nenhuma memória

Inventário atual (${memories.length} memórias):
${memSummary}

Gere EXATAMENTE 8 perguntas específicas e acionáveis para preencher as lacunas mais críticas. Cada pergunta deve começar com "❓" e ser direta o suficiente para que eu responda em 2-3 sentenças. Priorize as mais impactantes.`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
      });

      const questions = resp.choices[0].message.content ?? "Sem perguntas geradas.";
      await logAudit(proj.id, "brain_interview", { project, focus }, `${questions.split("❓").length - 1} perguntas geradas`);

      return { content: [{ type: "text" as const, text: `# 🎤 Brain Interview — ${proj.name}\n\n${focus ? `**Foco:** ${focus}\n\n` : ""}${questions}\n\n---\n_Responda cada pergunta e use brain_learn() para absorver suas respostas._` }] };
    }
  );

  // ── brain_vaccinate ───────────────────────────────────────────────────────────
  server.tool(
    "brain_vaccinate",
    "Gera automaticamente Memory Anchors de prevenção a partir das memórias de BUG_FIX — cria gatilhos que disparam ANTES de você repetir um erro clássico",
    {
      project: z.string().describe("Slug do projeto"),
      dry_run: z.boolean().default(true).describe("true = mostra o que seria criado sem salvar"),
    },
    async ({ project, dry_run }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const bugFixes = await prisma.memory.findMany({
        where: { projectId: proj.id, type: "BUG_FIX" },
        select: { id: true, title: true, content: true, importance: true, tags: true },
        orderBy: { importance: "desc" },
        take: 30,
      });

      if (bugFixes.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhuma memória BUG_FIX encontrada. Adicione memórias de bugs para gerar vacinas." }] };
      }

      const prompt = `Para cada bug abaixo, extraia:
1. Uma KEYWORD de 1-3 palavras que um desenvolvedor digitaria ANTES de cometer este erro
2. Uma mensagem de aviso curta e direta (max 80 chars) baseada no bug

Retorne JSON array: [{"keyword": "...", "warning": "...", "memoryTitle": "..."}]

Bugs:
${bugFixes.map((b, i) => `${i+1}. ${b.title}\n${b.content.slice(0, 200)}`).join("\n\n")}`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1000,
      });

      let vaccines: { keyword: string; warning: string; memoryTitle: string }[] = [];
      try {
        const parsed = JSON.parse(resp.choices[0].message.content ?? "{}");
        vaccines = parsed.vaccines ?? parsed.items ?? parsed.list ?? Object.values(parsed)[0] ?? [];
      } catch { vaccines = []; }

      if (vaccines.length === 0) {
        return { content: [{ type: "text" as const, text: "Não foi possível extrair vacinas dos bugs encontrados." }] };
      }

      if (dry_run) {
        const preview = vaccines.map((v, i) =>
          `**${i+1}. Keyword:** \`${v.keyword}\`\n   ⚠️ ${v.warning}\n   _Baseado em: "${v.memoryTitle}"_`
        ).join("\n\n");
        return { content: [{ type: "text" as const, text: `# 💉 Brain Vaccinate — Dry Run\n\n${vaccines.length} vacinas geradas a partir de ${bugFixes.length} bugs:\n\n${preview}\n\n---\n_Use dry_run: false para criar os anchors._` }] };
      }

      // Criar anchors
      const created: string[] = [];
      for (const v of vaccines) {
        const bugMem = bugFixes.find(b => b.title.toLowerCase().includes(v.memoryTitle.toLowerCase().slice(0, 20))) ?? bugFixes[0];
        try {
          await (prisma as any).memoryAnchor.create({
            data: {
              projectId: proj.id,
              name: `💉 ${v.keyword}`,
              description: `Anti-padrão automático — ${v.warning}`,
              pattern: v.keyword,
              patternType: "KEYWORD",
              memoryIds: [bugMem.id],
              priority: 5,
            },
          });
          created.push(v.keyword);
        } catch {}
      }

      await logAudit(proj.id, "brain_vaccinate", { project }, `${created.length} vacinas criadas`);
      return { content: [{ type: "text" as const, text: `# 💉 Vacinação Completa!\n\n${created.length} anchors de prevenção criados:\n${created.map(k => `- \`${k}\``).join("\n")}\n\nAgora quando você mencionar estas palavras em qualquer busca, a memória do bug vai ser injetada automaticamente.` }] };
    }
  );

  // ── brain_review ─────────────────────────────────────────────────────────────
  server.tool(
    "brain_review",
    "Code review baseado em memória institucional — analisa arquivos ou diff alterados, busca memórias relevantes e gera checklist contextual com armadilhas conhecidas",
    {
      project:       z.string().describe("Slug do projeto"),
      changed_files: z.array(z.string()).describe("Lista de arquivos alterados (ex: ['src/auth/login.ts', 'src/payments/webhook.ts'])"),
      diff_summary:  z.string().optional().describe("Resumo do diff ou descrição das mudanças (opcional, enriquece o contexto)"),
    },
    async ({ project, changed_files, diff_summary }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      // Extrair módulos/termos dos file paths
      const modules = changed_files.flatMap(f => {
        const parts = f.replace(/\\/g, "/").split("/");
        return parts.filter(p => !p.includes(".") || p.endsWith(".ts") || p.endsWith(".tsx"));
      });
      const searchTerms = [...new Set(modules)].slice(0, 8);

      // Buscar memórias relevantes para cada módulo
      const relevantMemories: Map<string, { title: string; content: string; type: string; importance: number }> = new Map();

      for (const term of searchTerms) {
        try {
          const emb = await getEmbedding(term);
          const rows = await prisma.$queryRaw<{ id: string; title: string; content: string; type: string; importance: number; similarity: number }[]>`
            SELECT id, title, content, type::text, importance,
                   1 - (embedding <=> ${`[${emb.join(",")}]`}::vector) AS similarity
            FROM memories
            WHERE project_id = ${proj.id} AND embedding IS NOT NULL
            ORDER BY embedding <=> ${`[${emb.join(",")}]`}::vector
            LIMIT 4
          `;
          rows.filter(r => r.similarity > 0.65).forEach(r => relevantMemories.set(r.id, r));
        } catch {}
      }

      // Adicionar BUG_FIX memories sempre
      const bugFixes = await prisma.memory.findMany({
        where: { projectId: proj.id, type: "BUG_FIX", importance: { gte: 3 } },
        select: { id: true, title: true, content: true, type: true, importance: true },
        orderBy: { importance: "desc" },
        take: 10,
      });
      bugFixes.forEach(b => relevantMemories.set(b.id, b));

      const memList = [...relevantMemories.values()];

      const prompt = `Você é um revisor de código experiente com conhecimento da memória institucional do projeto "${proj.name}".

Arquivos alterados: ${changed_files.join(", ")}
${diff_summary ? `\nMudanças: ${diff_summary}\n` : ""}
Memórias institucionais relevantes (${memList.length}):
${memList.map(m => `[${m.type} imp:${m.importance}] ${m.title}: ${m.content.slice(0, 250)}`).join("\n\n")}

Gere um code review checklist ESPECÍFICO com:
1. ⚠️ Riscos conhecidos (baseado nos bugs anteriores) — o que PODE quebrar
2. ✅ Padrões obrigatórios para os módulos alterados
3. 🔍 O que verificar manualmente antes de fazer merge
4. 💡 Contexto relevante que pode ter sido esquecido

Seja direto e específico. Máximo 15 itens no total.`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
      });

      const review = resp.choices[0].message.content ?? "Review não gerado.";
      await logAudit(proj.id, "brain_review", { project, files: changed_files.length }, `Review com ${memList.length} memórias`);

      return { content: [{ type: "text" as const, text: `# 🔍 Brain Code Review\n\n**Arquivos:** ${changed_files.join(", ")}\n**Memórias consultadas:** ${memList.length}\n\n${review}` }] };
    }
  );

  // ── brain_export ──────────────────────────────────────────────────────────────
  server.tool(
    "brain_export",
    "Exporta o estado completo do cérebro como JSON estruturado — pode ser versionado junto com o código como brain.snapshot.json",
    {
      project: z.string().describe("Slug do projeto"),
      format:  z.enum(["json", "markdown"]).default("json").describe("Formato de saída"),
      include_embeddings: z.boolean().default(false).describe("Incluir vetores de embedding (aumenta muito o tamanho)"),
    },
    async ({ project, format, include_embeddings }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const [memories, links, tasks, anchors] = await Promise.all([
        prisma.memory.findMany({
          where: { projectId: proj.id },
          select: {
            id: true, type: true, title: true, content: true, tags: true,
            importance: true, isPinned: true, epistemicStatus: true, driftScore: true,
            createdAt: true, updatedAt: true,
          },
          orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        }),
        prisma.memoryLink.findMany({
          where: { from: { projectId: proj.id } },
          select: { fromId: true, toId: true, relation: true },
        }),
        prisma.task.findMany({
          where: { projectId: proj.id },
          select: { title: true, description: true, status: true, priority: true, tags: true, createdAt: true },
        }),
        (prisma as any).memoryAnchor.findMany({
          where: { projectId: proj.id, isActive: true },
          select: { name: true, pattern: true, patternType: true, memoryIds: true, priority: true },
        }),
      ]);

      const snapshot = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        project: { name: proj.name, slug: proj.slug, description: proj.description },
        stats: { memories: memories.length, links: links.length, tasks: tasks.length, anchors: anchors.length },
        memories,
        links,
        tasks,
        anchors,
      };

      if (format === "markdown") {
        const pinned = memories.filter(m => m.isPinned);
        const byType = memories.reduce((acc, m) => {
          if (!acc[m.type]) acc[m.type] = [];
          acc[m.type].push(m);
          return acc;
        }, {} as Record<string, typeof memories>);

        let md = `# Brain Snapshot — ${proj.name}\n\n`;
        md += `> Exportado em ${new Date().toLocaleDateString("pt-BR")} · ${memories.length} memórias · ${anchors.length} anchors\n\n`;

        if (pinned.length) {
          md += `## 📌 Memórias Pinadas\n\n`;
          pinned.forEach(m => { md += `### [${m.type}] ${m.title} (imp:${m.importance}/5)\n${m.content}\n\n`; });
        }

        Object.entries(byType).forEach(([type, mems]) => {
          md += `## ${type} (${mems.length})\n\n`;
          mems.slice(0, 20).forEach(m => { md += `### ${m.title} (imp:${m.importance}/5)\n${m.content.slice(0, 500)}${m.content.length > 500 ? "…" : ""}\n\n`; });
          if (mems.length > 20) md += `_...e mais ${mems.length - 20} memórias_\n\n`;
        });

        await logAudit(proj.id, "brain_export", { project, format }, `${memories.length} memórias exportadas`);
        return { content: [{ type: "text" as const, text: md }] };
      }

      await logAudit(proj.id, "brain_export", { project, format }, `${memories.length} memórias exportadas`);
      return { content: [{ type: "text" as const, text: JSON.stringify(snapshot, null, 2) }] };
    }
  );

  // ── brain_prewarm ──────────────────────────────────────────────────────────────
  server.tool(
    "brain_prewarm",
    "Pré-carrega contexto relevante para uma lista de arquivos — simula o que um desenvolvedor precisa saber antes de tocar nesses módulos. Use ao abrir arquivos no editor para ter contexto instantâneo.",
    {
      project:    z.string().describe("Slug do projeto"),
      file_paths: z.array(z.string()).min(1).max(20).describe("Arquivos que você vai editar (ex: ['src/payments/webhook.ts', 'src/auth/login.ts'])"),
    },
    async ({ project, file_paths }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const allMemories: Map<string, { id: string; title: string; content: string; type: string; importance: number; similarity: number }> = new Map();

      // Busca semântica por arquivo
      for (const filePath of file_paths) {
        const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
        const moduleName = fileName.replace(/\.(ts|tsx|js|jsx|py|go)$/, "");
        const query = `${moduleName} ${filePath.replace(/\\/g, "/").split("/").slice(-3).join(" ")}`;

        try {
          const emb = await getEmbedding(query);
          const rows = await prisma.$queryRaw<{ id: string; title: string; content: string; type: string; importance: number; similarity: number }[]>`
            SELECT id, title, content, type::text, importance,
                   1 - (embedding <=> ${`[${emb.join(",")}]`}::vector) AS similarity
            FROM memories
            WHERE project_id = ${proj.id} AND embedding IS NOT NULL
            ORDER BY embedding <=> ${`[${emb.join(",")}]`}::vector
            LIMIT 3
          `;
          rows.filter(r => r.similarity > 0.6).forEach(r => {
            const existing = allMemories.get(r.id);
            if (!existing || r.similarity > existing.similarity) allMemories.set(r.id, r);
          });
        } catch {}
      }

      // Sempre incluir BUG_FIX de alta importância
      const bugs = await prisma.memory.findMany({
        where: { projectId: proj.id, type: "BUG_FIX", importance: { gte: 4 } },
        select: { id: true, title: true, content: true, type: true, importance: true },
        orderBy: { importance: "desc" },
        take: 5,
      });
      bugs.forEach(b => { if (!allMemories.has(b.id)) allMemories.set(b.id, { ...b, similarity: 0.9 }); });

      const memories = [...allMemories.values()].sort((a, b) => b.importance - a.importance || b.similarity - a.similarity);

      if (memories.length === 0) {
        return { content: [{ type: "text" as const, text: `Nenhum contexto encontrado para os arquivos: ${file_paths.join(", ")}` }] };
      }

      await logAudit(proj.id, "brain_prewarm", { project, files: file_paths.length }, `${memories.length} memórias pré-carregadas`);

      const text = `# 🔥 Brain Pre-Warm\n\n**Arquivos:** ${file_paths.join(", ")}\n**${memories.length} memórias relevantes carregadas:**\n\n` +
        memories.map(m =>
          `## [${m.type}] ${m.title} imp:${m.importance}/5\n${m.content}`
        ).join("\n\n---\n\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
