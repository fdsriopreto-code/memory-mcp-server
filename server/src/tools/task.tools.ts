import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { logAudit } from "./audit.js";

export function registerTaskTools(server: McpServer) {

  server.tool(
    "task_create",
    "Cria uma task/lembrete para o projeto",
    {
      project:     z.string(),
      title:       z.string(),
      description: z.string().optional(),
      priority:    z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).default("MEDIUM"),
    },
    async ({ project, title, description, priority }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };
      const task = await prisma.task.create({ data: { projectId: proj.id, title, description, priority } });
      await logAudit(proj.id, "task_create", { project, title }, task.id);
      return { content: [{ type: "text" as const, text: `Task criada! ID: ${task.id}` }] };
    }
  );

  server.tool(
    "task_list",
    "Lista tasks de um projeto",
    {
      project: z.string(),
      status:  z.enum(["OPEN","IN_PROGRESS","DONE","CANCELLED"]).optional(),
    },
    async ({ project, status }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const tasks = await prisma.task.findMany({
        where: { projectId: proj.id, ...(status ? { status } : {}) },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });

      await logAudit(proj.id, "task_list", { project, status }, `${tasks.length} tasks`);

      const text = tasks.map(t =>
        `[${t.id}] [${t.priority}] [${t.status}] ${t.title}${t.description ? ` — ${t.description}` : ""}`
      ).join("\n");
      return { content: [{ type: "text" as const, text: text || "Nenhuma task." }] };
    }
  );

  server.tool(
    "task_update",
    "Atualiza o status de uma task",
    {
      id:     z.string(),
      status: z.enum(["OPEN","IN_PROGRESS","DONE","CANCELLED"]),
    },
    async ({ id, status }) => {
      const task = await prisma.task.update({ where: { id }, data: { status } });
      await logAudit(task.projectId, "task_update", { id, status }, `Task ${id} → ${status}`);
      return { content: [{ type: "text" as const, text: `Task ${id} → ${status}` }] };
    }
  );
}
