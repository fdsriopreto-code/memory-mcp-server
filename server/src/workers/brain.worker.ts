import type { Job } from "bullmq";
import { startWorker, type BrainJobData } from "../services/queue.service.js";
import { prisma } from "../config/database.js";
import OpenAI from "openai";
import { openAiBreaker, withRetry } from "../services/circuit-breaker.service.js";
import { cacheDel } from "../services/cache.service.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function processBrainJob(job: Job<BrainJobData>): Promise<unknown> {
  const { type, project_slug } = job.data;

  const proj = await prisma.project.findUnique({ where: { slug: project_slug } });
  if (!proj) throw new Error(`Projeto não encontrado: ${project_slug}`);

  await job.updateProgress(10);

  if (type === "synthesize") {
    // importa dinamicamente para não criar circular dep
    const { runCreCycle } = await import("./cre-runner.js");
    const result = await runCreCycle(proj.id, job.data as never, openai, job);
    await cacheDel(`brain:stats:${project_slug}*`);
    return result;
  }

  if (type === "dream") {
    await job.updateProgress(50);
    // Consolidação profunda — busca memórias dormentes
    const dormant = await prisma.memory.findMany({
      where: {
        projectId: proj.id,
        accessCount: { lte: 2 },
        epistemicStatus: { not: "DEPRECATED" },
        updatedAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
      },
      orderBy: { driftScore: "desc" },
      take: 20,
      select: { id: true, title: true, content: true, type: true },
    });

    if (dormant.length < 2) return { message: "Sem memórias dormentes suficientes", count: 0 };

    const context = dormant.map(m => `[${m.type}] ${m.title}: ${m.content.slice(0, 150)}`).join("\n\n");
    await job.updateProgress(70);

    const completion = await openAiBreaker.execute(() =>
      withRetry(() => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é um sintetizador de conhecimento. Analise memórias dormentes e identifique padrões, conexões ocultas e insights que não são óbvios individualmente. Responda no idioma das memórias." },
          { role: "user", content: `Memórias dormentes do projeto:\n\n${context}\n\nIdentifique: 1) Padrões emergentes, 2) Conexões inesperadas, 3) Conhecimento implícito não capturado` },
        ],
        max_tokens: 1000,
      }))
    );

    const insight = await prisma.memory.create({
      data: {
        projectId: proj.id,
        type: "BRAIN",
        title: `Sonho — ${new Date().toLocaleDateString("pt-BR")}`,
        content: completion.choices[0].message.content ?? "",
        importance: 4,
        tags: ["dream", "emergent-pattern"],
      },
    });

    await cacheDel(`brain:stats:${project_slug}*`);
    await job.updateProgress(100);
    return { insight: insight.id, dormantCount: dormant.length };
  }

  throw new Error(`Tipo de job desconhecido: ${type}`);
}

export function initBrainWorker() {
  const worker = startWorker(processBrainJob);
  if (worker) {
    console.log("[queue] Brain worker iniciado");
  } else {
    console.log("[queue] Modo sync — Redis não configurado");
  }
  return worker;
}
