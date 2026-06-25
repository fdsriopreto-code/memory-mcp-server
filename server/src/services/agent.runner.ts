import { prisma } from "../config/database.js";
import { broadcast } from "../ws.js";
import { sendToComputer, getComputerAgents } from "../ws.js";
import OpenAI from "openai";
import { extractMemoriesFromText } from "./ai.service.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function webSearch(query: string, count = 5): Promise<string> {
  // Tavily (free 1000/mês — tavily.com) se configurado
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavilyKey, query, max_results: count, search_depth: "basic" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      const results = (data.results ?? []).slice(0, count);
      if (results.length) {
        return results.map((r: any, i: number) =>
          `**${i + 1}. ${r.title}**\n${r.url}\n${r.content?.slice(0, 200) ?? ""}`
        ).join("\n\n");
      }
    }
  }

  // Fallback: DuckDuckGo HTML (sem chave, sempre funciona)
  const resp = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" }, signal: AbortSignal.timeout(15_000) }
  );
  if (!resp.ok) throw new Error(`DuckDuckGo HTTP ${resp.status}`);
  const html = await resp.text();

  const results: string[] = [];
  const blockRe = /class="result__title"[\s\S]*?class="result__url"[^>]*>(.*?)<\/a>[\s\S]*?class="result__snippet">([\s\S]*?)<\/a>/g;
  const titleRe = /class="result__a"[^>]*>(.*?)<\/a>/;
  const blocks  = html.match(/<div class="result[^"]*result--web[\s\S]*?<\/article>/g) ?? [];

  for (const block of blocks.slice(0, count)) {
    const titleM   = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const urlM     = block.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/);
    const snippetM = block.match(/class="result__snippet">([\s\S]*?)<\/a>/);
    if (!titleM) continue;
    const title   = titleM[1].replace(/<[^>]+>/g, "").trim();
    const url     = urlM ? urlM[1].replace(/<[^>]+>/g, "").trim() : "";
    const snippet = snippetM ? snippetM[1].replace(/<[^>]+>/g, "").trim() : "";
    results.push(`**${results.length + 1}. ${title}**\n${url}\n${snippet}`);
  }

  return results.length ? results.join("\n\n") : `Sem resultados para: "${query}"`;
}

async function fetchUrl(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MemoryMCP/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 15000);
}

export interface AgentRunOptions {
  project:           string;
  goal:              string;
  max_steps:         number;
  workdir?:          string;
  computer_agent_id?: string;
}

export async function runAgentAsync(opts: AgentRunOptions): Promise<string> {
  const { project, goal, max_steps, workdir, computer_agent_id } = opts;

  const proj = await prisma.project.findUnique({ where: { slug: project } });
  if (!proj) return `Projeto "${project}" não encontrado.`;

  const agents = getComputerAgents();
  const targetAgentId = computer_agent_id ?? agents[0]?.agentId;

  // Contexto atual do projeto
  const recentMemories = await prisma.memory.findMany({
    where: { projectId: proj.id, importance: { gte: 3 } },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    take: 15,
    select: { title: true, type: true, content: true, importance: true },
  });

  const memContext = recentMemories.map(m =>
    `[${m.type} imp:${m.importance}] ${m.title}: ${m.content.slice(0, 150)}`
  ).join("\n");

  broadcast("agent_run_start", { project, goal, maxSteps: max_steps });

  // ── Plan ──────────────────────────────────────────────────────────────────
  const planResp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Você é um agente de software autônomo. Dado o objetivo, crie um plano de execução.
Computador disponível: ${targetAgentId ? `Sim (${targetAgentId})` : "Não"}

Tools disponíveis:
- computer_exec: roda qualquer comando de terminal (git, npm, node, etc.)
- web_search: pesquisa na internet
- web_fetch: acessa uma URL e extrai conteúdo
- memory_add: salva conhecimento na memória

Retorne APENAS JSON: { "steps": [ { "id": 1, "tool": "nome_tool", "description": "o que faz", "command": "comando (se computer_exec)", "query": "query (se web_search)", "url": "url (se web_fetch)" } ] }

Seja direto. Máximo ${max_steps} steps. Use computer_exec para operações no computador.`,
      },
      {
        role: "user",
        content: `Projeto: ${proj.name}\nObjetivo: ${goal}\nContexto do projeto:\n${memContext}\nDiretório de trabalho: ${workdir ?? "não especificado"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  });

  let steps: { id: number; tool: string; description: string; command?: string; query?: string; url?: string }[] = [];
  try {
    const parsed = JSON.parse(planResp.choices[0].message.content ?? "{}");
    steps = parsed.steps ?? [];
  } catch {
    return "❌ Não consegui criar um plano. Tente reformular o objetivo.";
  }

  broadcast("agent_run_plan", {
    project, goal,
    steps: steps.map(s => ({ id: s.id, tool: s.tool, description: s.description })),
  });

  // ── Execute ───────────────────────────────────────────────────────────────
  const results: { id: number; tool: string; description: string; result: string; success: boolean }[] = [];

  for (const step of steps.slice(0, max_steps)) {
    broadcast("agent_run_step", { project, step: step.id, tool: step.tool, description: step.description });

    let result = "";
    let success = true;

    try {
      switch (step.tool) {
        case "computer_exec":
          if (!targetAgentId) { result = "❌ Sem computador conectado"; success = false; break; }
          const execResult = await sendToComputer(targetAgentId, step.command ?? step.description, workdir, 60_000);
          result = execResult.output.slice(0, 3000) || "(sem output)";
          success = execResult.exitCode === 0;
          break;

        case "web_search":
          result = await webSearch(step.query ?? step.description, 5);
          break;

        case "web_fetch":
          result = (await fetchUrl(step.url ?? "")).slice(0, 3000);
          break;

        case "memory_add":
          await prisma.memory.create({
            data: {
              projectId: proj.id,
              type: "NOTE",
              title: step.description,
              content: `Descoberto pelo agente durante: "${goal}". Step ${step.id}: ${step.description}`,
              importance: 3,
            },
          });
          result = "Memória salva.";
          break;

        default:
          result = `Tool "${step.tool}" não disponível no loop autônomo.`;
          success = false;
      }
    } catch (e: unknown) {
      result = `Erro: ${e instanceof Error ? e.message : String(e)}`;
      success = false;
    }

    results.push({ id: step.id, tool: step.tool, description: step.description, result, success });
    broadcast("agent_run_step_done", { project, step: step.id, success, result: result.slice(0, 200) });
  }

  // ── Learn ─────────────────────────────────────────────────────────────────
  const summary = results.map(r =>
    `Step ${r.id} [${r.tool}] ${r.success ? "✅" : "❌"}: ${r.description}\n${r.result.slice(0, 300)}`
  ).join("\n\n");

  try {
    await extractMemoriesFromText(
      `Objetivo do agente: "${goal}"\nResultados:\n${summary}`,
      proj.name
    );
  } catch {}

  broadcast("agent_run_done", {
    project,
    goal,
    successCount: results.filter(r => r.success).length,
    totalSteps: results.length,
  });

  return summary;
}
