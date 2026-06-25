import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { registerMemoryTools } from "./tools/memory.tools.js";
import { registerDatabaseTools } from "./tools/database.tools.js";
import { registerTaskTools } from "./tools/task.tools.js";
import { registerServerLogsTools } from "./tools/serverLogs.tools.js";
import { registerAuditTools } from "./tools/audit.tools.js";
import { registerBrainTools } from "./tools/brain.tools.js";
import { registerBrain2Tools } from "./tools/brain2.tools.js";
import { registerCreTools } from "./tools/brain_cre.tools.js";
import { registerSurrealTools } from "./tools/brain_surreal.tools.js";
import { registerAnchorTools } from "./tools/anchor.tools.js";
import { registerGitTools } from "./tools/git.tools.js";
import { registerBrain3Tools } from "./tools/brain3.tools.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "memory-mcp",
    version: "1.0.0",
  });

  registerMemoryTools(server);
  registerDatabaseTools(server);
  registerTaskTools(server);
  registerServerLogsTools(server);
  registerAuditTools(server);
  registerBrainTools(server);
  registerBrain2Tools(server);
  registerCreTools(server);
  registerSurrealTools(server);
  registerAnchorTools(server);
  registerGitTools(server);
  registerBrain3Tools(server);

  return server;
}

type Session = { server: McpServer; transport: StreamableHTTPServerTransport; lastUsed: number };
const sessions = new Map<string, Session>();

// Cleanup de sessões expiradas (30 min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of sessions) {
    if (s.lastUsed < cutoff) {
      s.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 5 * 60_000);

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

  // Reutiliza transporte existente — mantém estado de inicialização
  if (existingSessionId && sessions.has(existingSessionId)) {
    const s = sessions.get(existingSessionId)!;
    s.lastUsed = Date.now();
    await s.transport.handleRequest(req, res, req.body);
    return;
  }

  // Nova sessão: cria server + transport juntos
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => {
      const id = randomUUID();
      sessions.set(id, { server: mcpServer, transport, lastUsed: Date.now() });
      return id;
    },
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
