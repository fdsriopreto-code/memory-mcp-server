import { createServer } from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import path from "path";
import { existsSync } from "fs";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";
import { redis } from "./config/redis.js";
import { mcpAuth } from "./middleware/auth.js";
import { handleMcpRequest } from "./server.js";
import { authRoutes } from "./routes/auth.routes.js";
import { apiRoutes } from "./routes/api.routes.js";
import { hookRoutes } from "./routes/hook.routes.js";
import { initWss } from "./ws.js";
import { requestCtx } from "./context.js";
import { patchConsole } from "./logger.js";
import { apiRateLimit } from "./middleware/rate-limit.middleware.js";
import { initBrainWorker } from "./workers/brain.worker.js";
import { initDecayScheduler } from "./workers/decay.scheduler.js";
import { initSynthesisScheduler } from "./workers/synthesis.scheduler.js";
import { initBrainDoctorScheduler } from "./workers/brain-doctor.scheduler.js";

patchConsole();

// ── Rate limiting para /mcp ───────────────────────────────────────────────────
const rlMap = new Map<string, { n: number; reset: number }>();
function mcpRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = (req.ip ?? req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  const now = Date.now();
  const rl = rlMap.get(key);
  if (!rl || now > rl.reset) { rlMap.set(key, { n: 1, reset: now + 60_000 }); next(); return; }
  if (rl.n >= 120) { res.status(429).json({ error: "Rate limit: 120 req/min por IP" }); return; }
  rl.n++;
  next();
}

const app = express();
const server = createServer(app);

app.set("trust proxy", 1); // nginx reverse proxy
app.use(express.json({ limit: "4mb" }));

app.use((req, _res, next) => {
  const origin = req.headers.origin ?? "*";
  _res.setHeader("Access-Control-Allow-Origin", origin);
  _res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
  _res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, PUT, OPTIONS");
  if (req.method === "OPTIONS") { _res.status(204).end(); return; }
  next();
});

// ── MCP endpoint (Claude Code) ────────────────────────────────────────────────
app.post("/mcp", mcpRateLimit, mcpAuth, (req, res) => {
  const sid = (req.headers["mcp-session-id"] as string) ?? null;
  requestCtx.run({ sessionId: sid }, () => handleMcpRequest(req, res));
});
app.get("/mcp", mcpRateLimit, mcpAuth, (req, res) => {
  const sid = (req.headers["mcp-session-id"] as string) ?? null;
  requestCtx.run({ sessionId: sid }, () => handleMcpRequest(req, res));
});
app.delete("/mcp", mcpAuth, (_req, res) => res.status(405).end());

// ── REST API (painel frontend) ─────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/api", apiRateLimit, apiRoutes);
app.use("/hooks", hookRoutes);

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  const keyHex = process.env.ENCRYPTION_KEY ?? "";
  const adminEmail = process.env.ADMIN_EMAIL ?? "";
  const adminPwd = process.env.ADMIN_PASSWORD ?? "";
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    encKeyLen: keyHex.length,
    encKeyValid: keyHex.length === 64 && /^[0-9a-fA-F]+$/.test(keyHex),
    adminEmailLen: adminEmail.length,
    adminEmailTrimmed: adminEmail.trim().length,
    adminPwdLen: adminPwd.length,
    adminPwdTrimmed: adminPwd.trim().length,
  });
});

// Cleanup de MemoryAccessLog com mais de 180 dias (roda a cada 24h)
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 180 * 86_400_000);
    const result = await prisma.$executeRaw`
      DELETE FROM memory_access_logs WHERE accessed_at < ${cutoff}
    `;
    if (result > 0) console.log(`[cleanup] ${result} access logs removidos`);
  } catch (e) {
    console.error("[cleanup] Erro:", e);
  }
}, 24 * 60 * 60_000);

// Modo Electron: serve o frontend estático também
if (process.env.SERVE_FRONTEND === "true") {
  const frontendDist = process.env.FRONTEND_DIST ?? path.join(process.cwd(), "../frontend/dist");
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp") || req.path.startsWith("/auth") || req.path.startsWith("/ws")) {
      return next();
    }
    const indexHtml = path.join(frontendDist, "index.html");
    if (existsSync(indexHtml)) {
      res.sendFile(indexHtml);
    } else {
      next();
    }
  });
}

async function runPendingMigrations() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "brain_doctor_runs" (
        "id" TEXT NOT NULL PRIMARY KEY, "project_slug" TEXT NOT NULL, "model" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'running', "goal" TEXT, "plan" JSONB,
        "steps" JSONB NOT NULL DEFAULT '[]', "stats" JSONB NOT NULL DEFAULT '{}',
        "summary" TEXT, "error" TEXT,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "completed_at" TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS "brain_doctor_configs" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
        "enabled" BOOLEAN NOT NULL DEFAULT FALSE, "frequency" TEXT NOT NULL DEFAULT 'weekly',
        "model" TEXT NOT NULL DEFAULT 'gpt-4o', "projects" TEXT[] NOT NULL DEFAULT '{}',
        "hour" INTEGER NOT NULL DEFAULT 3, "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO "brain_doctor_configs" ("enabled","frequency","model","projects","hour","updated_at")
      SELECT FALSE,'weekly','gpt-4o','{}',3,NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "brain_doctor_configs");
    `);
    console.log("[migrations] brain_doctor_runs + brain_doctor_configs OK");
  } catch (e) {
    console.warn("[migrations] Aviso:", (e as Error).message?.slice(0, 120));
  }
}

async function start() {
  if (redis) await redis.connect().catch(() => console.warn("[Redis] Conectando em background..."));
  await prisma.$connect();
  await runPendingMigrations();
  initWss(server);
  server.listen(env.PORT, () => {
    console.log(`[MCP Server] Rodando na porta ${env.PORT}`);
    console.log(`[MCP] Endpoint: http://localhost:${env.PORT}/mcp`);
  });
  initBrainWorker();
  initDecayScheduler();
  initSynthesisScheduler();
  initBrainDoctorScheduler();
}

start().catch((e) => { console.error(e); process.exit(1); });
