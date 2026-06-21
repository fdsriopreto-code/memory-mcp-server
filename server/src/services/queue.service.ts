import IORedis from "ioredis";
import { Queue, Worker, QueueEvents, Job } from "bullmq";

const REDIS_URL = process.env.REDIS_URL;

// BullMQ uses its own bundled ioredis — pass URL string to avoid type conflicts
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 6379,
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

let brainQueue: Queue | null = null;
let queueEvents: QueueEvents | null = null;

// Keep a separate IORedis for getJobStatus (uses our ioredis version, not BullMQ's)
let ioRedisClient: IORedis | null = null;

if (REDIS_URL) {
  const connOpts = parseRedisUrl(REDIS_URL);
  brainQueue = new Queue("brain-heavy", { connection: connOpts });
  queueEvents = new QueueEvents("brain-heavy", { connection: connOpts });
  ioRedisClient = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

export type BrainJobType = "synthesize" | "dream" | "consensus";

export interface BrainJobData {
  type: BrainJobType;
  project_slug: string;
  [key: string]: unknown;
}

export async function enqueueJob(data: BrainJobData): Promise<{ id: string; mode: "queued" | "sync" }> {
  if (!brainQueue) {
    return { id: `sync-${Date.now()}`, mode: "sync" };
  }
  const job = await brainQueue.add(data.type, data, {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  });
  return { id: job.id ?? "unknown", mode: "queued" };
}

export async function getJobStatus(jobId: string): Promise<{
  id: string; state: string; progress: number; result?: unknown; error?: string;
} | null> {
  if (!brainQueue) return null;
  const job = await Job.fromId(brainQueue, jobId);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id ?? jobId,
    state,
    progress: typeof job.progress === "number" ? job.progress : 0,
    result: job.returnvalue,
    error: job.failedReason,
  };
}

export function startWorker(
  processor: (job: Job<BrainJobData>) => Promise<unknown>
): Worker | null {
  if (!REDIS_URL) return null;
  const connOpts = parseRedisUrl(REDIS_URL);
  const worker = new Worker("brain-heavy", processor, {
    connection: connOpts,
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    console.error(`[queue] Job ${job?.id} falhou:`, err.message);
  });
  return worker;
}

export { brainQueue, queueEvents, ioRedisClient };
