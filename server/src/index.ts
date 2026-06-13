import { createServer } from "node:http";
import express from "express";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { mcpAuth } from "./middleware/auth.js";
import { handleMcpRequest } from "./server.js";
import { authRoutes } from "./routes/auth.routes.js";
import { apiRoutes } from "./routes/api.routes.js";
import { initWss } from "./ws.js";

const app = express();
const server = createServer(app);

app.use(express.json({ limit: "4mb" }));

app.use((req, _res, next) => {
  const origin = req.headers.origin ?? "*";
  _res.setHeader("Access-Control-Allow-Origin", origin);
  _res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  _res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, OPTIONS");
  if (req.method === "OPTIONS") { _res.status(204).end(); return; }
  next();
});

// ── MCP endpoint (Claude Code) ────────────────────────────────────────────────
app.post("/mcp",    mcpAuth, handleMcpRequest);
app.get("/mcp",     mcpAuth, handleMcpRequest);
app.delete("/mcp",  mcpAuth, (_req, res) => res.status(405).end());

// ── REST API (painel frontend) ─────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/api",  apiRoutes);

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  const keyHex = process.env.ENCRYPTION_KEY ?? "";
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    encKeyLen: keyHex.length,
    encKeyValid: keyHex.length === 64 && /^[0-9a-fA-F]+$/.test(keyHex),
  });
});

async function start() {
  await redis.connect().catch(() => console.warn("[Redis] Conectando em background..."));
  await prisma.$connect();
  initWss(server);
  server.listen(env.PORT, () => {
    console.log(`[MCP Server] Rodando na porta ${env.PORT}`);
    console.log(`[MCP] Endpoint: http://localhost:${env.PORT}/mcp`);
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
