import { prisma } from "../config/database.js";

export function initDecayScheduler() {
  // Roda a cada 24h, primeira execução após 1h do start
  setTimeout(() => {
    runDecayPass().catch(e => console.error("[decay]", e));
    setInterval(() => runDecayPass().catch(e => console.error("[decay]", e)), 24 * 60 * 60_000);
  }, 60 * 60_000);
  console.log("[decay] Scheduler iniciado — primeiro ciclo em 1h");
}

export async function runDecayPass(): Promise<{ decayed: number; reinforced: number }> {
  console.log("[decay] Iniciando ciclo de decaimento...");
  const projects = await prisma.project.findMany({ select: { id: true, slug: true } });
  let total = { decayed: 0, reinforced: 0 };

  for (const proj of projects) {
    const r = await decayProject(proj.id);
    total.decayed += r.decayed;
    total.reinforced += r.reinforced;
  }

  console.log(`[decay] Ciclo completo: ${total.reinforced} reforçadas, ${total.decayed} decaíram`);
  return total;
}

async function decayProject(projectId: string): Promise<{ decayed: number; reinforced: number }> {
  const now = new Date();
  const day7  = new Date(now.getTime() - 7  * 86_400_000);
  const day30 = new Date(now.getTime() - 30 * 86_400_000);

  const memories = await prisma.memory.findMany({
    where: { projectId },
    select: { id: true, importance: true, driftScore: true },
  });

  let decayed = 0, reinforced = 0;

  for (const mem of memories) {
    const [hot, warm] = await Promise.all([
      prisma.memoryAccessLog.count({ where: { memoryId: mem.id, accessedAt: { gte: day7 } } }),
      prisma.memoryAccessLog.count({ where: { memoryId: mem.id, accessedAt: { gte: day30 } } }),
    ]);

    let drift = mem.driftScore;
    let imp   = mem.importance;

    if (hot >= 3) {
      // Memória quente: reforça
      drift = Math.max(0, drift - 0.15);
      if (hot >= 5 && imp < 5) { imp = Math.min(5, imp + 1); reinforced++; }
      else reinforced++;
    } else if (warm === 0) {
      // Sem acesso em 30 dias: decai
      drift = Math.min(1, drift + 0.10);
      if (drift >= 0.8 && imp > 1) { imp = imp - 1; decayed++; }
    }

    if (drift !== mem.driftScore || imp !== mem.importance) {
      await prisma.memory.update({ where: { id: mem.id }, data: { driftScore: drift, importance: imp } });
    }
  }

  return { decayed, reinforced };
}
