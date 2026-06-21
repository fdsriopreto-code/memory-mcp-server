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

  return server;
}

// Sessões em memória (para produção multi-pod, usar Redis)
const sessions = new Map<string, { server: McpServer; lastUsed: number }>();

// Cleanup de sessões expiradas (30 min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of sessions) {
    if (s.lastUsed < cutoff) sessions.delete(id);
  }
}, 5 * 60_000);

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

  let mcpServer: McpServer;
  if (existingSessionId && sessions.has(existingSessionId)) {
    const s = sessions.get(existingSessionId)!;
    s.lastUsed = Date.now();
    mcpServer = s.server;
  } else {
    mcpServer = createMcpServer();
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => {
      const id = randomUUID();
      sessions.set(id, { server: mcpServer, lastUsed: Date.now() });
      return id;
    },
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    // NÃO fecha o server aqui — sessão pode continuar
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
