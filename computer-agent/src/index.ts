import { WebSocket } from "ws";
import { exec } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { hostname, platform, homedir } from "os";

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL = process.env.MCP_SERVER_URL ?? "wss://seu-servidor.easypanel.host";
const API_KEY    = process.env.MCP_API_KEY    ?? "";
const AGENT_ID   = process.env.AGENT_ID       ?? hostname();
const DEFAULT_CWD = process.env.DEFAULT_CWD   ?? homedir();

const WS_URL = `${SERVER_URL}/ws?apikey=${encodeURIComponent(API_KEY)}`;

// Comandos bloqueados por segurança
const BLOCKED = ["rm -rf /", "format c:", "del /f /s /q c:\\", "shutdown", "mkfs"];

function isBlocked(cmd: string): boolean {
  const lower = cmd.toLowerCase();
  return BLOCKED.some(b => lower.includes(b));
}

// ── Connection ────────────────────────────────────────────────────────────────
function connect() {
  console.log(`[computer-agent] Conectando como "${AGENT_ID}" em ${SERVER_URL}...`);

  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type:     "computer_register",
      agentId:  AGENT_ID,
      hostname: hostname(),
      platform: platform(),
      cwd:      DEFAULT_CWD,
    }));
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;

      if (msg.type === "computer_welcome") {
        console.log(`[computer-agent] ✅ ${msg.message}`);
        return;
      }

      if (msg.type === "computer_command") {
        const commandId = String(msg.commandId ?? "");
        const command   = String(msg.command   ?? "");
        const workdir   = String(msg.workdir   ?? DEFAULT_CWD);

        console.log(`[exec] ${command} (cwd: ${workdir})`);

        if (isBlocked(command)) {
          ws.send(JSON.stringify({
            type: "computer_error",
            commandId,
            error: `Comando bloqueado por segurança: ${command}`,
          }));
          return;
        }

        // exec() resolve o shell automaticamente: COMSPEC no Windows, /bin/sh no Unix
        // funciona em Git Bash, cmd.exe, PowerShell, Linux e Mac sem configuração
        const proc = exec(command, {
          cwd: workdir,
          env: { ...process.env },
          maxBuffer: 10 * 1024 * 1024,
        });

        proc.stdout?.on("data", (chunk: Buffer) => {
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: chunk.toString() }));
        });

        proc.stderr?.on("data", (chunk: Buffer) => {
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: chunk.toString() }));
        });

        proc.on("close", (code) => {
          ws.send(JSON.stringify({ type: "computer_done", commandId, exitCode: code ?? 0 }));
        });

        proc.on("error", (err) => {
          ws.send(JSON.stringify({ type: "computer_error", commandId, error: err.message }));
        });
      }

      if (msg.type === "computer_read_file") {
        const commandId = String(msg.commandId ?? "");
        const path      = String(msg.path      ?? "");
        try {
          const content = readFileSync(resolve(path), "utf8");
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: content }));
          ws.send(JSON.stringify({ type: "computer_done", commandId, exitCode: 0 }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "computer_error", commandId, error: String(e) }));
        }
      }

      if (msg.type === "computer_write_file") {
        const commandId = String(msg.commandId ?? "");
        const path      = String(msg.path      ?? "");
        const content   = String(msg.content   ?? "");
        try {
          mkdirSync(dirname(resolve(path)), { recursive: true });
          writeFileSync(resolve(path), content, "utf8");
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: `Arquivo salvo: ${path}` }));
          ws.send(JSON.stringify({ type: "computer_done", commandId, exitCode: 0 }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "computer_error", commandId, error: String(e) }));
        }
      }

    } catch (e) {
      console.error("[computer-agent] Erro ao processar mensagem:", e);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[computer-agent] Desconectado (${code}: ${reason}). Reconectando em 5s...`);
    setTimeout(connect, 5000);
  });

  ws.on("error", (err) => {
    console.error("[computer-agent] Erro WebSocket:", err.message);
  });
}

console.log("╔══════════════════════════════════════════╗");
console.log("║    Memory MCP — Computer Agent v1.0      ║");
console.log("╚══════════════════════════════════════════╝");
connect();
