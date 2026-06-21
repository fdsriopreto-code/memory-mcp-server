/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║          COGNITIVE RESONANCE EVOLUTION (CRE) — v1.0                    ║
 * ║                                                                          ║
 * ║  A self-evolving knowledge algorithm that learns its own parameters.    ║
 * ║                                                                          ║
 * ║  Phases per cycle:                                                       ║
 * ║    1. OBSERVE   — calculate resonance score R(m) per memory             ║
 * ║    2. ASSOCIATE — update synaptic weights via Hebbian co-resonance       ║
 * ║    3. CRYSTALLIZE — synthesize emergent insights from hot clusters       ║
 * ║    4. PRUNE     — remove decayed synapses, flag dead memories            ║
 * ║    5. EVOLVE    — self-modify λ, θ, σ based on observed brain state     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z }              from "zod";
import { prisma }         from "../config/database.js";
import OpenAI             from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── CRE parameter defaults ────────────────────────────────────────────────────
interface CreParams {
  decay_rate:            number;  // λ  — how fast unused memories lose resonance
  crystallize_threshold: number;  // θ  — min cluster size to trigger synthesis
  synapse_sensitivity:   number;  // σ  — min co-resonance to strengthen a synapse
  prune_weight:          number;  // τ  — synapse weight below which it is pruned
  evolution_cycle:       number;  // cycle counter
  brain_age_days:        number;  // total days since first cycle
  last_synthesized:      string;  // ISO date of last synthesis
  total_crystals:        number;  // total synthesis memories ever created
}

const DEFAULT_PARAMS: CreParams = {
  decay_rate:            0.05,
  crystallize_threshold: 4,
  synapse_sensitivity:   0.55,
  prune_weight:          0.08,
  evolution_cycle:       0,
  brain_age_days:        0,
  last_synthesized:      new Date(0).toISOString(),
  total_crystals:        0,
};

const PARAMS_TITLE = "__BRAIN_CRE_PARAMS__";

// ── Resonance formula: R(m) = (accessCount × importance) / (1 + λ × age_days)
function resonance(accessCount: number, importance: number, ageDays: number, λ: number): number {
  return (accessCount * importance) / (1 + λ * ageDays);
}

function daysSince(date: Date | string): number {
  return Math.max(0, (Date.now() - new Date(date).getTime()) / 86_400_000);
}

// ── Load or create CRE params for project ────────────────────────────────────
async function loadParams(projectId: string): Promise<CreParams & { memId: string | null }> {
  const m = await prisma.memory.findFirst({
    where: { projectId, title: PARAMS_TITLE, type: "BRAIN" },
  });
  if (!m) return { ...DEFAULT_PARAMS, memId: null };
  try {
    const parsed = JSON.parse(m.content) as Partial<CreParams>;
    return { ...DEFAULT_PARAMS, ...parsed, memId: m.id };
  } catch {
    return { ...DEFAULT_PARAMS, memId: m.id };
  }
}

async function saveParams(projectId: string, params: CreParams, memId: string | null): Promise<string> {
  const content = JSON.stringify(params, null, 2);
  if (memId) {
    await prisma.memory.update({
      where: { id: memId },
      data: { content, accessedAt: new Date(), accessCount: { increment: 1 } },
    });
    return memId;
  } else {
    const m = await prisma.memory.create({
      data: {
        projectId, type: "BRAIN", title: PARAMS_TITLE,
        content, tags: ["cre", "params", "auto"],
        importance: 5, isPinned: true,
      },
    });
    return m.id;
  }
}

// ── AI synthesis via GPT-4o-mini ─────────────────────────────────────────────
async function synthesizeCluster(
  projectName: string,
  cluster: { title: string; content: string; type: string; resonance: number }[],
): Promise<{ title: string; insight: string } | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are the synthesis engine of a self-evolving AI brain for project "${projectName}".
You receive a cluster of co-activated memories and generate ONE emergent insight that the cluster implies together.
The insight should be non-obvious — something that ONLY emerges from combining all memories, not something any single memory already says.
Return JSON: { "title": "concise insight title (max 10 words)", "insight": "deep explanation in 2-4 sentences" }`,
        },
        {
          role: "user",
          content: cluster.map((m, i) =>
            `[${i + 1}] (${m.type}, resonance=${m.resonance.toFixed(2)})\n${m.title}\n${m.content}`
          ).join("\n\n---\n\n"),
        },
      ],
    });
    const raw = JSON.parse(resp.choices[0].message.content ?? "{}");
    if (typeof raw.title === "string" && typeof raw.insight === "string") {
      return { title: raw.title, insight: raw.insight };
    }
    return null;
  } catch { return null; }
}

// ═════════════════════════════════════════════════════════════════════════════
// TOOL: brain_synthesize
// ═════════════════════════════════════════════════════════════════════════════
export function registerCreTools(server: McpServer) {

  server.tool(
    "brain_synthesize",
    "Run a full CRE (Cognitive Resonance Evolution) cycle. The brain observes resonance patterns, strengthens active synapses, crystallizes emergent insights, prunes weak connections, and self-modifies its own learning parameters. Call after significant sessions.",
    {
      project:   z.string().describe("Project slug"),
      dry_run:   z.boolean().optional().describe("Preview without saving changes"),
      depth:     z.enum(["shallow","normal","deep"]).optional().describe("Synthesis depth: shallow=stats only, normal=+crystallize, deep=+prune+evolve params"),
    },
    async ({ project, dry_run = false, depth = "normal" }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: `Projeto '${project}' não encontrado.` }] };

      const { memId, ...params } = await loadParams(proj.id);
      const report: string[] = [];
      const now = new Date();

      report.push(`╔══════════════════════════════════════════════╗`);
      report.push(`║  CRE Cycle #${params.evolution_cycle + 1} — ${proj.name}`);
      report.push(`╚══════════════════════════════════════════════╝\n`);
      report.push(`📍 Parâmetros atuais:`);
      report.push(`   λ (decay_rate)        = ${params.decay_rate.toFixed(4)}`);
      report.push(`   θ (crystallize_thresh) = ${params.crystallize_threshold}`);
      report.push(`   σ (synapse_sensitivity)= ${params.synapse_sensitivity.toFixed(3)}`);
      report.push(`   τ (prune_weight)       = ${params.prune_weight.toFixed(3)}\n`);

      // ── PHASE 1: OBSERVE — calculate resonance ──────────────────────────────
      report.push(`▶ FASE 1 — OBSERVAÇÃO`);

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id, title: { not: PARAMS_TITLE } },
        include: { links: true, linkedBy: true },
      });

      type ScoredMemory = typeof memories[0] & { R: number; ageDays: number };

      const scored: ScoredMemory[] = memories.map(m => {
        const ageDays = daysSince(m.createdAt);
        const R = resonance(m.accessCount, m.importance, ageDays, params.decay_rate);
        return { ...m, R, ageDays };
      });

      const maxR   = Math.max(...scored.map(m => m.R), 0.001);
      const hot    = scored.filter(m => m.R / maxR > 0.6);
      const warm   = scored.filter(m => m.R / maxR >= 0.15 && m.R / maxR <= 0.6);
      const cold   = scored.filter(m => m.R / maxR < 0.15);

      report.push(`   Total memórias: ${scored.length}`);
      report.push(`   🔥 Quentes  (R > 60%): ${hot.length}`);
      report.push(`   🌡 Mornas   (R 15-60%): ${warm.length}`);
      report.push(`   🧊 Frias    (R < 15%): ${cold.length}`);
      report.push(`   Pico de ressonância: ${maxR.toFixed(3)}\n`);

      // ── PHASE 2: ASSOCIATE — Hebbian synaptic weight update ─────────────────
      report.push(`▶ FASE 2 — ASSOCIAÇÃO SINÁPTICA (Hebbian)`);

      const links = await prisma.memoryLink.findMany({
        where: { from: { projectId: proj.id } },
      });

      const scoreMap = new Map(scored.map(m => [m.id, m.R / maxR]));
      let strengthened = 0, pruneCount = 0;

      for (const link of links) {
        const rFrom = scoreMap.get(link.fromId) ?? 0;
        const rTo   = scoreMap.get(link.toId)   ?? 0;
        const coResonance = Math.sqrt(rFrom * rTo); // geometric mean

        // Hebbian update: Δw = σ × coResonance - (1-σ) × (1-coResonance)
        const newWeight = link.weight * 0.88 + coResonance * 0.12;

        if (!dry_run) {
          if (newWeight < params.prune_weight && depth === "deep") {
            await prisma.memoryLink.delete({ where: { id: link.id } });
            pruneCount++;
          } else {
            await prisma.memoryLink.update({
              where: { id: link.id },
              data: { weight: Math.min(2.0, Math.max(0.001, newWeight)) },
            });
            if (coResonance >= params.synapse_sensitivity) strengthened++;
          }
        } else {
          if (newWeight < params.prune_weight) pruneCount++;
          if (coResonance >= params.synapse_sensitivity) strengthened++;
        }
      }

      report.push(`   Sinapses analisadas: ${links.length}`);
      report.push(`   💪 Reforçadas (co-res ≥ σ): ${strengthened}`);
      if (depth === "deep") report.push(`   ✂️  Podadas (peso < τ): ${pruneCount}\n`);
      else report.push(`\n`);

      // ── PHASE 3: CRYSTALLIZE — emergent synthesis ───────────────────────────
      let crystalsCreated = 0;
      let newCrystalIds: string[] = [];

      if (depth !== "shallow") {
        report.push(`▶ FASE 3 — CRISTALIZAÇÃO EMERGENTE`);

        // Group by type — find "resonant type clusters"
        const typeGroups = new Map<string, ScoredMemory[]>();
        for (const m of hot) {
          if (m.type === "BRAIN") continue; // skip brain meta-memories
          const g = typeGroups.get(m.type) ?? [];
          g.push(m);
          typeGroups.set(m.type, g);
        }

        // Also cluster by shared tags
        const tagGroups = new Map<string, ScoredMemory[]>();
        for (const m of [...hot, ...warm.slice(0, 3)]) {
          for (const tag of m.tags) {
            const g = tagGroups.get(tag) ?? [];
            g.push(m);
            tagGroups.set(tag, g);
          }
        }

        // Merge: use both type-groups and large tag-groups
        const clusters: ScoredMemory[][] = [];
        for (const [, g] of typeGroups) {
          if (g.length >= params.crystallize_threshold) clusters.push(g.slice(0, 8));
        }
        for (const [, g] of tagGroups) {
          if (g.length >= params.crystallize_threshold + 1 && !clusters.some(c => c.some(m => g.includes(m)))) {
            clusters.push(g.slice(0, 8));
          }
        }

        report.push(`   Clusters candidatos: ${clusters.length} (θ=${params.crystallize_threshold})`);

        for (const cluster of clusters.slice(0, 3)) { // max 3 per cycle
          const avgR = cluster.reduce((s, m) => s + m.R / maxR, 0) / cluster.length;
          report.push(`   🔬 Cluster [${cluster[0].type}×${cluster.length}] avgR=${avgR.toFixed(2)}`);

          if (!dry_run) {
            const synthesis = await synthesizeCluster(
              proj.name,
              cluster.map(m => ({ title: m.title, content: m.content.slice(0, 400), type: m.type, resonance: m.R / maxR })),
            );

            if (synthesis) {
              const crystal = await prisma.memory.create({
                data: {
                  projectId: proj.id,
                  type: "BRAIN",
                  title: `⟡ ${synthesis.title}`,
                  content: `${synthesis.insight}\n\n[Cristalizado pelo CRE Ciclo #${params.evolution_cycle + 1} de ${cluster.length} memórias]`,
                  tags: ["cre-synthesis", `cycle-${params.evolution_cycle + 1}`, ...new Set(cluster.flatMap(m => m.tags)).values()].slice(0, 8),
                  importance: Math.min(5, Math.round(avgR * 5) + 2),
                },
              });
              newCrystalIds.push(crystal.id);

              // Link crystal to all source memories
              for (const m of cluster) {
                await prisma.memoryLink.upsert({
                  where: { fromId_toId_relation: { fromId: crystal.id, toId: m.id, relation: "DEPENDS_ON" } },
                  create: { fromId: crystal.id, toId: m.id, relation: "DEPENDS_ON", weight: avgR * 1.5 },
                  update: { weight: avgR * 1.5 },
                });
              }
              crystalsCreated++;
              report.push(`      ✨ CRISTAL GERADO: "${synthesis.title}"`);
            }
          } else {
            report.push(`      [DRY RUN] Geraria síntese para este cluster`);
          }
        }
        report.push(``);
      }

      // ── PHASE 4: PRUNE — flag dead memories ─────────────────────────────────
      const deadMemories = cold.filter(m =>
        m.accessCount === 0 && m.ageDays > 60 && !m.isPinned
      );

      if (depth === "deep") {
        report.push(`▶ FASE 4 — PODA`);
        report.push(`   🪦 Memórias candidatas à remoção: ${deadMemories.length}`);
        if (deadMemories.length > 0) {
          report.push(`   Candidatas (age > 60d, 0 acessos):`);
          deadMemories.slice(0, 5).forEach(m =>
            report.push(`     • "${m.title}" (${m.type}, ${m.ageDays.toFixed(0)}d)`)
          );
        }
        report.push(``);
      }

      // ── PHASE 5: EVOLVE PARAMETERS ──────────────────────────────────────────
      const newParams = { ...params };
      const deltaReport: string[] = [];

      if (depth === "deep" || depth === "normal") {
        report.push(`▶ FASE 5 — EVOLUÇÃO DE PARÂMETROS`);

        const coldRatio = cold.length / Math.max(scored.length, 1);
        const hotRatio  = hot.length  / Math.max(scored.length, 1);

        // λ adjustment: too many cold → slow decay; all hot → speed up decay
        if (coldRatio > 0.50) {
          newParams.decay_rate = Math.max(0.01, params.decay_rate * 0.88);
          deltaReport.push(`λ ↓ ${params.decay_rate.toFixed(4)} → ${newParams.decay_rate.toFixed(4)} (muitas frias: ${(coldRatio*100).toFixed(0)}%)`);
        } else if (hotRatio > 0.55) {
          newParams.decay_rate = Math.min(0.25, params.decay_rate * 1.12);
          deltaReport.push(`λ ↑ ${params.decay_rate.toFixed(4)} → ${newParams.decay_rate.toFixed(4)} (muitas quentes: ${(hotRatio*100).toFixed(0)}%)`);
        }

        // θ adjustment: if no crystals → lower threshold; if >3 per cycle → raise
        if (crystalsCreated === 0 && newParams.crystallize_threshold > 2) {
          newParams.crystallize_threshold = Math.max(2, params.crystallize_threshold - 1);
          deltaReport.push(`θ ↓ ${params.crystallize_threshold} → ${newParams.crystallize_threshold} (0 cristais neste ciclo)`);
        } else if (crystalsCreated > 3) {
          newParams.crystallize_threshold = Math.min(10, params.crystallize_threshold + 1);
          deltaReport.push(`θ ↑ ${params.crystallize_threshold} → ${newParams.crystallize_threshold} (${crystalsCreated} cristais: muito produtivo)`);
        }

        // σ adjustment: if synapse density low → lower sensitivity
        const linkDensity = links.length / Math.max(scored.length, 1);
        if (linkDensity < 0.5 && newParams.synapse_sensitivity > 0.3) {
          newParams.synapse_sensitivity = Math.max(0.3, params.synapse_sensitivity - 0.03);
          deltaReport.push(`σ ↓ ${params.synapse_sensitivity.toFixed(3)} → ${newParams.synapse_sensitivity.toFixed(3)} (baixa densidade sináptica: ${linkDensity.toFixed(2)})`);
        } else if (linkDensity > 3.0) {
          newParams.synapse_sensitivity = Math.min(0.95, params.synapse_sensitivity + 0.02);
          deltaReport.push(`σ ↑ ${params.synapse_sensitivity.toFixed(3)} → ${newParams.synapse_sensitivity.toFixed(3)} (alta densidade: ${linkDensity.toFixed(2)})`);
        }

        newParams.evolution_cycle    = params.evolution_cycle + 1;
        newParams.brain_age_days     = params.brain_age_days + daysSince(params.last_synthesized);
        newParams.last_synthesized   = now.toISOString();
        newParams.total_crystals     = params.total_crystals + crystalsCreated;

        if (deltaReport.length > 0) {
          report.push(`   Mudanças de parâmetros:`);
          deltaReport.forEach(d => report.push(`   ⚙️  ${d}`));
        } else {
          report.push(`   ✅ Parâmetros estáveis — sem ajustes necessários`);
        }
        report.push(``);
      }

      // Save params
      if (!dry_run) {
        await saveParams(proj.id, newParams, memId ?? null);
      }

      // ── FINAL SUMMARY ───────────────────────────────────────────────────────
      report.push(`══════════════════════════════════════════════`);
      report.push(`RESUMO DO CICLO CRE #${newParams.evolution_cycle}`);
      report.push(`──────────────────────────────────────────────`);
      report.push(`Memórias analisadas : ${scored.length}`);
      report.push(`Sinapses reforçadas : ${strengthened}`);
      report.push(`Sinapses podadas    : ${pruneCount}`);
      report.push(`Cristais gerados    : ${crystalsCreated}`);
      report.push(`Mortas candidatas   : ${deadMemories.length}`);
      report.push(`Total cristais ever : ${newParams.total_crystals}`);
      report.push(`Brain age           : ${newParams.brain_age_days.toFixed(1)} dias`);
      if (dry_run) report.push(`\n⚠️  DRY RUN — nenhuma mudança foi salva`);

      return { content: [{ type: "text" as const, text: report.join("\n") }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: brain_pulse
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "brain_pulse",
    "Get the current CRE brain state: parameters, resonance distribution, synapse health, and recommended next action.",
    {
      project: z.string().describe("Project slug"),
    },
    async ({ project }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const { memId: _m, ...params } = await loadParams(proj.id);

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id, title: { not: PARAMS_TITLE } },
      });

      const scored = memories.map(m => {
        const ageDays = daysSince(m.createdAt);
        const R = resonance(m.accessCount, m.importance, ageDays, params.decay_rate);
        return { ...m, R, ageDays };
      });

      const maxR  = Math.max(...scored.map(m => m.R), 0.001);
      const hot   = scored.filter(m => m.R / maxR > 0.6).length;
      const warm  = scored.filter(m => m.R / maxR >= 0.15 && m.R / maxR <= 0.6).length;
      const cold  = scored.filter(m => m.R / maxR < 0.15).length;

      const links = await prisma.memoryLink.findMany({ where: { from: { projectId: proj.id } } });
      const avgWeight = links.length > 0
        ? links.reduce((s, l) => s + l.weight, 0) / links.length
        : 0;

      const daysSinceLastCycle = daysSince(params.last_synthesized);
      const stateLabel = params.evolution_cycle === 0
        ? "🌱 PRIMORDIAL"
        : daysSinceLastCycle < 1
          ? "⚡ RECÉM EVOLUÍDO"
          : daysSinceLastCycle < 7
            ? "🧠 ATIVO"
            : daysSinceLastCycle < 30
              ? "😴 CONSOLIDANDO"
              : "🌀 PRECISANDO EVOLUIR";

      const crystalMems = memories.filter(m => m.type === "BRAIN" && m.title.startsWith("⟡")).length;

      // Recommend next action
      let recommendation = "";
      if (params.evolution_cycle === 0) {
        recommendation = "Execute `brain_synthesize` com depth=normal para iniciar o primeiro ciclo CRE.";
      } else if (daysSinceLastCycle > 7) {
        recommendation = `Último ciclo há ${daysSinceLastCycle.toFixed(0)}d — execute brain_synthesize depth=deep.`;
      } else if (cold / Math.max(scored.length, 1) > 0.5) {
        recommendation = "50%+ memórias frias — brain_synthesize depth=deep para evoluir λ.";
      } else if (crystalMems / Math.max(scored.length, 1) < 0.05 && scored.length > 20) {
        recommendation = "Baixa taxa de cristalização — brain_synthesize depth=normal.";
      } else {
        recommendation = "Brain saudável. Continue capturando memórias via brain_learn.";
      }

      const lines = [
        `🧠 BRAIN PULSE — ${proj.name}`,
        `═══════════════════════════════════════`,
        `Estado: ${stateLabel}`,
        `Ciclo de evolução: #${params.evolution_cycle}`,
        `Idade do brain: ${params.brain_age_days.toFixed(1)} dias`,
        `Último ciclo: ${daysSinceLastCycle.toFixed(1)}d atrás`,
        ``,
        `PARÂMETROS VIVOS:`,
        `  λ decay_rate         = ${params.decay_rate.toFixed(4)}`,
        `  θ crystallize_thresh = ${params.crystallize_threshold}`,
        `  σ synapse_sensitivity= ${params.synapse_sensitivity.toFixed(3)}`,
        `  τ prune_weight       = ${params.prune_weight.toFixed(3)}`,
        ``,
        `ESTADO DO CONHECIMENTO:`,
        `  Total memórias : ${scored.length}`,
        `  🔥 Quentes     : ${hot} (${((hot/Math.max(scored.length,1))*100).toFixed(0)}%)`,
        `  🌡 Mornas      : ${warm} (${((warm/Math.max(scored.length,1))*100).toFixed(0)}%)`,
        `  🧊 Frias       : ${cold} (${((cold/Math.max(scored.length,1))*100).toFixed(0)}%)`,
        `  ⟡  Cristais    : ${crystalMems}`,
        ``,
        `SINAPSES:`,
        `  Total links  : ${links.length}`,
        `  Peso médio   : ${avgWeight.toFixed(3)}`,
        ``,
        `RECOMENDAÇÃO: ${recommendation}`,
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: brain_dream
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "brain_dream",
    "Deep consolidation cycle. The brain 'sleeps': merges near-duplicate memories (semantic overlap), strengthens high-weight synapses to importance boosts, and generates 'dream insights' from unexpected cross-type associations. Run weekly or after large knowledge dumps.",
    {
      project:    z.string().describe("Project slug"),
      dry_run:    z.boolean().optional().describe("Preview without applying changes"),
    },
    async ({ project, dry_run = false }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const { memId: _m, ...params } = await loadParams(proj.id);

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id, title: { not: PARAMS_TITLE } },
      });

      const scored = memories.map(m => ({
        ...m,
        ageDays: daysSince(m.createdAt),
        R: resonance(m.accessCount, m.importance, daysSince(m.createdAt), params.decay_rate),
      }));
      const maxR = Math.max(...scored.map(m => m.R), 0.001);

      const report: string[] = [
        `💤 BRAIN DREAM — ${proj.name}`,
        `═════════════════════════════════════════`,
        ``,
      ];

      // ── Dream phase 1: boost high-resonance memories ───────────────────────
      report.push(`▶ CONSOLIDAÇÃO: Reforço de memórias quentes`);
      let boosted = 0;
      for (const m of scored) {
        const normalR = m.R / maxR;
        if (normalR > 0.75 && m.importance < 5) {
          if (!dry_run) {
            await prisma.memory.update({
              where: { id: m.id },
              data: { importance: Math.min(5, m.importance + 1) },
            });
          }
          report.push(`   ⬆️  "${m.title.slice(0, 50)}" imp ${m.importance} → ${Math.min(5, m.importance + 1)}`);
          boosted++;
        }
      }
      if (boosted === 0) report.push(`   Nenhuma memória precisou de reforço.`);
      report.push(``);

      // ── Dream phase 2: cross-type unexpected associations ──────────────────
      report.push(`▶ SONHO: Associações inesperadas cross-type`);

      // Find pairs of hot memories from DIFFERENT types that share tags
      const hotMems = scored.filter(m => m.R / maxR > 0.5 && m.type !== "BRAIN" && m.tags.length > 0);
      const dreamPairs: [typeof hotMems[0], typeof hotMems[0]][] = [];

      for (let i = 0; i < hotMems.length; i++) {
        for (let j = i + 1; j < hotMems.length; j++) {
          if (hotMems[i].type === hotMems[j].type) continue;
          const sharedTags = hotMems[i].tags.filter(t => hotMems[j].tags.includes(t));
          if (sharedTags.length > 0) {
            dreamPairs.push([hotMems[i], hotMems[j]]);
          }
        }
      }

      report.push(`   Pares de sonho encontrados: ${dreamPairs.length}`);

      let dreamInsights = 0;
      for (const [a, b] of dreamPairs.slice(0, 4)) {
        if (!dry_run && process.env.OPENAI_API_KEY) {
          const synthesis = await synthesizeCluster(proj.name, [
            { title: a.title, content: a.content.slice(0, 300), type: a.type, resonance: a.R / maxR },
            { title: b.title, content: b.content.slice(0, 300), type: b.type, resonance: b.R / maxR },
          ]);
          if (synthesis) {
            const shared = a.tags.filter(t => b.tags.includes(t));
            await prisma.memory.create({
              data: {
                projectId: proj.id,
                type: "BRAIN",
                title: `💭 ${synthesis.title}`,
                content: `${synthesis.insight}\n\n[Insight de sonho CRE: conexão inesperada ${a.type} × ${b.type}]`,
                tags: ["cre-dream", ...shared].slice(0, 6),
                importance: 4,
              },
            });
            dreamInsights++;
            report.push(`   💭 "${synthesis.title}" (${a.type} × ${b.type})`);
          }
        } else if (dry_run) {
          report.push(`   [DRY RUN] ${a.type}×${b.type}: "${a.title.slice(0,30)}" + "${b.title.slice(0,30)}"`);
        }
      }
      report.push(``);
      report.push(`══════════════════════════════════════════`);
      report.push(`SONHO CONCLUÍDO`);
      report.push(`  Memórias reforçadas : ${boosted}`);
      report.push(`  Insights de sonho  : ${dreamInsights}`);
      if (dry_run) report.push(`  ⚠️  DRY RUN — sem mudanças`);

      return { content: [{ type: "text" as const, text: report.join("\n") }] };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOL: brain_resonance_map
  // ═══════════════════════════════════════════════════════════════════════════
  server.tool(
    "brain_resonance_map",
    "Return the full resonance map: each memory with its normalized resonance score, state (hot/warm/cold), and synapse weight. Useful for understanding what the brain currently considers most important.",
    {
      project: z.string().describe("Project slug"),
      top:     z.number().optional().describe("Return only top N by resonance (default 20)"),
      state:   z.enum(["hot","warm","cold","all"]).optional().describe("Filter by resonance state"),
    },
    async ({ project, top = 20, state = "all" }) => {
      const proj = await prisma.project.findUnique({ where: { slug: project } });
      if (!proj) return { content: [{ type: "text" as const, text: "Projeto não encontrado." }] };

      const { memId: _m, ...params } = await loadParams(proj.id);

      const memories = await prisma.memory.findMany({
        where: { projectId: proj.id, title: { not: PARAMS_TITLE } },
      });

      const scored = memories.map(m => ({
        id: m.id,
        title: m.title,
        type: m.type,
        R: resonance(m.accessCount, m.importance, daysSince(m.createdAt), params.decay_rate),
        accessCount: m.accessCount,
        ageDays: daysSince(m.createdAt),
        importance: m.importance,
      }));

      const maxR = Math.max(...scored.map(m => m.R), 0.001);
      const withNorm = scored
        .map(m => ({ ...m, normR: m.R / maxR, stateLabel: m.R / maxR > 0.6 ? "🔥" : m.R / maxR >= 0.15 ? "🌡" : "🧊" }))
        .filter(m => state === "all" || (state === "hot" && m.normR > 0.6) || (state === "warm" && m.normR >= 0.15 && m.normR <= 0.6) || (state === "cold" && m.normR < 0.15))
        .sort((a, b) => b.normR - a.normR)
        .slice(0, top);

      const lines = [
        `🌡 MAPA DE RESSONÂNCIA — ${proj.name}`,
        `λ=${params.decay_rate.toFixed(4)}  ciclo=#${params.evolution_cycle}`,
        `${"─".repeat(70)}`,
        `${"Estado".padEnd(4)} ${"Ressonância".padEnd(12)} ${"Tipo".padEnd(14)} ${"Título".padEnd(40)}`,
        `${"─".repeat(70)}`,
        ...withNorm.map(m =>
          `${m.stateLabel.padEnd(4)} ${(m.normR * 100).toFixed(1).padStart(6)}%      ${m.type.padEnd(14)} ${m.title.slice(0, 40)}`
        ),
        `${"─".repeat(70)}`,
        `Total exibidas: ${withNorm.length} de ${memories.length}`,
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
