import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getLogBuffer } from "../logger.js";
import { logAudit } from "./audit.js";

// ── External service config from env ─────────────────────────────────────────
interface ExternalService {
  name: string;
  displayName: string;
  apiUrl: string;           // base URL, e.g. https://back.ilemanager.com
  adminEmail: string;
  adminPassword: string;
}

function loadExternalServices(): ExternalService[] {
  const raw = process.env.EXTERNAL_SERVICES;
  if (!raw) return [];
  try { return JSON.parse(raw) as ExternalService[]; } catch { return []; }
}

// ── JWT token cache (per service name) ───────────────────────────────────────
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken(svc: ExternalService): Promise<string> {
  const cached = tokenCache.get(svc.name);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(`${svc.apiUrl}/api/platform-admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: svc.adminEmail, password: svc.adminPassword }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Login em ${svc.name} falhou: ${res.status}`);
  const data = (await res.json()) as { token: string };
  // cache for 11h (token expires in 12h)
  tokenCache.set(svc.name, { token: data.token, expiresAt: Date.now() + 11 * 60 * 60 * 1000 });
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
  const externalServices = loadExternalServices();
  const serviceNames = ["self", ...externalServices.map(s => s.name)];

  server.tool(
    "get_server_logs",
    `Busca logs do servidor de um serviço. Serviços disponíveis: ${serviceNames.join(", ")}. ` +
    `"self" = memory-mcp-server (este servidor). ` +
    `Use para diagnosticar erros, verificar inicialização, acompanhar avisos em produção.`,
    {
      service: z.string().default("self")
        .describe(`Serviço a consultar. Opções: ${serviceNames.join(", ")}`),
      level: z.enum(["debug", "info", "warn", "error"]).optional()
        .describe("Filtrar por nível de severidade (omita para todos)"),
      limit: z.number().min(1).max(200).default(50)
        .describe("Número de linhas a retornar (padrão 50, máximo 200)"),
      search: z.string().optional()
        .describe("Texto para filtrar mensagens (busca simples, case-insensitive)"),
    },
    async ({ service, level, limit, search }) => {
      await logAudit(null, "get_server_logs", { service, level, limit, search });

      try {
        let entries: LogEntry[];

        if (service === "self") {
          // ── memory-mcp-server próprio ────────────────────────────────────
          let logs = getLogBuffer();
          if (level) logs = logs.filter(e => e.level === level);
          entries = logs.slice(-limit);

        } else {
          // ── Serviço externo ──────────────────────────────────────────────
          const svc = externalServices.find(s => s.name === service);
          if (!svc) {
            return {
              content: [{
                type: "text" as const,
                text: `Serviço "${service}" não configurado. Disponíveis: ${serviceNames.join(", ")}`,
              }],
            };
          }

          const token  = await getToken(svc);
          const params = new URLSearchParams({ limit: String(limit) });
          if (level) params.set("level", level);

          const res = await fetch(`${svc.apiUrl}/api/platform-admin/server-logs?${params}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          });

          if (!res.ok) throw new Error(`Erro ao buscar logs de ${svc.displayName}: HTTP ${res.status}`);
          entries = (await res.json()) as LogEntry[];
        }

        const formatted = formatLogs(entries, search);
        const label     = service === "self" ? "memory-mcp-server" :
          (externalServices.find(s => s.name === service)?.displayName ?? service);

        return {
          content: [{
            type: "text" as const,
            text: `Logs do ${label} — ${entries.length} linha(s)${level ? ` [${level}]` : ""}${search ? ` filtrando "${search}"` : ""}:\n\n${formatted}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Erro ao buscar logs: ${msg}` }] };
      }
    },
  );
}
