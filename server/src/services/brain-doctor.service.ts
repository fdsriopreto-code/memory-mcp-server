import { prisma } from "../config/database.js";
import { broadcast } from "../ws.js";
import { generateJSON, getModel, type AIModel } from "./ai-provider.service.js";

// ── Types ──────────────────────────────────────────────────────────────────────
interface DoctorStep {
  op:      string;
  success: boolean;
  result:  string;
  reason?: string;
}

interface DoctorStats {
  linksCreated:      number;
  memoriesPromoted:  number;
  memoriesPinned:    number;
  anchorsCreated:    number;
  synthesized:       boolean;
}

type PlanOp = Record<string, unknown> & { op: string; reason?: string };

const VALID_RELATIONS = ["EXTENDS","SUPERSEDES","CONTRADICTS","DEPENDS_ON","EXAMPLE_OF","RELATED","CAUSES"] as const;
type LinkType = typeof VALID_RELATIONS[number];

// ── Main runner ────────────────────────────────────────────────────────────────
export async function runBrainDoctor(opts: {
  runId:       string;
  projectSlug: string;
  modelId:     string;
  apiKey?:     string;
  goal?:       string;
}): Promise<void> {
  const { runId, projectSlug, modelId, goal } = opts;

  const model = getModel(modelId);
  if (!model) throw new Error(`Modelo "${modelId}" não encontrado`);

  const emit = (event: string, data: Record<string, unknown>) => {
    broadcast(`brain:doctor:${event}`, { runId, project: projectSlug, ...data });
  };

  try {
    emit("start", { model: modelId, goal: goal ?? "manutenção geral" });

    // ── Phase 1: Gather data ─────────────────────────────────────────────────
    emit("phase", { phase: "analyze", message: "🔍 Analisando estado do cérebro..." });

    const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (!project) throw new Error(`Projeto "${projectSlug}" não encontrado`);

    const memories = await prisma.memory.findMany({
      where: { projectId: project.id },
      select: {
        id: true, type: true, title: true, tags: true,
        importance: true, epistemicStatus: true, isPinned: true,
        driftScore: true, accessCount: true, createdAt: true,
      },
      orderBy: { importance: "desc" },
    });

    const links = await prisma.$queryRaw<{ fromId: string; toId: string; relation: string }[]>`
      SELECT ml.from_id AS "fromId", ml.to_id AS "toId", ml.relation
      FROM memory_links ml
      JOIN memories m ON m.id = ml.from_id
      WHERE m.project_id = ${project.id}
    `;

    const linkedIds = new Set([...links.map(l => l.fromId), ...links.map(l => l.toId)]);
    const isolated     = memories.filter(m => !linkedIds.has(m.id));
    const notValidated = memories.filter(m => m.epistemicStatus === "HYPOTHESIS" && m.importance >= 4);
    const bugFixes     = memories.filter(m => m.type === "BUG_FIX");

    emit("phase", {
      phase:   "plan",
      message: `📊 ${memories.length} memórias · ${links.length} links · ${isolated.length} ilhadas · ${notValidated.length} aguardando validação — gerando plano com IA...`,
    });

    // ── Phase 2: AI Planning ─────────────────────────────────────────────────
    const brainState = {
      totalMemories: memories.length,
      totalLinks:    links.length,
      isolated:      isolated.length,
      memories: memories.map(m => ({
        id:         m.id,
        type:       m.type,
        title:      m.title.slice(0, 70),
        importance: m.importance,
        epistemic:  m.epistemicStatus,
        isPinned:   m.isPinned,
        tags:       m.tags.slice(0, 4),
      })),
      existingLinks:                 links.slice(0, 60).map(l => ({ from: l.fromId, to: l.toId, rel: l.relation })),
      isolatedIds:                   isolated.map(m => m.id),
      notValidatedHighImportance:    notValidated.map(m => ({ id: m.id, title: m.title.slice(0, 50) })),
      hasBugFixes: bugFixes.length > 0,
      bugFixCount: bugFixes.length,
    };

    const systemPrompt = `Você é um Médico do Cérebro especializado em manutenção de sistemas de memória de IA.
Analise o estado do conhecimento e prescreva operações de manutenção precisas.

OPERAÇÕES DISPONÍVEIS:
1. relate:    { "op":"relate",    "fromId":"ID", "toId":"ID", "relation":"EXTENDS|SUPERSEDES|CONTRADICTS|DEPENDS_ON|EXAMPLE_OF|RELATED|CAUSES", "reason":"motivo" }
2. promote:   { "op":"promote",   "memoryId":"ID", "reason":"motivo" }  — HYPOTHESIS → VALIDATED
3. pin:       { "op":"pin",       "memoryId":"ID", "reason":"motivo" }  — pina memória crítica
4. vaccinate: { "op":"vaccinate", "reason":"motivo" }                   — cria âncoras de prevenção de bugs
5. synthesize:{ "op":"synthesize","depth":"shallow|normal|deep", "reason":"motivo" }

REGRAS:
- Conecte memórias genuinamente relacionadas (mesmo domínio, dependência técnica, causa-efeito)
- Não crie relates duplicados — verifique existingLinks antes
- Promova apenas memórias com importance >= 4 que representem fatos confirmados
- Pina apenas memórias críticas para segurança ou convenções obrigatórias
- Se há BUG_FIX: inclua vaccinate
- Termine SEMPRE com synthesize como última operação
- Máximo 25 operações no total
- Priorize: conectar ilhadas → promover → pinar → vaccinate → synthesize
- Responda APENAS JSON: { "plan": [ ...operações... ] }`;

    const userPrompt = `Estado do cérebro do projeto "${projectSlug}":
${JSON.stringify(brainState, null, 2).slice(0, 9000)}

${goal ? `🎯 Objetivo especial: ${goal}` : "🎯 Objetivo: manutenção geral — conectar ilhadas, validar memórias confirmadas, prevenir bugs repetidos."}

Gere o plano de manutenção agora.`;

    const planJson = await generateJSON({ model, systemPrompt, userPrompt, apiKey: opts.apiKey });

    let plan: PlanOp[] = [];
    try {
      const parsed = JSON.parse(planJson);
      plan = Array.isArray(parsed.plan) ? parsed.plan as PlanOp[] : [];
    } catch {
      throw new Error("IA retornou JSON inválido para o plano de manutenção");
    }

    await prisma.brainDoctorRun.update({
      where: { id: runId },
      data:  { plan: plan as object[], status: "running" },
    });

    emit("plan", {
      plan,
      total:   plan.length,
      message: `✅ Plano gerado: ${plan.length} operações`,
    });

    // ── Phase 3: Execute plan ────────────────────────────────────────────────
    emit("phase", { phase: "execute", message: "⚡ Executando plano de manutenção..." });

    const stats: DoctorStats = {
      linksCreated:     0,
      memoriesPromoted: 0,
      memoriesPinned:   0,
      anchorsCreated:   0,
      synthesized:      false,
    };

    const steps: DoctorStep[] = [];

    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      const op = String(step.op ?? "");

      emit("action", {
        step:  i + 1,
        total: plan.length,
        op,
        reason: String(step.reason ?? ""),
      });

      let success = true;
      let result  = "";

      try {
        switch (op) {

          case "relate": {
            const fromId   = String(step.fromId ?? "");
            const toId     = String(step.toId   ?? "");
            const relation = String(step.relation ?? "") as LinkType;

            if (!fromId || !toId || !VALID_RELATIONS.includes(relation)) {
              result  = `⚠️ Parâmetros inválidos (fromId=${fromId}, toId=${toId}, relation=${relation})`;
              success = false;
              break;
            }

            try {
              await prisma.memoryLink.create({ data: { fromId, toId, relation, weight: 1.0 } });
              stats.linksCreated++;
              result = `🔗 Link ${relation} criado`;
            } catch (e: unknown) {
              const code = (e as { code?: string }).code;
              if (code === "P2002") result = "ℹ️ Link já existe";
              else if (code === "P2003") { result = "⚠️ Memória não encontrada"; success = false; }
              else { result = `Erro: ${(e as Error).message?.slice(0, 60)}`; success = false; }
            }
            break;
          }

          case "promote": {
            const memoryId = String(step.memoryId ?? "");
            if (!memoryId) { result = "⚠️ memoryId ausente"; success = false; break; }

            const mem = await prisma.memory.findFirst({
              where: { id: memoryId, projectId: project.id },
              select: { id: true, epistemicStatus: true },
            });

            if (!mem)   { result = "⚠️ Memória não encontrada neste projeto"; success = false; break; }
            if (mem.epistemicStatus === "VALIDATED") { result = "ℹ️ Já está VALIDATED"; break; }

            await prisma.memory.update({
              where: { id: memoryId },
              data:  { epistemicStatus: "VALIDATED", validatedCount: { increment: 1 } },
            });
            stats.memoriesPromoted++;
            result = "✅ Promovida → VALIDATED";
            break;
          }

          case "pin": {
            const memoryId = String(step.memoryId ?? "");
            if (!memoryId) { result = "⚠️ memoryId ausente"; success = false; break; }

            await prisma.memory.update({
              where: { id: memoryId },
              data:  { isPinned: true },
            });
            stats.memoriesPinned++;
            result = "📌 Memória pinada";
            break;
          }

          case "vaccinate": {
            const bugFixMems = await prisma.memory.findMany({
              where: { projectId: project.id, type: "BUG_FIX" },
              select: { id: true, title: true },
              take: 25,
            });

            for (const bug of bugFixMems) {
              const existing = await prisma.memoryAnchor.findFirst({
                where: { projectId: project.id, memoryIds: { has: bug.id } },
              });
              if (existing) continue;

              const stopWords = new Set(["para","como","com","que","uma","foi","não","mas","por","isso","quando","onde","deve","nunca"]);
              const keywords  = bug.title
                .toLowerCase()
                .replace(/[^\wÀ-ú\s]/g, " ")
                .split(/\s+/)
                .filter(w => w.length > 3 && !stopWords.has(w))
                .slice(0, 3);

              if (keywords.length === 0) continue;

              await prisma.memoryAnchor.create({
                data: {
                  projectId:   project.id,
                  name:        `🛡️ ${bug.title.slice(0, 55)}`,
                  description: `Âncora automática (Brain Doctor) — previne repetição: ${bug.title}`,
                  pattern:     keywords.join("|"),
                  patternType: "REGEX",
                  memoryIds:   [bug.id],
                  priority:    5,
                  isActive:    true,
                },
              });
              stats.anchorsCreated++;
            }
            result = `💉 ${stats.anchorsCreated} âncoras de prevenção criadas`;
            break;
          }

          case "synthesize": {
            try {
              const { enqueueJob } = await import("../services/queue.service.js") as {
                enqueueJob: (data: unknown) => Promise<unknown>;
              };
              await enqueueJob({ type: "synthesize", project_slug: projectSlug });
              stats.synthesized = true;
              result = "🔮 Síntese CRE enfileirada para execução";
            } catch {
              result = "⚠️ Síntese: fila indisponível — roda automaticamente no ciclo diário";
            }
            break;
          }

          default:
            result  = `❓ Operação desconhecida: "${op}"`;
            success = false;
        }
      } catch (e: unknown) {
        success = false;
        result  = `💥 Erro: ${(e as Error).message?.slice(0, 100) ?? "desconhecido"}`;
      }

      steps.push({ op, success, result, reason: String(step.reason ?? "") });
      emit("result", { step: i + 1, op, success, result });

      // Small delay to avoid overwhelming the DB
      await new Promise(r => setTimeout(r, 80));
    }

    // ── Phase 4: Summary ─────────────────────────────────────────────────────
    const summary =
      `Manutenção concluída: ${stats.linksCreated} links criados, ` +
      `${stats.memoriesPromoted} memórias validadas, ` +
      `${stats.memoriesPinned} pinadas, ` +
      `${stats.anchorsCreated} âncoras de prevenção. ` +
      `${stats.synthesized ? "Síntese CRE enfileirada." : ""}`;

    await prisma.brainDoctorRun.update({
      where: { id: runId },
      data:  {
        status: "done",
        steps:  steps as object[],
        stats:  stats as object,
        summary,
        completedAt: new Date(),
      },
    });

    emit("done", { stats, summary, message: "✅ Manutenção autônoma concluída!" });

  } catch (e: unknown) {
    const error = (e as Error).message ?? "Erro desconhecido";
    console.error("[BrainDoctor] Erro:", error);

    await prisma.brainDoctorRun
      .update({ where: { id: runId }, data: { status: "error", error, completedAt: new Date() } })
      .catch(() => {});

    broadcast("brain:doctor:error", { runId, project: projectSlug, message: error });
  }
}
