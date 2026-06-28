import { randomUUID } from "crypto";
import { prisma } from "../config/database.js";
import { runBrainDoctor } from "../services/brain-doctor.service.js";
import { getProviderKey } from "../services/ai-provider.service.js";

// ── Types ──────────────────────────────────────────────────────────────────────
interface BrainDoctorConfig {
  enabled:   boolean;
  frequency: string;  // daily | weekly | biweekly | monthly
  model:     string;
  projects:  string[];
  hour:      number;  // UTC hour 0-23
}

// ── Default config ─────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;
const CONFIG_ID = "singleton";

// ── Config accessors ───────────────────────────────────────────────────────────
export async function getConfig(): Promise<BrainDoctorConfig> {
  const row = await prisma.brainDoctorConfig.findFirst();
  if (!row) return { enabled: false, frequency: "weekly", model: "gpt-4o", projects: [], hour: 3 };
  return {
    enabled:   row.enabled,
    frequency: row.frequency,
    model:     row.model,
    projects:  row.projects,
    hour:      row.hour,
  };
}

export async function saveConfig(config: BrainDoctorConfig): Promise<void> {
  await prisma.brainDoctorConfig.upsert({
    where:  { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...config },
    update: config,
  });
  // Re-schedule with new config
  reschedule();
}

// ── Scheduling logic ───────────────────────────────────────────────────────────
function msUntilNextRun(config: BrainDoctorConfig): number {
  const now   = new Date();
  const next  = new Date();
  next.setUTCHours(config.hour, 0, 0, 0);

  // Start from tomorrow if today's run time already passed
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  // Apply frequency offset
  const dayOfWeek = next.getUTCDay(); // 0=Sun

  switch (config.frequency) {
    case "weekly":   // Run on Sunday
      while (next.getUTCDay() !== 0) next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "biweekly": // Run on Sunday every 2 weeks
      while (next.getUTCDay() !== 0) next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCDate(next.getUTCDate() + 7); // +1 extra week
      break;
    case "monthly":  // Run on 1st of month
      next.setUTCDate(1);
      if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    // "daily" → just tomorrow at hour
  }

  return Math.max(1000, next.getTime() - now.getTime());
}

async function runScheduledMaintenance(): Promise<void> {
  const config = await getConfig();
  if (!config.enabled) { reschedule(); return; }

  // Get projects to process
  let slugs = config.projects;
  if (!slugs.length) {
    const projects = await prisma.project.findMany({ select: { slug: true } });
    slugs = projects.map(p => p.slug);
  }

  const modelId  = config.model;
  const apiKey   = getApiKeyForModel(modelId);

  console.log(`[BrainDoctorScheduler] Iniciando manutenção automática: ${slugs.length} projetos, modelo=${modelId}`);

  for (const slug of slugs) {
    try {
      const run = await prisma.brainDoctorRun.create({
        data: {
          id:          randomUUID(),
          projectSlug: slug,
          model:       modelId,
          status:      "running",
          goal:        "manutenção automática agendada",
          startedAt:   new Date(),
        },
      });

      console.log(`[BrainDoctorScheduler] Projeto: ${slug} | runId: ${run.id}`);
      await runBrainDoctor({ runId: run.id, projectSlug: slug, modelId, apiKey });
    } catch (e) {
      console.error(`[BrainDoctorScheduler] Erro no projeto ${slug}:`, e);
    }

    // Pause between projects to avoid API rate limits
    if (slugs.indexOf(slug) < slugs.length - 1) {
      await new Promise(r => setTimeout(r, 5_000));
    }
  }

  console.log("[BrainDoctorScheduler] Manutenção automática concluída");
  reschedule();
}

function reschedule(): void {
  if (timer) clearTimeout(timer);
  getConfig().then(config => {
    if (!config.enabled) return;
    const delay = msUntilNextRun(config);
    const nextDate = new Date(Date.now() + delay);
    console.log(`[BrainDoctorScheduler] Próxima execução: ${nextDate.toISOString()} (em ${Math.round(delay / 3_600_000 * 10) / 10}h)`);
    timer = setTimeout(runScheduledMaintenance, delay);
  }).catch(e => console.error("[BrainDoctorScheduler] Erro ao ler config:", e));
}

function getApiKeyForModel(modelId: string): string {
  // Determine provider from model ID
  if (modelId.startsWith("gpt-") || modelId.startsWith("o3") || modelId.startsWith("o1")) {
    return getProviderKey("openai");
  }
  if (modelId.startsWith("claude-")) return getProviderKey("anthropic");
  if (modelId.startsWith("deepseek-")) return getProviderKey("deepseek");
  if (modelId.startsWith("gemini-")) return getProviderKey("google");
  return getProviderKey("openai");
}

// ── Manual trigger ─────────────────────────────────────────────────────────────
export async function triggerManualRun(opts: {
  projectSlug: string;
  modelId:     string;
  apiKey?:     string;
  goal?:       string;
}): Promise<{ runId: string }> {
  const run = await prisma.brainDoctorRun.create({
    data: {
      id:          randomUUID(),
      projectSlug: opts.projectSlug,
      model:       opts.modelId,
      status:      "running",
      goal:        opts.goal ?? "manutenção manual",
      startedAt:   new Date(),
    },
  });

  // Fire & forget — progress comes via WebSocket
  setImmediate(async () => {
    await runBrainDoctor({
      runId:       run.id,
      projectSlug: opts.projectSlug,
      modelId:     opts.modelId,
      apiKey:      opts.apiKey,
      goal:        opts.goal,
    });
  });

  return { runId: run.id };
}

// ── Init ───────────────────────────────────────────────────────────────────────
export function initBrainDoctorScheduler(): void {
  console.log("[BrainDoctorScheduler] Inicializando...");
  // Schedule first check after 10s (let server finish startup)
  setTimeout(reschedule, 10_000);
}
