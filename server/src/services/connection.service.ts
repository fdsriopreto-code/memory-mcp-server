import pg from "pg";
import Redis from "ioredis";
import { decrypt } from "./crypto.service.js";

const pgPools = new Map<string, pg.Pool>();
const redisClients = new Map<string, Redis>();

export async function getPgPool(encryptedConnStr: string): Promise<pg.Pool> {
  const connStr = decrypt(encryptedConnStr);
  if (pgPools.has(connStr)) return pgPools.get(connStr)!;

  const pool = new pg.Pool({ connectionString: connStr, max: 3 });
  // Enforce read-only at session level
  pool.on("connect", (client) => {
    client.query("SET default_transaction_read_only = on").catch(() => {});
  });
  pgPools.set(connStr, pool);
  return pool;
}

export async function getRedisClient(encryptedConnStr: string): Promise<Redis> {
  const connStr = decrypt(encryptedConnStr);
  if (redisClients.has(connStr)) return redisClients.get(connStr)!;

  const client = new Redis(connStr, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await client.connect();
  redisClients.set(connStr, client);
  return client;
}

export async function queryReadOnly(encryptedConnStr: string, sql: string): Promise<unknown[]> {
  const pool = await getPgPool(encryptedConnStr);
  const res = await pool.query(sql);
  return res.rows;
}

export async function executeWrite(encryptedConnStr: string, sql: string): Promise<unknown> {
  const connStr = decrypt(encryptedConnStr);
  const pool = new pg.Pool({ connectionString: connStr, max: 1 });
  try {
    const res = await pool.query(sql);
    return { rowCount: res.rowCount, rows: res.rows };
  } finally {
    await pool.end();
  }
}
