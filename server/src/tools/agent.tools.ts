import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logAudit } from "./audit.js";
import { runAgentAsync } from "../services/agent.runner.js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Web Search: Tavily (grátis 1000/mês) ou DuckDuckGo (sem chave) ────────────
async function webSearch(query: string, count = 5): Promise<string> {
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

  // Fallback: DuckDuckGo HTML sem chave
  const resp = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "text/html" }, signal: AbortSignal.timeout(15_000) }
  );
  if (!resp.ok) throw new Error(`DuckDuckGo HTTP ${resp.status}`);
  const html = await resp.text();

  const results: string[] = [];
  const blocks = html.match(/<div class="result[^"]*result--web[\s\S]*?<\/article>/g) ?? [];
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

// ── Web Fetch (URL → readable text) ──────────────────────────────────────────
async function fetchUrl(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MemoryMCP/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const html = await resp.text();

  // Strip HTML tags e extrair texto legível
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 15000);

  return text;
}

export function registerAgentTools(server: McpServer) {

  server.tool(
    "web_search",
    "Pesquisa na internet — usa Tavily (TAVILY_API_KEY) se configurado, caso contrário usa DuckDuckGo sem chave. Retorna títulos, URLs e trechos.",
    {
      query:       z.string().describe("O que pesquisar"),
      max_results: z.number().min(1).max(10).default(5).describe("Número máximo de resultados"),
    },
    async ({ query, max_results }) => {
      try {
        const results = await webSearch(query, max_results);
        await logAudit(null, "web_search", { query }, results.slice(0, 200));
        return { content: [{ type: "text" as const, text: `# 🔍 Resultados: "${query}"\n\n${results}` }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ Erro na busca: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  server.tool(
    "web_fetch",
    "Acessa uma URL e extrai o conteúdo textual legível — útil para ler documentação, artigos, issues do GitHub, etc.",
    {
      url:     z.string().url().describe("URL a acessar"),
      summary: z.boolean().default(false).describe("true = retorna resumo via IA em vez do texto completo"),
    },
    async ({ url, summary }) => {
      try {
        const text = await fetchUrl(url);
        await logAudit(null, "web_fetch", { url }, `${text.length} chars`);

        if (summary) {
          const resp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "Resuma o conteúdo abaixo em português, focando nos pontos mais relevantes. Máximo 400 palavras." },
              { role: "user",   content: text.slice(0, 8000) },
            ],
            max_tokens: 600,
          });
          return { content: [{ type: "text" as const, text: `# 📄 ${url}\n\n**Resumo:**\n${resp.choices[0].message.content}` }] };
        }

        return { content: [{ type: "text" as const, text: `# 📄 ${url}\n\n${text}` }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ Erro ao acessar ${url}: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );

  server.tool(
    "agent_run",
    "Loop autônomo de múltiplos passos — GPT-4o planeja, executa tools em sequência (computer_exec, web_search, memory, etc.), aprende com os resultados e reporta progresso em tempo real via WebSocket",
    {
      project:           z.string().describe("Slug do projeto"),
      goal:              z.string().describe("Objetivo a atingir (ex: 'Faça git commit e push de todos os arquivos modificados', 'Pesquise como implementar X e salve as melhores referências')"),
      max_steps:         z.number().min(1).max(20).default(8).describe("Máximo de steps a executar"),
      computer_agent_id: z.string().optional().describe("ID do agente computador (usa o primeiro disponível se omitido)"),
      workdir:           z.string().optional().describe("Diretório de trabalho para comandos no computador"),
    },
    async ({ project, goal, max_steps, computer_agent_id, workdir }) => {
      try {
        const summary = await runAgentAsync({ project, goal, max_steps, workdir, computer_agent_id });
        await logAudit(null, "agent_run", { project, goal }, summary.slice(0, 200));
        return { content: [{ type: "text" as const, text: summary }] };
      } catch (e: unknown) {
        return { content: [{ type: "text" as const, text: `❌ Erro no agent_run: ${e instanceof Error ? e.message : String(e)}` }] };
      }
    }
  );
}
