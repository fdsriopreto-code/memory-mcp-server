import { prisma } from "../config/database.js";

// ── Tipos internos ────────────────────────────────────────────────────────────
interface RawMemory {
  id: string; type: string; title: string; content: string;
  tags: string[]; importance: number; accessCount: number;
  epistemicStatus: string; driftScore: number; createdAt: Date;
}
interface TopicEntry { topic: string; count: number; keywords: string[] }
interface GapEntry   { area: string; description: string; priority: "high"|"medium"|"low" }
interface Insight    { title: string; body: string; type: string; confidence: number }

// ── Bootstrap ─────────────────────────────────────────────────────────────────
export function initSynthesisScheduler() {
  scheduleNextRun();
  console.log("[synthesis] Scheduler iniciado — próxima síntese às 03:00 UTC");
}

function scheduleNextRun() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 3, 0, 0));
  const ms   = next.getTime() - now.getTime();
  setTimeout(async () => {
    await runSynthesisCycle().catch(e => console.error("[synthesis] erro no ciclo:", e));
    scheduleNextRun();
  }, ms);
  console.log(`[synthesis] Próximo ciclo em ${Math.round(ms / 60_000)} min`);
}

// ── Ciclo principal ───────────────────────────────────────────────────────────
export async function runSynthesisCycle(): Promise<void> {
  console.log("[synthesis] ▶ Iniciando ciclo autônomo...");
  const projects = await prisma.project.findMany({ select: { id: true, slug: true, name: true } });

  for (const proj of projects) {
    try {
      await synthesizeProject(proj.id, proj.name);
    } catch (e) {
      console.error(`[synthesis] Erro no projeto ${proj.slug}:`, e);
    }
  }
  console.log("[synthesis] ✅ Ciclo completo");
}

async function synthesizeProject(projectId: string, projectName: string) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { console.warn("[synthesis] OPENAI_API_KEY não definida — pulando"); return; }

  const now   = new Date();
  const day1  = new Date(now.getTime() - 1  * 86_400_000);
  const day7  = new Date(now.getTime() - 7  * 86_400_000);
  const day30 = new Date(now.getTime() - 30 * 86_400_000);

  // Memórias das últimas 24h (candidatas à síntese diária)
  const recent = await prisma.memory.findMany({
    where: { projectId, createdAt: { gte: day1 }, type: { not: "SYNTHESIS" } },
    orderBy: { importance: "desc" },
    take: 50,
  }) as unknown as RawMemory[];

  // Memórias da semana toda
  const week = await prisma.memory.findMany({
    where: { projectId, createdAt: { gte: day7 }, type: { not: "SYNTHESIS" } },
    orderBy: [{ importance: "desc" }, { accessCount: "desc" }],
    take: 200,
  }) as unknown as RawMemory[];

  // Hot topics: mais acessadas esta semana
  const hotRows = await prisma.$queryRaw<{ memory_id: string; cnt: bigint }[]>`
    SELECT memory_id, COUNT(*) AS cnt
    FROM memory_access_logs
    WHERE project_id = ${projectId} AND accessed_at >= ${day7}
    GROUP BY memory_id ORDER BY cnt DESC LIMIT 10
  `;
  const hotIds  = hotRows.map(r => r.memory_id);
  const hotMems = hotIds.length ? await prisma.memory.findMany({
    where: { id: { in: hotIds } },
    select: { id: true, title: true, type: true, tags: true },
  }) : [];

  // Cold topics: importância ≥ 3 mas não acessadas em 30 dias
  const coldMems = await prisma.memory.findMany({
    where: {
      projectId, importance: { gte: 3 },
      OR: [{ accessedAt: null }, { accessedAt: { lt: day30 } }],
      type: { not: "SYNTHESIS" },
    },
    select: { id: true, title: true, type: true, tags: true, importance: true },
    take: 15,
  });

  // Saúde geral
  const [total, deprecated, validated, withEmb] = await Promise.all([
    prisma.memory.count({ where: { projectId } }),
    prisma.memory.count({ where: { projectId, epistemicStatus: "DEPRECATED" } }),
    prisma.memory.count({ where: { projectId, epistemicStatus: "VALIDATED" } }),
    prisma.$queryRaw<[{ c: bigint }]>`
      SELECT COUNT(*) AS c FROM memories WHERE project_id = ${projectId} AND embedding IS NOT NULL
    `,
  ]);
  const embCount   = Number((withEmb as any)[0]?.c ?? 0);
  const healthScore = calcHealthScore({ total, deprecated, validated, embCount, hotCount: hotMems.length, coldCount: coldMems.length });

  // ── Síntese diária: se há memórias novas suficientes ──────────────────────
  let newSyntheses = 0;
  if (recent.length >= 3) {
    const synthesis = await callGPT(openaiKey, buildDailySynthesisPrompt(projectName, recent));
    if (synthesis) {
      const insights: Insight[] = tryParseJson(synthesis, []);
      for (const ins of insights.slice(0, 5)) {
        if (!ins.title || !ins.body) continue;
        await prisma.memory.create({
          data: {
            projectId,
            type: "SYNTHESIS" as never,
            title: `[Síntese] ${ins.title}`,
            content: ins.body,
            tags: ["auto-synthesis", ins.type ?? "insight"],
            importance: Math.min(5, Math.max(1, Math.round((ins.confidence ?? 0.7) * 5))),
            epistemicStatus: "HYPOTHESIS" as never,
          },
        });
        newSyntheses++;
      }
      console.log(`[synthesis] ${projectName}: +${newSyntheses} sínteses criadas`);
    }
  }

  // ── Digest semanal: toda semana (verifica se já tem digest desta semana) ──
  const weekLabel = getWeekLabel(now);
  const existing  = await (prisma as any).brainDigest.findFirst({
    where: { projectId, period: weekLabel },
  });

  if (!existing && week.length >= 5) {
    const gapPrompt = buildGapPrompt(projectName, week, hotMems as any, coldMems as any);
    const [narrativeRaw, gapsRaw] = await Promise.all([
      callGPT(openaiKey, buildWeeklyNarrativePrompt(projectName, week, hotMems as any, coldMems as any)),
      callGPT(openaiKey, gapPrompt),
    ]);

    const gaps: GapEntry[] = tryParseJson(gapsRaw ?? "[]", []);
    const hotTopics: TopicEntry[] = extractTopics(hotMems as any);
    const coldTopics: TopicEntry[] = extractTopics(coldMems as any);

    await (prisma as any).brainDigest.create({
      data: {
        projectId,
        type: "weekly",
        period: weekLabel,
        summary: narrativeRaw ?? "Sem dados suficientes esta semana.",
        insights: week.slice(0, 10).map(m => ({ id: m.id, title: m.title, type: m.type })),
        hotTopics,
        coldTopics,
        gaps,
        healthScore,
        memoriesIn: week.length,
        newSyntheses,
      },
    });
    console.log(`[synthesis] ${projectName}: digest semanal ${weekLabel} gerado (health=${healthScore})`);
  }
}

// ── GPT helpers ───────────────────────────────────────────────────────────────
async function callGPT(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const { openAiBreaker, withRetry } = await import("../services/circuit-breaker.service.js");
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey });
    const res = await openAiBreaker.execute(() =>
      withRetry(() => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
        temperature: 0.4,
      }))
    ) as { choices: { message: { content: string | null } }[] };
    return res.choices[0].message.content;
  } catch (e) {
    console.warn("[synthesis] GPT call falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}

function buildDailySynthesisPrompt(project: string, memories: RawMemory[]): string {
  const ctx = memories.map(m => `[${m.type}] ${m.title}: ${m.content.slice(0, 200)}`).join("\n");
  return `Você é um motor de síntese de conhecimento para o projeto "${project}".
Analise as memórias abaixo (criadas nas últimas 24h) e extraia INSIGHTS consolidados.
Retorne SOMENTE um JSON array, sem markdown, no formato:
[{"title":"Título do insight","body":"Descrição detalhada do que foi aprendido e por quê importa","type":"pattern|decision|risk|opportunity","confidence":0.8}]
Máximo 5 insights. Seja direto e específico. Insights vagos não têm valor.

Memórias:
${ctx}`;
}

function buildWeeklyNarrativePrompt(project: string, week: RawMemory[], hot: {title:string;type:string}[], cold: {title:string;type:string}[]): string {
  const ctx   = week.slice(0, 30).map(m => `[${m.type}] ${m.title}`).join("\n");
  const hotS  = hot.map(m => m.title).join(", ") || "nenhum";
  const coldS = cold.slice(0, 5).map(m => m.title).join(", ") || "nenhum";
  return `Você é o assistente pessoal de conhecimento do projeto "${project}".
Escreva um DIGEST SEMANAL narrativo (3-5 parágrafos, em português) resumindo:
- O que evoluiu esta semana
- Padrões identificados
- Pontos que precisam atenção
- Direção recomendada para a próxima semana

Tópicos quentes (mais acessados): ${hotS}
Tópicos esquecidos (sem acesso): ${coldS}
Memórias da semana:
${ctx}

Seja específico. Mencione nomes reais dos tópicos. Não seja genérico.`;
}

function buildGapPrompt(project: string, week: RawMemory[], hot: {title:string}[], cold: {title:string}[]): string {
  const titles = week.map(m => m.title).join(", ");
  return `Você analisa gaps de conhecimento no projeto "${project}".
Com base nas memórias existentes (${week.length} total), identifique LACUNAS — áreas que provavelmente deveriam ter documentação mas não têm.
Retorne SOMENTE JSON array sem markdown:
[{"area":"Nome da área","description":"Por que é um gap e o que falta documentar","priority":"high|medium|low"}]
Máximo 5 gaps. Seja específico ao projeto, não genérico.

Memórias existentes: ${titles.slice(0, 500)}`;
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function calcHealthScore({ total, deprecated, validated, embCount, hotCount, coldCount }: {
  total: number; deprecated: number; validated: number;
  embCount: number; hotCount: number; coldCount: number;
}): number {
  if (total === 0) return 0;
  const validatedRatio  = validated / total;
  const deprecatedRatio = deprecated / total;
  const embRatio        = embCount / total;
  const activityBonus   = Math.min(20, hotCount * 2);
  const coldPenalty     = Math.min(15, coldCount);
  const score = Math.round(
    validatedRatio  * 35 +
    (1 - deprecatedRatio) * 20 +
    embRatio        * 25 +
    activityBonus        -
    coldPenalty
  );
  return Math.max(0, Math.min(100, score));
}

function getWeekLabel(d: Date): string {
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + jan1.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function extractTopics(mems: { title: string; type: string; tags?: string[] }[]): TopicEntry[] {
  const map = new Map<string, { count: number; keywords: string[] }>();
  for (const m of mems) {
    const key = m.type;
    if (!map.has(key)) map.set(key, { count: 0, keywords: [] });
    const e = map.get(key)!;
    e.count++;
    e.keywords.push(m.title.split(" ").slice(0, 3).join(" "));
  }
  return Array.from(map.entries()).map(([topic, v]) => ({ topic, count: v.count, keywords: v.keywords.slice(0, 5) }));
}

function tryParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

// ── Trigger manual (chamado pela rota POST /synthesize) ───────────────────────
export async function triggerSynthesis(projectId: string): Promise<{ ok: boolean; message: string }> {
  const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!proj) return { ok: false, message: "Projeto não encontrado" };
  await synthesizeProject(proj.id, proj.name);
  return { ok: true, message: "Síntese concluída" };
}
