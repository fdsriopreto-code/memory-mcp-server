import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { getEmbedding } from "../services/embedding.service.js";
import { logAudit } from "./audit.js";
import { broadcast } from "../ws.js";
import { Prisma } from "@prisma/client";

export function registerAnchorTools(server: McpServer) {

  server.tool(
    "anchor_create",
    "Cria um gatilho automático: quando uma busca/sessão corresponder ao padrão, as memórias vinculadas são injetadas automaticamente no contexto",
    {
      project:     z.string().describe("Slug do projeto"),
      name:        z.string().describe("Nome descritivo do anchor (ex: 'Regras de pagamento')"),
      description: z.string().optional().describe("Para que serve este anchor"),
      pattern:     z.string().describe("Padrão a detectar (palavra-chave, regex ou frase semântica)"),
      patternType: z.enum(["KEYWORD", "REGEX", "SEMANTIC"]).default("KEYWORD")
                   .describe("KEYWORD = contém a palavra | REGEX = expressão regular | SEMANTIC = similaridade semântica"),
      memoryIds:   z.array(z.string()).min(1).max(10).describe("IDs das memórias a injetar quando o padrão for detectado"),
      priority:    z.number().min(1).max(5).default(3).describe("Prioridade de 1 a 5 (5 = sempre injetar)"),
    },
    async ({ project, name, description, pattern, patternType, memoryIds, priority }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      // Validar que todas as memórias existem no projeto
      const memories = await prisma.memory.findMany({
        where: { id: { in: memoryIds }, projectId: proj.id },
        select: { id: true, title: true },
      });
      if (memories.length !== memoryIds.length) {
        const found = memories.map(m => m.id);
        const missing = memoryIds.filter(id => !found.includes(id));
        return { content: [{ type: "text" as const, text: `IDs não encontrados neste projeto: ${missing.join(", ")}` }] };
      }

      const anchor = await (prisma as any).memoryAnchor.create({
        data: {
          projectId: proj.id,
          name,
          description,
          pattern,
          patternType,
          memoryIds,
          priority,
        },
      });

      await logAudit(proj.id, "anchor_create", { project, name, patternType, memoryIds: memoryIds.length }, `Anchor "${name}" criado`);
      broadcast("refresh", { resource: "anchor", projectSlug: project });

      const memoryList = memories.map(m => `  - ${m.title} (${m.id})`).join("\n");
      return { content: [{ type: "text" as const, text: `✅ Anchor criado!\n**ID**: ${anchor.id}\n**Nome**: ${name}\n**Padrão** [${patternType}]: \`${pattern}\`\n**Memórias vinculadas** (${memories.length}):\n${memoryList}\n\nAgora toda vez que uma busca ou sessão corresponder ao padrão, essas memórias serão injetadas automaticamente.` }] };
    }
  );

  server.tool(
    "anchor_list",
    "Lista todos os memory anchors (gatilhos automáticos) de um projeto",
    {
      project:    z.string().describe("Slug do projeto"),
      activeOnly: z.boolean().default(true).describe("true = só ativos | false = todos"),
    },
    async ({ project, activeOnly }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const anchors = await (prisma as any).memoryAnchor.findMany({
        where: { projectId: proj.id, ...(activeOnly ? { isActive: true } : {}) },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });

      if (anchors.length === 0) {
        return { content: [{ type: "text" as const, text: `Nenhum anchor ${activeOnly ? "ativo " : ""}encontrado.\nUse anchor_create() para criar gatilhos automáticos de contexto.` }] };
      }

      await logAudit(proj.id, "anchor_list", { project }, `${anchors.length} anchors`);

      const text = anchors.map((a: any) =>
        `**[${a.id.slice(-8)}] ${a.name}** (prio: ${a.priority}/5, ${a.isActive ? "✅ ativo" : "⏸ inativo"})\n` +
        `  Padrão [${a.patternType}]: \`${a.pattern}\`\n` +
        `  Memórias: ${a.memoryIds.length} | Hits: ${a.hitCount}\n` +
        (a.description ? `  ${a.description}\n` : "")
      ).join("\n");

      return { content: [{ type: "text" as const, text: `# Anchors — ${proj.name}\n\n${text}` }] };
    }
  );

  server.tool(
    "anchor_delete",
    "Remove um memory anchor pelo ID",
    { id: z.string().describe("ID do anchor") },
    async ({ id }) => {
      const anchor = await (prisma as any).memoryAnchor.findUnique({ where: { id } });
      if (!anchor) return { content: [{ type: "text" as const, text: "Anchor não encontrado." }] };
      await (prisma as any).memoryAnchor.delete({ where: { id } });
      await logAudit(anchor.projectId, "anchor_delete", { id }, `Anchor "${anchor.name}" deletado`);
      broadcast("refresh", { resource: "anchor" });
      return { content: [{ type: "text" as const, text: `Anchor "${anchor.name}" (${id}) deletado.` }] };
    }
  );

  server.tool(
    "anchor_trigger",
    "Testa quais anchors seriam ativados por uma query e quais memórias seriam injetadas — útil para depurar seus gatilhos",
    {
      project: z.string().describe("Slug do projeto"),
      query:   z.string().describe("Texto a testar contra os anchors"),
    },
    async ({ project, query }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };

      const anchors = await (prisma as any).memoryAnchor.findMany({
        where: { projectId: proj.id, isActive: true },
        orderBy: { priority: "desc" },
      });

      if (anchors.length === 0) {
        return { content: [{ type: "text" as const, text: "Nenhum anchor ativo neste projeto." }] };
      }

      const matched: { anchor: any; memories: any[] }[] = [];
      const queryLower = query.toLowerCase();

      for (const anchor of anchors) {
        let isMatch = false;

        if (anchor.patternType === "KEYWORD") {
          isMatch = queryLower.includes(anchor.pattern.toLowerCase());
        } else if (anchor.patternType === "REGEX") {
          try {
            isMatch = new RegExp(anchor.pattern, "i").test(query);
          } catch { isMatch = false; }
        } else if (anchor.patternType === "SEMANTIC") {
          try {
            const [qEmb, pEmb] = await Promise.all([
              getEmbedding(query),
              getEmbedding(anchor.pattern),
            ]);
            const dot = qEmb.reduce((s: number, v: number, i: number) => s + v * pEmb[i], 0);
            isMatch = dot > 0.72;
          } catch { isMatch = false; }
        }

        if (isMatch) {
          const memories = await prisma.memory.findMany({
            where: { id: { in: anchor.memoryIds } },
            select: { id: true, title: true, type: true, importance: true },
          });
          matched.push({ anchor, memories });
        }
      }

      if (matched.length === 0) {
        return { content: [{ type: "text" as const, text: `Nenhum anchor ativado para: "${query}"\n\n_${anchors.length} anchors testados, nenhum correspondeu._` }] };
      }

      const allMemoryIds = [...new Set(matched.flatMap(m => m.anchor.memoryIds))];
      const totalMemories = await prisma.memory.findMany({
        where: { id: { in: allMemoryIds } },
        select: { id: true, title: true, type: true, content: true, importance: true },
      });

      let text = `# 🎯 Anchor Trigger Test\n\nQuery: "${query}"\n\n`;
      text += `**${matched.length} anchor(s) ativado(s)**, injetando **${totalMemories.length} memória(s)**:\n\n`;

      for (const { anchor, memories } of matched) {
        text += `## ⚡ ${anchor.name} [${anchor.patternType}]\n`;
        text += `Padrão: \`${anchor.pattern}\` | Prioridade: ${anchor.priority}/5\n\n`;
        if (memories.length > 0) {
          text += memories.map((m: any) => `- [${m.type}] **${m.title}** imp:${m.importance}`).join("\n") + "\n\n";
        }
      }

      text += "---\n**Memórias que seriam injetadas:**\n\n";
      text += totalMemories.map(m =>
        `### [${m.type}] ${m.title} imp:${m.importance}/5\n${m.content}`
      ).join("\n\n---\n\n");

      await logAudit(proj.id, "anchor_trigger", { project, query }, `${matched.length} anchors matched`);
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
