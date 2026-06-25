import Redis from "ioredis";
import { env } from "./env.js";

// Redis é opcional — sem URL, cache e fila ficam desabilitados
export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      keyPrefix:            "mcp:",
      lazyConnect:          true,
      maxRetriesPerRequest: 3,
    })
  : null;

if (redis) {
  redis.on("error", (err) => console.error("[Redis]", err.message));
} else {
  console.warn("[Redis] REDIS_URL não configurada — cache desabilitado, embeddings sem cache");
}
