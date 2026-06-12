import Redis from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, {
  keyPrefix: "mcp:",
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => console.error("[Redis]", err.message));
