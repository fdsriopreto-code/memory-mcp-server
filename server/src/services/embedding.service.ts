import OpenAI from "openai";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const MODEL = "text-embedding-3-small";
const DIMS  = 1536;
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

export async function getEmbedding(text: string): Promise<number[]> {
  const cacheKey = `embed:${Buffer.from(text).toString("base64").slice(0, 64)}`;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as number[];

  const normalized = text.replace(/\n+/g, " ").trim().slice(0, 8000);
  const res = await openai.embeddings.create({ model: MODEL, input: normalized, dimensions: DIMS });
  const vector = res.data[0].embedding;

  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(vector)).catch(() => {});
  return vector;
}
