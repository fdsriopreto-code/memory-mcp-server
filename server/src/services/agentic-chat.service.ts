import { prisma } from "../config/database.js";

export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
};

export type AgentChatResult = {
  answer: string;
  mode: "semantic" | "agentic" | "web" | "inferred";
  confidence: number;
  sources: { id: string; title: string; type: string; similarity: number }[];
  toolCalls: ToolCall[];
  path: string[];
  conversationType: "project" | "brainstorm" | "research" | "action";
};

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Pesquisa na internet informações atuais sobre qualquer assunto. Use quando precisar de dados recentes, tendências, tecnologias ou fatos externos.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Consulta de busca em português ou inglês" },
          max_results: { type: "number", description: "Número máximo de resultados (padrão 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description: "Cria uma nova tarefa em um projeto. Use quando o usuário pedir para criar, adicionar ou registrar uma tarefa.",
      parameters: {
        type: "object",
        properties: {
          project_slug: { type: "string", description: "Slug do projeto" },
          title: { type: "string", description: "Título da tarefa" },
          description: { type: "string", description: "Descrição detalhada" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        },
        required: ["project_slug", "title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_memory",
      description: "Salva uma informação importante no cérebro do projeto. Use quando o usuário quiser registrar uma decisão, padrão, ideia ou aprendizado.",
      parameters: {
        type: "object",
        properties: {
          project_slug: { type: "string" },
          type: { type: "string", enum: ["DECISION", "CONTEXT", "PATTERN", "NOTE", "ARCHITECTURE", "BRAIN"] },
          title: { type: "string" },
          content: { type: "string", description: "Conteúdo detalhado da memória" },
          tags: { type: "array", items: { type: "string" } },
          importance: { type: "number", description: "1 a 5" },
        },
        required: ["project_slug", "type", "title", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description: "Lista todos os projetos disponíveis no sistema.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_project_stats",
      description: "Retorna estatísticas e resumo de um projeto específico.",
      parameters: {
        type: "object",
        properties: { project_slug: { type: "string" } },
        required: ["project_slug"],
      },
    },
  },
];

// ── Tool executors ────────────────────────────────────────────────────────────
async function execWebSearch(args: Record<string, unknown>): Promise<unknown> {
  const tavilyKey = await getTavilyKey();
  if (!tavilyKey) return { error: "Tavily API key não configurada. Adicione em Config IA → Search." };

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: args.query,
      search_depth: "basic",
      max_results: args.max_results ?? 5,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { error: `Tavily retornou ${res.status}` };
  const data = await res.json() as { answer?: string; results?: { title: string; url: string; content: string; score: number }[] };
  return {
    answer: data.answer,
    results: (data.results ?? []).slice(0, 5).map(r => ({
      title: r.title, url: r.url,
      snippet: r.content.slice(0, 300),
      score: r.score,
    })),
  };
}

async function execCreateTask(args: Record<string, unknown>): Promise<unknown> {
  const proj = await prisma.project.findUnique({ where: { slug: args.project_slug as string } });
  if (!proj) return { error: `Projeto '${args.project_slug}' não encontrado` };
  const task = await prisma.task.create({
    data: {
      projectId: proj.id,
      title: args.title as string,
      description: args.description as string | undefined,
      priority: (args.priority as "LOW"|"MEDIUM"|"HIGH"|"CRITICAL") ?? "MEDIUM",
    },
  });
  return { ok: true, taskId: task.id, title: task.title, priority: task.priority };
}

async function execCreateMemory(args: Record<string, unknown>): Promise<unknown> {
  const proj = await prisma.project.findUnique({ where: { slug: args.project_slug as string } });
  if (!proj) return { error: `Projeto '${args.project_slug}' não encontrado` };
  const mem = await prisma.memory.create({
    data: {
      projectId: proj.id,
      type: (args.type as never) ?? "NOTE",
      title: args.title as string,
      content: args.content as string,
      tags: (args.tags as string[]) ?? [],
      importance: Math.min(5, Math.max(1, (args.importance as number) ?? 3)),
    },
  });
  return { ok: true, memoryId: mem.id, title: mem.title };
}

async function execListProjects(): Promise<unknown> {
  const projects = await prisma.project.findMany({
    select: { name: true, slug: true, description: true, _count: { select: { memories: true, tasks: true } } },
    orderBy: { createdAt: "desc" },
  });
  return projects.map(p => ({ name: p.name, slug: p.slug, description: p.description, memories: p._count.memories, tasks: p._count.tasks }));
}

async function execGetProjectStats(args: Record<string, unknown>): Promise<unknown> {
  const proj = await prisma.project.findUnique({ where: { slug: args.project_slug as string } });
  if (!proj) return { error: "Projeto não encontrado" };
  const [total, validated, tasks] = await Promise.all([
    prisma.memory.count({ where: { projectId: proj.id } }),
    prisma.memory.count({ where: { projectId: proj.id, epistemicStatus: "VALIDATED" } }),
    prisma.task.count({ where: { projectId: proj.id, status: { not: "DONE" } } }),
  ]);
  return { name: proj.name, slug: proj.slug, memories: total, validated, openTasks: tasks };
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "web_search":       return execWebSearch(args);
    case "create_task":      return execCreateTask(args);
    case "create_memory":    return execCreateMemory(args);
    case "list_projects":    return execListProjects();
    case "get_project_stats": return execGetProjectStats(args);
    default: return { error: `Ferramenta desconhecida: ${name}` };
  }
}

export type HistoryMessage = { role: "user" | "assistant"; content: string };
export type ChatAttachment = { type: "image"; mimeType: string; data: string };

// ── Main agentic chat ─────────────────────────────────────────────────────────
export async function agentChat(
  projectId: string, projectSlug: string, query: string,
  history: HistoryMessage[] = [],
  attachments: ChatAttachment[] = []
): Promise<AgentChatResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY não configurada");

  const { openAiBreaker, withRetry } = await import("./circuit-breaker.service.js");
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({ apiKey: openaiKey });

  const toolCalls: ToolCall[] = [];

  // 1. Detecta tipo de conversa
  const conversationType = detectConversationType(query);

  // 2. Busca semântica como contexto inicial
  let semanticContext = "";
  let sources: AgentChatResult["sources"] = [];

  try {
    const embRes = await openAiBreaker.execute(() =>
      withRetry(() => openai.embeddings.create({ model: "text-embedding-3-small", input: query }))
    ) as { data: { embedding: number[] }[] };
    const vec = `[${embRes.data[0].embedding.join(",")}]`;

    const seeds = await prisma.$queryRaw<{ id: string; title: string; content: string; type: string; similarity: number }[]>`
      SELECT id, title, content, type::text,
        (1 - (embedding <=> ${vec}::vector))::float AS similarity
      FROM memories
      WHERE project_id = ${projectId} AND embedding IS NOT NULL
        AND epistemic_status::text != 'DEPRECATED'
      ORDER BY embedding <=> ${vec}::vector
      LIMIT 6
    `;
    const good = seeds.filter(s => s.similarity > 0.55);
    sources = good.map(s => ({ id: s.id, title: s.title, type: s.type, similarity: s.similarity }));
    if (good.length > 0) {
      semanticContext = good.map(s => `[${s.type}] ${s.title}:\n${s.content.slice(0, 400)}`).join("\n\n---\n\n");
    }
  } catch { /* sem embedding, continua sem contexto */ }

  // 3. System prompt
  const systemPrompt = `Você é um assistente de segundo cérebro inteligente e agêntico com acesso a ferramentas.

${semanticContext ? `CONTEXTO DO PROJETO (memórias relevantes):\n${semanticContext}\n\n` : ""}
DIRETRIZES:
- Se o usuário pedir para criar tarefas, memórias, buscar na internet — USE as ferramentas disponíveis
- Se for uma pergunta de conhecimento → responda com base nas memórias + raciocínio
- Se for uma ideia nova ou brainstorming → explore e sugira ativamente, crie memórias se relevante
- Se precisar de informações externas/atuais → use web_search
- Responda SEMPRE em português
- Seja direto, útil e específico
- Quando criar algo (tarefa/memória), confirme o que foi criado`;

  // 4. Agentic loop (máx 5 rounds de tool calls)
  const recentHistory = history.slice(-10);
  // Build user message: plain text or multimodal (with images)
  const hasImages = attachments.some(a => a.type === "image");
  const userContent = hasImages
    ? [
        { type: "text" as const, text: query },
        ...attachments
          .filter(a => a.type === "image")
          .map(a => ({ type: "image_url" as const, image_url: { url: `data:${a.mimeType};base64,${a.data}`, detail: "auto" as const } })),
      ]
    : query;

  // Use gpt-4o when images are present (better vision)
  const chatModel = hasImages ? "gpt-4o" : "gpt-4o-mini";

  const messages: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(h => ({ role: h.role, content: h.content })),
    { role: "user",   content: userContent },
  ];

  let finalAnswer = "";
  let mode: AgentChatResult["mode"] = sources.length > 0 ? "semantic" : "agentic";

  for (let round = 0; round < 5; round++) {
    const completion = await openAiBreaker.execute(() =>
      withRetry(() => (openai.chat.completions.create as Function)({
        model: chatModel,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 1000,
        temperature: 0.5,
      }))
    ) as { choices: { message: { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };

    const choice = completion.choices[0].message;
    messages.push({ role: "assistant", content: choice.content, tool_calls: choice.tool_calls });

    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      finalAnswer = choice.content ?? "";
      break;
    }

    // Executa todas as tool calls deste round em paralelo
    const results = await Promise.all(
      choice.tool_calls.map(async tc => {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        const result = await executeTool(tc.function.name, args);
        toolCalls.push({ name: tc.function.name, args, result });
        if (tc.function.name === "web_search") mode = "web";
        else if (mode !== "web") mode = "agentic";
        return { id: tc.id, name: tc.function.name, result };
      })
    );

    for (const r of results) {
      messages.push({
        role: "tool",
        tool_call_id: r.id,
        name: r.name,
        content: JSON.stringify(r.result),
      });
    }
  }

  if (!finalAnswer) finalAnswer = "Não consegui completar a tarefa. Tente reformular a pergunta.";

  const confidence = sources.length > 0
    ? sources[0].similarity
    : toolCalls.length > 0 ? 0.85 : 0.4;

  return {
    answer: finalAnswer,
    mode,
    confidence,
    sources,
    toolCalls,
    path: [],
    conversationType,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function detectConversationType(query: string): AgentChatResult["conversationType"] {
  const q = query.toLowerCase();
  if (/\b(cri(a|ar)|adiciona|registra|salva|tarefa|task|memória)\b/.test(q)) return "action";
  if (/\b(pesquisa|busca|procura|internet|atual|trend|novo)\b/.test(q)) return "research";
  if (/\b(ideia|projeto|futuro|poderia|como (podemos|poderíamos)|brainstorm)\b/.test(q)) return "brainstorm";
  return "project";
}

async function getTavilyKey(): Promise<string | null> {
  try {
    const cfg = await (prisma as any).aIConfig.findUnique({ where: { role: "search" } });
    if (cfg?.apiKey) {
      const { decrypt } = await import("./crypto.service.js");
      return decrypt(cfg.apiKey);
    }
  } catch { /* fallback */ }
  return process.env.TAVILY_API_KEY ?? null;
}
