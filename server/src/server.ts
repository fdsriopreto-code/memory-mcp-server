import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { registerMemoryTools } from "./tools/memory.tools.js";
import { registerDatabaseTools } from "./tools/database.tools.js";
import { registerTaskTools } from "./tools/task.tools.js";
import { registerServerLogsTools } from "./tools/serverLogs.tools.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "memory-mcp",
    version: "1.0.0",
  });

  registerMemoryTools(server);
  registerDatabaseTools(server);
  registerTaskTools(server);
  registerServerLogsTools(server);

  return server;
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — cada request é independente
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
