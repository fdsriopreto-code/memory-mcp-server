import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { logAudit } from "./audit.js";

export function registerAuditTools(server: McpServer) {

  server.tool(
    "audit_log_search",
    "Busca no histórico de atividade — veja o que foi feito, quando e em qual projeto. Útil para revisar ações recentes ou auditar uma sessão.",
    {
      project: z.string().optional().describe("Filtrar por slug do projeto (omita para todos)"),
      tool:    z.string().optional().describe("Filtrar por ferramenta (ex: memory_add, task_create)"),
      limit:   z.number().min(1).max(50).default(20).describe("Número de registros"),
    },
    async ({ project, tool, limit }) => {
      let projectId: string | undefined;
      if (project) {
        const proj = await prisma.project.findUnique({ where: { slug: project } });
        if (!proj) return { content: [{ type: "text" as const, text: `Projeto "${project}" não encontrado.` }] };
        projectId = proj.id;
      }

      const logs = await prisma.auditLog.findMany({
        where: {
          ...(projectId ? { projectId } : {}),
          ...(tool ? { tool: { contains: tool, mode: "insensitive" } } : {}),
        },
        include: { project: { select: { name: true, slug: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      await logAudit(null, "audit_log_search", { project, tool, limit }, `${logs.length} registros`);

      if (logs.length === 0) return { content: [{ type: "text" as const, text: "Nenhuma atividade encontrada." }] };

      const text = logs.map(l => {
        const ts = new Date(l.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        const proj = l.project ? `[${l.project.slug}]` : "[global]";
        const out = l.outputSummary ? ` → ${l.outputSummary}` : "";
        return `${ts} ${proj} ${l.tool}${out}`;
      }).join("\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
