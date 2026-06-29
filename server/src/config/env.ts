import { createHash } from "crypto";

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  return val.trim();
};

// MCP key estável: usa env var se definida, senão deriva do DATABASE_URL
// Isso garante que a chave não muda a cada deploy no EasyPanel
function stableMcpKey(): string {
  const explicit = process.env.MCP_API_KEY?.trim();
  if (explicit) return explicit;
  const dbUrl = process.env.DATABASE_URL ?? "no-db";
  return createHash("sha256").update(dbUrl + "mcp-stable-2026").digest("hex").slice(0, 48);
}

export const env = {
  DATABASE_URL:    required("DATABASE_URL"),
  REDIS_URL:       process.env.REDIS_URL?.trim() ?? "",   // opcional — sem Redis, cache desabilitado
  OPENAI_API_KEY:  required("OPENAI_API_KEY"),
  MCP_API_KEY:     stableMcpKey(),
  ADMIN_EMAIL:     required("ADMIN_EMAIL"),
  ADMIN_PASSWORD:  required("ADMIN_PASSWORD"),
  JWT_SECRET:      required("JWT_SECRET"),
  ENCRYPTION_KEY:  required("ENCRYPTION_KEY"),
  PORT:            Number(process.env.PORT ?? 3100),
  NODE_ENV:        process.env.NODE_ENV ?? "development",
  // AI providers — optional (only needed if user selects that model)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
  DEEPSEEK_API_KEY:  process.env.DEEPSEEK_API_KEY?.trim()  ?? "",
  GOOGLE_AI_KEY:     process.env.GOOGLE_AI_KEY?.trim()     ?? "",
};
