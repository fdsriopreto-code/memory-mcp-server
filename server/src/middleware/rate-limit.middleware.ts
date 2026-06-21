import rateLimit from "express-rate-limit";

export const apiRateLimit = rateLimit({
  windowMs: 60_000,        // 1 minuto
  max: 200,                // 200 requests por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em 1 minuto." },
  skip: (req) => req.path === "/health",
});

export const mcpRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,                 // 60 tool calls por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit MCP excedido. Máximo 60 calls/min." },
});

export const heavyOpsLimit = rateLimit({
  windowMs: 5 * 60_000,   // 5 minutos
  max: 5,                  // 5 operações pesadas por 5 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Operação pesada em cooldown. Máximo 5 a cada 5 minutos." },
});
