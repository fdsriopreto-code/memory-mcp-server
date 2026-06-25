import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { randomUUID } from "crypto";
import pkg from "jsonwebtoken";
const { verify } = pkg;
import { env } from "./config/env.js";

let wss: WebSocketServer | null = null;

// ── Computer Agent Registry ────────────────────────────────────────────────────
interface ComputerAgent {
  ws:          WebSocket;
  agentId:     string;
  hostname:    string;
  platform:    string;
  connectedAt: Date;
}

interface CommandResult {
  output:    string;
  exitCode:  number;
  commandId: string;
}

interface PendingCommand {
  resolve: (r: CommandResult) => void;
  reject:  (e: Error) => void;
  chunks:  string[];
  timer:   ReturnType<typeof setTimeout>;
}

const computerAgents  = new Map<string, ComputerAgent>();
const pendingCommands = new Map<string, PendingCommand>();

export function getComputerAgents(): { agentId: string; hostname: string; platform: string; connectedAt: Date }[] {
  return [...computerAgents.values()].map(({ agentId, hostname, platform, connectedAt }) => ({
    agentId, hostname, platform, connectedAt,
  }));
}

export async function sendToComputer(
  agentId:   string,
  command:   string,
  workdir?:  string,
  timeoutMs = 120_000
): Promise<CommandResult> {
  const agent = computerAgents.get(agentId);
  if (!agent) throw new Error(`Computer agent "${agentId}" não está conectado. Use computer_list() para ver agentes disponíveis.`);

  const commandId = randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Timeout após ${timeoutMs / 1000}s aguardando resposta do computador`));
    }, timeoutMs);

    pendingCommands.set(commandId, { resolve, reject, chunks: [], timer });

    agent.ws.send(JSON.stringify({ type: "computer_command", commandId, command, workdir }), (err) => {
      if (err) {
        clearTimeout(timer);
        pendingCommands.delete(commandId);
        reject(err);
      }
    });
  });
}

export function initWss(server: Server): void {
  // ── WebSocket único em /ws — frontend usa ?token=JWT, computer agent usa ?apikey=KEY
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url    = new URL(req.url ?? "/", "http://localhost");
    const token  = url.searchParams.get("token");
    const apikey = url.searchParams.get("apikey");

    // ── Computer Agent (autenticação por API key) ────────────────────────────
    if (apikey) {
      if (apikey !== env.MCP_API_KEY) { ws.terminate(); return; }

      let registeredId: string | null = null;

      ws.on("error", () => ws.terminate());

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as Record<string, unknown>;

          switch (msg.type) {
            case "computer_register": {
              const agentId  = String(msg.agentId  ?? "unknown");
              const hostname = String(msg.hostname  ?? "unknown");
              const platform = String(msg.platform  ?? "unknown");

              registeredId = agentId;
              computerAgents.set(agentId, { ws, agentId, hostname, platform, connectedAt: new Date() });

              ws.send(JSON.stringify({ type: "computer_welcome", agentId, message: `✅ Conectado como "${agentId}"` }));
              broadcast("computer_connected", { agentId, hostname, platform });
              console.log(`[computer-agent] "${agentId}" conectado (${hostname} / ${platform})`);
              break;
            }

            case "computer_output": {
              const commandId = String(msg.commandId ?? "");
              const chunk     = String(msg.chunk     ?? "");
              const pending   = pendingCommands.get(commandId);
              if (pending) pending.chunks.push(chunk);
              broadcast("computer_output", { agentId: registeredId, commandId, chunk });
              break;
            }

            case "computer_done": {
              const commandId = String(msg.commandId ?? "");
              const exitCode  = Number(msg.exitCode  ?? 0);
              const pending   = pendingCommands.get(commandId);
              if (pending) {
                clearTimeout(pending.timer);
                pendingCommands.delete(commandId);
                pending.resolve({ output: pending.chunks.join(""), exitCode, commandId });
              }
              broadcast("computer_done", { agentId: registeredId, commandId, exitCode });
              break;
            }

            case "computer_error": {
              const commandId = String(msg.commandId ?? "");
              const error     = String(msg.error     ?? "Erro desconhecido");
              const pending   = pendingCommands.get(commandId);
              if (pending) {
                clearTimeout(pending.timer);
                pendingCommands.delete(commandId);
                pending.reject(new Error(error));
              }
              broadcast("computer_error", { agentId: registeredId, commandId, error });
              break;
            }
          }
        } catch {}
      });

      ws.on("close", () => {
        if (registeredId) {
          computerAgents.delete(registeredId);
          broadcast("computer_disconnected", { agentId: registeredId });
          console.log(`[computer-agent] "${registeredId}" desconectado`);
        }
      });

      return;
    }

    // ── Frontend (autenticação por JWT) ──────────────────────────────────────
    try {
      if (!token) { ws.terminate(); return; }
      verify(token, env.JWT_SECRET);
    } catch {
      ws.terminate();
      return;
    }

    ws.on("error", () => ws.terminate());
    ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
  });

  console.log("[WS] WebSocket ativo em /ws (frontend=?token, computer=?apikey)");
}

export function broadcast(type: string, data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg, (err) => { if (err) client.terminate(); });
    }
  });
}
