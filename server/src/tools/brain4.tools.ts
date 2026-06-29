import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync } from "fs";
import { MemoryType } from "@prisma/client";
import { prisma } from "../config/database.js";
import { logAudit } from "./audit.js";

const TYPE_ORDER   = ["ARCHITECTURE", "PATTERN", "DECISION", "BUG_FIX", "CONTEXT", "NOTE", "BRAIN"] as const;
const TYPE_LABELS: Record<string, string> = {
  ARCHITECTURE: "🏗️ Arquitetura",
  PATTERN:      "🔄 Padrões",
  DECISION:     "✅ Decisões",
  BUG_FIX:      "🐛 Bugs Corrigidos (não regredir)",
  CONTEXT:      "📋 Contexto",
  NOTE:         "📝 Notas",
  BRAIN:        "🧠 Brain",
};

export function registerBrain4Tools(server: McpServer) {

  // ── brain_export_claudemd ────────────────────────────────────────────────────
  server.tool(
    "brain_export_claudemd",
    "Exporta o cérebro do projeto como markdown pronto para CLAUDE.md — memórias críticas por tipo (BUG_FIX, PATTERN, DECISION, ARCHITECTURE…) + tasks abertas, ordenadas por importância e pinagem. Opcionalmente grava o arquivo no disco.",
    {
      project:      z.string().describe("Slug do projeto"),
      outputPath:   z.string().optional().describe("Caminho absoluto para gravar o arquivo (omitir = só retorna conteúdo)"),
      maxMemories:  z.number().min(1).max(60).default(25).describe("Máximo de memórias a incluir"),
      includeNotes: z.boolean().default(false).describe("Incluir memórias tipo NOTE (geralmente menos críticas)"),
    },
    async ({ project, outputPath, maxMemories, includeNotes }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const typeFilter = includeNotes
        ? undefined
        : { notIn: [MemoryType.NOTE] };

      const [memories, tasks] = await Promise.all([
        prisma.memory.findMany({
          where: { projectId: proj.id, ...(typeFilter ? { type: typeFilter } : {}) },
          orderBy: [
            { isPinned:    "desc" },
            { importance:  "desc" },
            { accessCount: "desc" },
          ],
          take: maxMemories,
        }),
        prisma.task.findMany({
          where: { projectId: proj.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          take: 15,
          select: { title: true, priority: true, status: true, description: true },
        }),
      ]);

      // Agrupa por tipo
      const byType: Record<string, typeof memories> = {};
      for (const m of memories) {
        (byType[m.type] ??= []).push(m);
      }

      let md = `# ${proj.name} — Contexto para Claude\n\n`;
      md += `> ⚠️ Gerado por \`brain_export_claudemd\` em ${new Date().toISOString().slice(0, 10)}.\n`;
      md += `> ${memories.length} memórias exportadas.\n\n---\n\n`;

      for (const type of TYPE_ORDER) {
        const group = byType[type];
        if (!group?.length) continue;
        md += `## ${TYPE_LABELS[type] ?? type}\n\n`;
        for (const m of group) {
          const pin = m.isPinned ? " 📌" : "";
          md += `### ${m.title}${pin}\n\n`;
          md += `${m.content}\n\n`;
          if (m.tags?.length) md += `*Tags: ${(m.tags as string[]).join(", ")}*\n\n`;
          md += `---\n\n`;
        }
      }

      if (tasks.length > 0) {
        md += `## 📋 Tasks Abertas\n\n`;
        for (const t of tasks) {
          md += `- [${t.priority}] **${t.title}** \`${t.status}\``;
          if (t.description) md += ` — ${t.description.slice(0, 120)}`;
          md += "\n";
        }
        md += "\n";
      }

      await logAudit(project, "brain_export_claudemd", {
        outputPath: outputPath ?? null,
        memoriesExported: memories.length,
        tasksExported: tasks.length,
      });

      if (outputPath) {
        try {
          writeFileSync(outputPath, md, "utf8");
          return {
            content: [{
              type: "text" as const,
              text: `✅ CLAUDE.md exportado em: ${outputPath}\n${memories.length} memórias | ${tasks.length} tasks.\n\nPreview (primeiros 800 chars):\n\`\`\`\n${md.slice(0, 800)}\n\`\`\``,
            }],
          };
        } catch (e) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Erro ao gravar: ${e instanceof Error ? e.message : String(e)}\n\nConteúdo (cole no arquivo manualmente):\n\n${md}`,
            }],
          };
        }
      }

      return { content: [{ type: "text" as const, text: md }] };
    }
  );
}
