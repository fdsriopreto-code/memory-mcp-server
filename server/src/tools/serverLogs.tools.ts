import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getLogBuffer } from "../logger.js";
import { prisma } from "../config/database.js";
import { decrypt } from "../services/crypto.service.js";
import { logAudit } from "./audit.js";

// ── JWT token cache (per service id) ─────────────────────────────────────────
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken(id: string, apiUrl: string, email: string, password: string): Promise<string> {
  const cached = tokenCache.get(id);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(`${apiUrl}/api/platform-admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Login falhou (HTTP ${res.status})`);
  const data = (await res.json()) as { token: string };
  tokenCache.set(id, { token: data.token, expiresAt: Date.now() + 11 * 60 * 60 * 1000 });
  return data.token;
}

// ── Format entries for Claude ─────────────────────────────────────────────────
interface LogEntry { ts: number; level: string; msg: string; }

function formatLogs(entries: LogEntry[], search?: string): string {
  let rows = entries;
  if (search) {
    const q = search.toLowerCase();
    rows = entries.filter(e => e.msg.toLowerCase().includes(q));
  }
  if (rows.length === 0) return "(nenhum log encontrado com esse filtro)";
  return rows
    .map(e => {
      const time = new Date(e.ts).toLocaleTimeString("pt-BR", { hour12: false });
      return `[${time}] [${e.level.toUpperCase().padEnd(5)}] ${e.msg}`;
    })
    .join("\n");
}

// ── Tool registration ─────────────────────────────────────────────────────────
export function registerServerLogsTools(server: McpServer) {
  server.tool(
    "get_server_logs",
    `Busca logs do servidor de um serviço para diagnóstico. ` +
    `Use service="self" para o memory-mcp-server, service="list" para ver serviços configurados, ` +
    `ou o nome de qualquer serviço externo cadastrado no painel. ` +
    `Ideal para investigar erros, avisos e comportamento em produção.`,
    {
      service: z.string().default("self")
        .describe('Serviço a consultar: "self" (este servidor), "list" (listar disponíveis), ou o name de um serviço externo'),
      level: z.enum(["debug", "info", "warn", "error"]).optional()
        .describe("Filtrar por severidade (omita para todos os níveis)"),
      limit: z.number().min(1).max(200).default(50)
        .describe("Número de linhas (padrão 50, máximo 200)"),
      search: z.string().optional()
        .describe("Texto para filtrar mensagens (case-insensitive)"),
    },
    async ({ service, level, limit, search }) => {
      await logAudit(null, "get_server_logs", { service, level, limit, search });

      try {
        // ── Listar serviços disponíveis ────────────────────────────────────
        if (service === "list") {
          const svcs = await prisma.externalService.findMany({
            where: { isActive: true },
            select: { name: true, displayName: true, apiUrl: true },
            orderBy: { createdAt: "asc" },
          });
          const lines = [
            `• self — memory-mcp-server (este servidor)`,
            ...svcs.map(s => `• ${s.name} — ${s.displayName} (${s.apiUrl})`),
          ];
          return { content: [{ type: "text" as const, text: `Serviços disponíveis:\n${lines.join("\n")}` }] };
        }

        let entries: LogEntry[];
        let label: string;

        if (service === "self") {
          // ── memory-mcp-server próprio ──────────────────────────────────
          let logs = getLogBuffer();
          if (level) logs = logs.filter(e => e.level === level);
          entries = logs.slice(-limit);
          label   = "memory-mcp-server";

        } else {
          // ── Serviço externo (banco) ────────────────────────────────────
          const svc = await prisma.externalService.findUnique({
            where: { name: service },
          });
          if (!svc) {
            const all = await prisma.externalService.findMany({ select: { name: true } });
            const names = ["self", "list", ...all.map(s => s.name)].join(", ");
            return {
              content: [{ type: "text" as const,
                text: `Serviço "${service}" não encontrado. Disponíveis: ${names}` }],
            };
          }
          if (!svc.isActive) {
            return { content: [{ type: "text" as const, text: `Serviço "${service}" está desativado.` }] };
          }

          const password = decrypt(svc.adminPassword);
          const token    = await getToken(svc.id, svc.apiUrl, svc.adminEmail, password);
          const params   = new URLSearchParams({ limit: String(limit) });
          if (level) params.set("level", level);

          const res = await fetch(`${svc.apiUrl}/api/platform-admin/server-logs?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar logs de ${svc.displayName}`);
          entries = (await res.json()) as LogEntry[];
          label   = svc.displayName;
        }

        const summary   = `${entries.length} linha(s)${level ? ` [${level}]` : ""}${search ? ` | busca: "${search}"` : ""}`;
        const formatted = formatLogs(entries, search);

        return {
          content: [{ type: "text" as const,
            text: `Logs do ${label} — ${summary}:\n\n${formatted}` }],
        };

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Erro ao buscar logs: ${msg}` }] };
      }
    },
  );
}
