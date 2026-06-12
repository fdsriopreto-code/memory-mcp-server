import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { queryReadOnly, getRedisClient } from "../services/connection.service.js";
import { logAudit } from "./audit.js";

const READ_ONLY_KEYWORDS = /^\s*(select|show|explain|describe|with)\s/i;
const FORBIDDEN = /\b(drop|truncate|delete|update|insert|alter|create|grant|revoke)\b/i;

export function registerDatabaseTools(server: McpServer) {

  // ── Leitura em banco externo ─────────────────────────────────────────────────
  server.tool(
    "db_query",
    "Executa uma consulta SELECT no banco de dados de um projeto (somente leitura)",
    {
      project: z.string().describe("Slug do projeto"),
      connection: z.string().describe("Nome da conexão configurada no projeto"),
      sql: z.string().describe("Query SELECT a executar"),
    },
    async ({ project, connection, sql }) => {
      if (!READ_ONLY_KEYWORDS.test(sql) || FORBIDDEN.test(sql)) {
        return { content: [{ type: "text" as const, text: "Apenas consultas SELECT são permitidas. Para escrita, use db_write_request." }] };
      }

      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const conn = await prisma.projectConnection.findFirst({
        where: { projectId: proj.id, name: connection, isActive: true },
      });
      if (!conn) return { content: [{ type: "text" as const, text: `Conexão "${connection}" não encontrada.` }] };
      if (conn.type !== "POSTGRES") return { content: [{ type: "text" as const, text: "Essa conexão não é PostgreSQL." }] };

      try {
        const rows = await queryReadOnly(conn.connectionString, sql);
        await logAudit(proj.id, "db_query", { project, connection, sql }, `${rows.length} linhas`);
        const text = rows.length === 0
          ? "Consulta retornou 0 linhas."
          : `${rows.length} linha(s):\n\`\`\`json\n${JSON.stringify(rows.slice(0, 50), null, 2)}\n\`\`\``;
        return { content: [{ type: "text" as const, text }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `Erro na consulta: ${msg}` }] };
      }
    }
  );

  // ── Solicitação de escrita ────────────────────────────────────────────────────
  server.tool(
    "db_write_request",
    "Solicita autorização para executar uma operação de escrita no banco. O usuário precisará aprovar no painel.",
    {
      project:       z.string().describe("Slug do projeto"),
      connection:    z.string().describe("Nome da conexão configurada"),
      sql:           z.string().describe("SQL a ser executado após aprovação"),
      reason:        z.string().describe("Por que essa escrita é necessária"),
      circumstances: z.string().describe("Contexto detalhado: o que motivou, qual o impacto esperado"),
    },
    async ({ project, connection, sql, reason, circumstances }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const conn = await prisma.projectConnection.findFirst({
        where: { projectId: proj.id, name: connection, isActive: true },
      });
      if (!conn) return { content: [{ type: "text" as const, text: `Conexão "${connection}" não encontrada.` }] };

      const wr = await prisma.writeRequest.create({
        data: { projectId: proj.id, connectionId: conn.id, sql, reason, circumstances },
      });

      await logAudit(proj.id, "db_write_request", { project, connection, sql: sql.slice(0, 100) }, `WriteRequest ${wr.id}`);
      return {
        content: [{
          type: "text" as const,
          text: `Solicitação de escrita criada!\n\nID: ${wr.id}\nStatus: PENDING\n\nAguardando sua aprovação no painel em mcp-ui.seudominio.com.\nAssim que você aprovar, eu executo automaticamente.`,
        }],
      };
    }
  );

  // ── Status de write request ───────────────────────────────────────────────────
  server.tool(
    "db_write_status",
    "Verifica o status de uma solicitação de escrita",
    {
      request_id: z.string().describe("ID da write request"),
    },
    async ({ request_id }) => {
      const wr = await prisma.writeRequest.findUnique({ where: { id: request_id } });
      if (!wr) return { content: [{ type: "text" as const, text: "Solicitação não encontrada." }] };
      const text = `Status: ${wr.status}\n` +
        (wr.result ? `Resultado: ${wr.result}` : "") +
        (wr.resolvedAt ? `\nResolvida em: ${wr.resolvedAt.toISOString()}` : "");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  // ── Redis read ────────────────────────────────────────────────────────────────
  server.tool(
    "redis_get",
    "Lê chaves do Redis de um projeto (somente leitura)",
    {
      project:    z.string().describe("Slug do projeto"),
      connection: z.string().describe("Nome da conexão Redis"),
      pattern:    z.string().describe("Padrão de chaves (ex: user:*, session:*)"),
      limit:      z.number().default(20),
    },
    async ({ project, connection, pattern, limit }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const conn = await prisma.projectConnection.findFirst({
        where: { projectId: proj.id, name: connection, isActive: true, type: "REDIS" },
      });
      if (!conn) return { content: [{ type: "text" as const, text: `Conexão Redis "${connection}" não encontrada.` }] };

      try {
        const client = await getRedisClient(conn.connectionString);
        const keys   = await client.keys(pattern);
        const subset = keys.slice(0, limit);
        const values = await Promise.all(subset.map(async k => ({ key: k, value: await client.get(k) })));
        await logAudit(proj.id, "redis_get", { project, pattern }, `${keys.length} chaves`);
        return { content: [{ type: "text" as const, text: JSON.stringify(values, null, 2) }] };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: "text" as const, text: `Erro Redis: ${msg}` }] };
      }
    }
  );
}
