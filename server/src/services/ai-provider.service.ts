import OpenAI from "openai";

// ── Model registry ─────────────────────────────────────────────────────────────
export type AIProvider = "openai" | "anthropic" | "deepseek" | "google";

export interface AIModel {
  id:          string;
  name:        string;
  provider:    AIProvider;
  description: string;
  envKey:      string;   // nome da variável de ambiente para a API key
}

export const AI_MODELS: AIModel[] = [
  // OpenAI
  { id: "gpt-4o",          name: "GPT-4o",          provider: "openai",    description: "Mais capaz, melhor raciocínio",       envKey: "OPENAI_API_KEY"    },
  { id: "gpt-4o-mini",     name: "GPT-4o Mini",     provider: "openai",    description: "Rápido e econômico",                  envKey: "OPENAI_API_KEY"    },
  { id: "gpt-4.1-mini",    name: "GPT-4.1 Mini",    provider: "openai",    description: "Eficiente para tarefas estruturadas",  envKey: "OPENAI_API_KEY"    },
  { id: "o3-mini",         name: "O3 Mini",          provider: "openai",    description: "Raciocínio avançado e confiável",     envKey: "OPENAI_API_KEY"    },
  // Anthropic
  { id: "claude-sonnet-4-6",  name: "Claude Sonnet 4.6", provider: "anthropic", description: "Equilibrado, ótimo raciocínio", envKey: "ANTHROPIC_API_KEY" },
  { id: "claude-haiku-4-5",   name: "Claude Haiku 4.5",  provider: "anthropic", description: "Ultra rápido e econômico",      envKey: "ANTHROPIC_API_KEY" },
  // DeepSeek
  { id: "deepseek-chat",      name: "DeepSeek Chat",     provider: "deepseek",  description: "Código e raciocínio, muito barato",  envKey: "DEEPSEEK_API_KEY"  },
  { id: "deepseek-reasoner",  name: "DeepSeek R1",       provider: "deepseek",  description: "Raciocínio avançado, open-source",   envKey: "DEEPSEEK_API_KEY"  },
  // Google
  { id: "gemini-2.5-flash-preview-05-20", name: "Gemini 2.5 Flash", provider: "google", description: "Muito rápido, multimodal", envKey: "GOOGLE_AI_KEY" },
  { id: "gemini-2.5-pro-preview-06-05",   name: "Gemini 2.5 Pro",   provider: "google", description: "Mais capaz do Google",     envKey: "GOOGLE_AI_KEY" },
];

export function getModel(modelId: string): AIModel | undefined {
  return AI_MODELS.find(m => m.id === modelId);
}

export function getProviderKey(provider: AIProvider): string {
  switch (provider) {
    case "openai":    return process.env.OPENAI_API_KEY    ?? "";
    case "anthropic": return process.env.ANTHROPIC_API_KEY ?? "";
    case "deepseek":  return process.env.DEEPSEEK_API_KEY  ?? "";
    case "google":    return process.env.GOOGLE_AI_KEY     ?? "";
  }
}

// ── Unified text generation (returns raw string, caller parses JSON) ───────────
export async function generateJSON(opts: {
  model:        AIModel;
  systemPrompt: string;
  userPrompt:   string;
  apiKey?:      string;   // override — se vazio usa env var
}): Promise<string> {
  const { model, systemPrompt, userPrompt } = opts;
  const key = opts.apiKey || getProviderKey(model.provider);

  if (!key) {
    throw new Error(`API key não configurada para ${model.provider}. Configure a variável ${model.envKey}.`);
  }

  switch (model.provider) {
    case "openai":
      return callOpenAI(model.id, systemPrompt, userPrompt, key);

    case "deepseek":
      return callOpenAI(model.id, systemPrompt, userPrompt, key, "https://api.deepseek.com");

    case "google":
      return callOpenAI(model.id, systemPrompt, userPrompt, key, "https://generativelanguage.googleapis.com/v1beta/openai/");

    case "anthropic":
      return callAnthropic(model.id, systemPrompt, userPrompt, key);
  }
}

// ── OpenAI-compatible call (OpenAI, DeepSeek, Google) ─────────────────────────
async function callOpenAI(
  modelId:    string,
  system:     string,
  user:       string,
  apiKey:     string,
  baseURL?:   string,
): Promise<string> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const resp = await client.chat.completions.create({
    model:           modelId,
    temperature:     0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user   },
    ],
  });

  return resp.choices[0]?.message?.content ?? "{}";
}

// ── Anthropic REST call (format differs from OpenAI) ──────────────────────────
async function callAnthropic(
  modelId: string,
  system:  string,
  user:    string,
  apiKey:  string,
): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      modelId,
      max_tokens: 4096,
      system:     system + "\n\nResponda APENAS com JSON válido, sem markdown ou texto extra.",
      messages:   [{ role: "user", content: user }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json() as { content?: Array<{ type: string; text: string }> };
  const text  = data.content?.find(c => c.type === "text")?.text ?? "{}";

  // Strip markdown fences if present
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}
