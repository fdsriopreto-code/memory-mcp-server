import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

type AIConfig = { role: string; provider: string; model: string; apiKey: string; isActive: boolean };
type SystemKeys = { mcpKeyMasked: string; tavilySet: boolean };
type KeyShareSuggestion = { fromRole: string; key: string; provider: string; targetRoles: string[] };

const ROLES = [
  { id:"synthesis",  label:"Síntese Autônoma",    desc:"Analisa memórias e gera insights diariamente",          icon:"🧠" },
  { id:"embedding",  label:"Embeddings",            desc:"Converte memórias em vetores para busca semântica",     icon:"🔢" },
  { id:"chat",       label:"Chat Agêntico",         desc:"Chat com ferramentas — web, tarefas, visão, voz",      icon:"💬" },
  { id:"agent",      label:"Agente Autônomo",       desc:"Executa tarefas multi-step no Agent Run",              icon:"🤖" },
  { id:"tts",        label:"Voz (TTS)",             desc:"Voz HD para o chat e oráculo (OpenAI TTS)",           icon:"🔊" },
  { id:"vision",     label:"Visão (Vision)",        desc:"Análise de imagens e fotos no chat",                   icon:"👁" },
  { id:"search",     label:"Pesquisa Web",          desc:"Permite ao agente buscar na internet em tempo real",   icon:"🌐" },
];

const PROVIDERS: Record<string, { label:string; color:string; keyPrefix:string; models:string[]; isSearch?:boolean }> = {
  openai:    { label:"OpenAI",          color:"#10b981", keyPrefix:"sk-",     models:["gpt-4o","gpt-4o-mini","gpt-4-turbo","text-embedding-3-small","text-embedding-3-large"] },
  anthropic: { label:"Anthropic",       color:"#f97316", keyPrefix:"sk-ant-", models:["claude-opus-4-8","claude-sonnet-4-6","claude-haiku-4-5-20251001"] },
  deepseek:  { label:"DeepSeek",        color:"#6366f1", keyPrefix:"sk-",     models:["deepseek-chat","deepseek-reasoner"] },
  groq:      { label:"Groq",            color:"#ec4899", keyPrefix:"gsk_",    models:["llama-3.3-70b-versatile","llama-3.1-8b-instant","mixtral-8x7b-32768"] },
  ollama:    { label:"Ollama (local)",  color:"#8b5cf6", keyPrefix:"",        models:["llama3.2","mistral","qwen2.5-coder","phi4"] },
  tavily:    { label:"Tavily",          color:"#38bdf8", keyPrefix:"tvly-",   models:["tavily-search"], isSearch:true },
};

const DEFAULT_MODELS: Record<string, { provider:string; model:string }> = {
  synthesis:  { provider:"openai",  model:"gpt-4o-mini" },
  embedding:  { provider:"openai",  model:"text-embedding-3-small" },
  chat:       { provider:"openai",  model:"gpt-4o-mini" },
  agent:      { provider:"openai",  model:"gpt-4o" },
  tts:        { provider:"openai",  model:"tts-1" },
  vision:     { provider:"openai",  model:"gpt-4o" },
  search:     { provider:"tavily",  model:"tavily-search" },
};

// Roles that should share the same key when provider matches
const PROVIDER_ROLE_GROUPS: Record<string, string[]> = {
  openai:    ["synthesis","embedding","chat","agent","tts","vision"],
  anthropic: ["synthesis","chat","agent"],
  deepseek:  ["synthesis","chat","agent"],
  groq:      ["synthesis","chat","agent"],
  ollama:    ["synthesis","chat","agent"],
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { /* */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy} className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all"
      style={{ background:copied?"rgba(16,185,129,0.12)":"rgba(255,255,255,0.06)", color:copied?"#34d399":"rgba(255,255,255,0.4)", border:`1px solid ${copied?"rgba(16,185,129,0.2)":"rgba(255,255,255,0.08)"}` }}>
      {copied ? "✓ Copiado" : "Copiar"}
    </button>
  );
}

// ── Setup Prompt ──────────────────────────────────────────────────────────────
type PromptTab = "claudecode" | "cursor" | "generic";

function SetupPrompt({ mcpKey }: { mcpKey: string | null }) {
  const [tab, setTab]     = useState<PromptTab>("claudecode");
  const [copied, setCopied] = useState<string | null>(null);

  const serverUrl = useMemo(() => window.location.origin, []);
  const mcpUrl    = `${serverUrl}/mcp`;
  const key       = mcpKey ?? "SUA_MCP_KEY_AQUI";
  const masked    = !mcpKey;

  async function copy(text: string, id: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* */ }
    setCopied(id); setTimeout(() => setCopied(null), 2000);
  }

  const claudeJsonConfig = `{
  "mcpServers": {
    "memory-mcp": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${key}"
      }
    }
  }
}`;

  const claudeMdTemplate = `# Memory MCP — Segundo Cérebro Persistente

> Este projeto tem memória persistente via Memory MCP Server.
> **USE SEMPRE** ao início e fim de cada sessão.

## Início de Sessão (OBRIGATÓRIO)
\`\`\`
brain_session_start(project="SLUG_DO_PROJETO", focus="[o que vai trabalhar hoje]")
\`\`\`

## Durante a Sessão
- Antes de tocar em pagamentos/auth/bugs → \`memory_search("área relevante")\`
- Ao criar algo novo importante → \`memory_add(type, title, content)\`
- Ao resolver um bug → \`memory_add(type="BUG_FIX", ...)\`
- Ao tomar uma decisão arquitetural → \`memory_add(type="DECISION", ...)\`
- Para criar tarefa → \`task_create(project, title, description, priority)\`

## Fim de Sessão (OBRIGATÓRIO)
\`\`\`
brain_learn(project="SLUG_DO_PROJETO", text="[resumo do que foi feito, bugs, decisões, padrões]")
\`\`\`

## Projetos disponíveis
Use \`project_list()\` para ver os slugs disponíveis.`;

  const cursorSystemPrompt = `Você tem acesso a um servidor MCP de memória persistente (Memory MCP Server).

## Conexão MCP
- URL: ${mcpUrl}
- Authorization: Bearer ${key}
- Protocolo: JSON-RPC 2.0 com Mcp-Session-Id

## Como usar
1. Ao iniciar: chame brain_session_start(project="slug", focus="foco da sessão")
2. Para buscar: memory_search(project="slug", query="busca semântica")
3. Para salvar: memory_add(project, type, title, content)
4. Para tarefas: task_create(project, title, description, priority)
5. Ao terminar: brain_learn(project, text="resumo da sessão")

## Tipos de memória
DECISION | CONTEXT | PATTERN | NOTE | BUG_FIX | ARCHITECTURE | BRAIN

## Regra mais importante
SEMPRE consulte o Memory MCP antes de responder sobre qualquer projeto cadastrado.
Use brain_session_start no início e brain_learn no fim de cada conversa.`;

  const genericCurlExample = `# 1. Inicializar sessão
SESSION_ID=$(curl -si -X POST "${mcpUrl}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"minha-ia","version":"1"}}}' \\
  | grep -i "^mcp-session-id:" | awk '{print $2}' | tr -d '\\r\\n')

# 2. Listar projetos
curl -s -X POST "${mcpUrl}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Mcp-Session-Id: $SESSION_ID" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"project_list","arguments":{}}}'

# 3. Buscar memórias
curl -s -X POST "${mcpUrl}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Mcp-Session-Id: $SESSION_ID" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_search","arguments":{"project":"SEU_SLUG","query":"busca aqui"}}}'`;

  const TAB_LABELS: Record<PromptTab, string> = {
    claudecode: "Claude Code",
    cursor:     "Cursor / GPT / Outros",
    generic:    "HTTP / curl",
  };

  function CodeBlock({ code, id }: { code: string; id: string }) {
    return (
      <div className="relative rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{id}</span>
          <button onClick={() => copy(code, id)} className="text-[10px] px-2 py-0.5 rounded font-medium transition-all"
            style={{ background: copied===id ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)", color: copied===id ? "#34d399" : "rgba(255,255,255,0.35)" }}>
            {copied===id ? "✓ Copiado" : "Copiar"}
          </button>
        </div>
        <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all" style={{ color: "rgba(255,255,255,0.7)" }}>{code}</pre>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(99,102,241,0.25)", background: "rgba(99,102,241,0.03)" }}>
      {/* Header */}
      <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-start gap-3">
          <span className="text-xl mt-0.5">🔌</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white">Prompt de Integração</h2>
            <p className="text-[12px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              Copie e envie para qualquer IA para ela se conectar ao seu Memory MCP automaticamente
            </p>
          </div>
          {masked && (
            <span className="text-[10px] px-2.5 py-1 rounded-full font-semibold shrink-0" style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" }}>
              ⚠️ Revele a chave acima para o prompt completo
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-5 pt-4 gap-1">
        {(Object.keys(TAB_LABELS) as PromptTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-t-xl text-[11px] font-semibold transition-all"
            style={{
              background: tab === t ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.03)",
              color: tab === t ? "#a5b4fc" : "rgba(255,255,255,0.3)",
              border: `1px solid ${tab === t ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
              borderBottom: tab === t ? "1px solid rgba(99,102,241,0.03)" : "1px solid rgba(255,255,255,0.06)",
            }}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-5 pb-5 pt-3 space-y-4">

        {/* ── Claude Code ── */}
        {tab === "claudecode" && (
          <>
            <div className="rounded-xl p-3 space-y-1" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.15)" }}>
              <p className="text-[11px] font-semibold" style={{ color: "#fb923c" }}>1. Adicione ao seu <code className="bg-white/10 px-1 rounded">.claude/settings.json</code> (ou settings locais)</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Abre Claude Code → /config → MCP Servers → cole o JSON abaixo</p>
            </div>
            <CodeBlock id=".claude/settings.json (mcpServers)" code={claudeJsonConfig} />

            <div className="rounded-xl p-3 space-y-1 mt-3" style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}>
              <p className="text-[11px] font-semibold" style={{ color: "#a5b4fc" }}>2. Crie um <code className="bg-white/10 px-1 rounded">CLAUDE.md</code> na raiz de cada projeto</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Cole este template e substitua SLUG_DO_PROJETO pelo slug correto (veja em Projetos)</p>
            </div>
            <CodeBlock id="CLAUDE.md" code={claudeMdTemplate} />

            <div className="rounded-xl p-3" style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
              <p className="text-[11px] font-semibold mb-1" style={{ color: "#34d399" }}>✓ Como verificar se funcionou</p>
              <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
                No chat do Claude Code, peça: <em>"Liste os projetos no Memory MCP"</em>. Se responder com a lista de projetos, está conectado.
              </p>
            </div>
          </>
        )}

        {/* ── Cursor / GPT ── */}
        {tab === "cursor" && (
          <>
            <div className="rounded-xl p-3 space-y-1" style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }}>
              <p className="text-[11px] font-semibold" style={{ color: "#a5b4fc" }}>Cole este prompt no System Prompt ou início da conversa</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Funciona com ChatGPT, Cursor, Windsurf, Copilot ou qualquer IA com suporte a MCP HTTP</p>
            </div>
            <CodeBlock id="System Prompt / Início da conversa" code={cursorSystemPrompt} />

            <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="text-[11px] font-semibold text-white/50">Para Cursor (cursor.sh)</p>
              <p className="text-[10px] leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
                Vá em <strong className="text-white/50">Settings → MCP → Add Server</strong>, escolha tipo HTTP e cole:
              </p>
              <div className="font-mono text-[11px] px-3 py-2 rounded-lg" style={{ background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.6)" }}>
                URL: {mcpUrl}<br/>
                Header: Authorization: Bearer {key}
              </div>
              <button onClick={() => copy(`${mcpUrl}\nAuthorization: Bearer ${key}`, "cursor-url")}
                className="text-[10px] px-2.5 py-1 rounded-lg font-medium transition-all"
                style={{ background: copied==="cursor-url" ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)", color: copied==="cursor-url" ? "#34d399" : "rgba(255,255,255,0.35)" }}>
                {copied==="cursor-url" ? "✓ Copiado" : "Copiar URL + Header"}
              </button>
            </div>
          </>
        )}

        {/* ── Generic / curl ── */}
        {tab === "generic" && (
          <>
            <div className="rounded-xl p-3 space-y-1" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)" }}>
              <p className="text-[11px] font-semibold" style={{ color: "#38bdf8" }}>Acesso direto via HTTP — qualquer linguagem</p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                Endpoint: <code className="text-sky-400">{mcpUrl}</code> · Protocolo: JSON-RPC 2.0 + SSE · Auth: Bearer token
              </p>
            </div>
            <CodeBlock id="Exemplo curl (bash)" code={genericCurlExample} />

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-[10px] font-semibold text-white/50">Detalhes do protocolo</p>
                <div className="space-y-1 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <p>• Inicializar → obtém <code className="text-white/50">Mcp-Session-Id</code></p>
                  <p>• Enviar ID em todo request seguinte</p>
                  <p>• Resposta: <code className="text-white/50">event: message\ndata: {"{...}"}</code></p>
                  <p>• Versão protocolo: <code className="text-white/50">2024-11-05</code></p>
                </div>
              </div>
              <div className="rounded-xl p-3 space-y-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-[10px] font-semibold text-white/50">Tools mais usadas</p>
                <div className="space-y-1 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <p>• <code className="text-indigo-400">project_list</code> — ver projetos</p>
                  <p>• <code className="text-indigo-400">brain_session_start</code> — iniciar sessão</p>
                  <p>• <code className="text-indigo-400">memory_search</code> — busca semântica</p>
                  <p>• <code className="text-indigo-400">memory_add</code> — salvar memória</p>
                  <p>• <code className="text-indigo-400">brain_learn</code> — aprender da sessão</p>
                  <p>• <code className="text-indigo-400">task_create</code> — criar tarefa</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Server info footer */}
        <div className="flex items-center gap-4 pt-1 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>Servidor ativo</span>
          </div>
          <span className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.2)" }}>{mcpUrl}</span>
          <button onClick={() => copy(mcpUrl, "mcpurl-footer")}
            className="text-[10px] px-2 py-0.5 rounded font-medium transition-all"
            style={{ background: copied==="mcpurl-footer" ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.05)", color: copied==="mcpurl-footer" ? "#34d399" : "rgba(255,255,255,0.25)" }}>
            {copied==="mcpurl-footer" ? "✓" : "Copiar URL"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="relative w-8 h-4 cursor-pointer" onClick={() => onChange(!on)}>
      <div className="absolute inset-0 rounded-full transition-colors" style={{ background:on?"rgba(16,185,129,0.4)":"rgba(255,255,255,0.1)" }}/>
      <div className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform" style={{ transform:on?"translateX(16px)":"none" }}/>
    </div>
  );
}

export default function AIConfigPage() {
  const [configs,  setConfigs]  = useState<Record<string, AIConfig>>({});
  const [editing,  setEditing]  = useState<Record<string, Partial<AIConfig>>>({});
  const [saving,   setSaving]   = useState<string | null>(null);
  const [saved,    setSaved]    = useState<string | null>(null);
  const [showKey,  setShowKey]  = useState<Record<string, boolean>>({});
  const [sysKeys,  setSysKeys]  = useState<SystemKeys | null>(null);
  const [mcpKey,   setMcpKey]   = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [renewing,  setRenewing]  = useState(false);
  const [renewedKey, setRenewedKey] = useState<string | null>(null);
  const [shareSuggestion, setShareSuggestion] = useState<KeyShareSuggestion | null>(null);

  useEffect(() => {
    api.get<AIConfig[]>("/api/ai-config").then(list => {
      const map: Record<string, AIConfig> = {};
      for (const c of list) map[c.role] = c;
      setConfigs(map);
    }).catch(() => {});
    api.get<SystemKeys>("/api/system/keys").then(setSysKeys).catch(() => {});
  }, []);

  function getField<K extends keyof AIConfig>(role: string, field: K): AIConfig[K] {
    const e = editing[role]?.[field]; const c = configs[role]?.[field];
    const d = field==="provider" ? DEFAULT_MODELS[role]?.provider : field==="model" ? DEFAULT_MODELS[role]?.model : field==="apiKey" ? "" : true;
    return (e ?? c ?? d) as AIConfig[K];
  }

  function setField(role: string, field: keyof AIConfig, val: string | boolean) {
    setEditing(prev => ({ ...prev, [role]: { ...prev[role], [field]: val } }));
    // Smart key sharing detection
    if (field === "apiKey" && typeof val === "string" && val.length > 8) {
      const provider = (editing[role]?.provider ?? configs[role]?.provider ?? DEFAULT_MODELS[role]?.provider) as string;
      const sameProvRoles = (PROVIDER_ROLE_GROUPS[provider] ?? []).filter(r =>
        r !== role && !configs[r]?.apiKey && !editing[r]?.apiKey
      );
      if (sameProvRoles.length > 0) {
        setShareSuggestion({ fromRole: role, key: val, provider, targetRoles: sameProvRoles });
      } else {
        setShareSuggestion(null);
      }
    }
  }

  function applyKeyShare(accept: boolean) {
    if (accept && shareSuggestion) {
      const { key, targetRoles } = shareSuggestion;
      setEditing(prev => {
        const next = { ...prev };
        for (const r of targetRoles) {
          next[r] = { ...next[r], apiKey: key };
        }
        return next;
      });
    }
    setShareSuggestion(null);
  }

  async function save(role: string) {
    const provider = getField(role,"provider") as string;
    const model    = getField(role,"model")    as string;
    const apiKey   = getField(role,"apiKey")   as string;
    const isActive = getField(role,"isActive") as boolean;
    if (!provider || !model) return;
    setSaving(role);
    try {
      const result = await api.put<AIConfig>(`/api/ai-config/${role}`, { provider, model, apiKey, isActive });
      setConfigs(prev => ({ ...prev, [role]: result }));
      setEditing(prev => { const c={...prev}; delete c[role]; return c; });
      setSaved(role); setTimeout(() => setSaved(null), 2500);
      if (role==="search") setSysKeys(prev => prev ? { ...prev, tavilySet: true } : prev);
    } catch { /* silent */ } finally { setSaving(null); }
  }

  async function remove(role: string) {
    await api.delete(`/api/ai-config/${role}`).catch(() => {});
    setConfigs(prev => { const c={...prev}; delete c[role]; return c; });
  }

  async function revealKey() {
    setRevealing(true);
    try { const r=await api.post<{key:string}>("/api/system/reveal-mcp-key",{}); setMcpKey(r.key); } catch {} finally { setRevealing(false); }
  }

  async function renewKey() {
    if (!confirm("Renovar invalida a chave atual. O Claude Code precisará ser reconfigurado. Continuar?")) return;
    setRenewing(true);
    try {
      const r=await api.post<{key:string;message:string}>("/api/system/renew-mcp-key",{});
      setRenewedKey(r.key); setMcpKey(r.key);
      setSysKeys(prev => prev ? { ...prev, mcpKeyMasked: r.key.slice(0,6)+"••••••••••••••••"+r.key.slice(-4) } : prev);
    } catch {} finally { setRenewing(false); }
  }

  // Compute active providers summary
  const activeSummary = Object.values(configs).reduce<Record<string, number>>((acc, c) => {
    if (c.isActive) acc[c.provider] = (acc[c.provider] ?? 0) + 1;
    return acc;
  }, {});

  const card: React.CSSProperties = { background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"1rem", padding:"1.25rem" };
  const inputClass = "w-full rounded-xl px-3 py-2 text-sm border outline-none bg-white/5 border-white/10 text-white/80 placeholder-white/20 focus:border-indigo-500/50 transition-colors";

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Configuração de IA</h1>
        <p className="text-sm text-white/35 mt-0.5">Escolha qual IA usa em cada função · compartilhe chaves entre serviços</p>
      </div>

      {/* Active keys summary */}
      {Object.keys(activeSummary).length > 0 && (
        <div className="rounded-xl p-3 flex flex-wrap gap-2 items-center" style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest mr-1" style={{ color:"rgba(255,255,255,0.25)" }}>Ativos</span>
          {Object.entries(activeSummary).map(([prov, count]) => {
            const p = PROVIDERS[prov]; if (!p) return null;
            return (
              <span key={prov} className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold"
                style={{ background:`${p.color}15`, color:p.color, border:`1px solid ${p.color}30` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background:p.color }}/>
                {p.label}
                <span className="text-[9px] opacity-60">{count} função{count>1?"ões":""}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── System Keys ──────────────────────────────────────────────────────── */}
      <div style={{ ...card, borderColor:"rgba(99,102,241,0.2)", background:"rgba(99,102,241,0.04)" }}>
        <h2 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">🔑 Chaves do Sistema</h2>
        <p className="text-xs text-white/30 mb-4">MCP Key para conectar o Claude Code e integrar com agentes externos</p>

        <div className="space-y-3">
          {/* MCP Key */}
          <div className="rounded-xl p-3 space-y-2.5" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-xs font-semibold text-white/70">MCP API Key</p>
                <p className="text-[10px] text-white/25">Use para configurar o Claude Code como cliente MCP</p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={revealKey} disabled={revealing} className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all"
                  style={{ background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.4)", border:"1px solid rgba(255,255,255,0.08)" }}>
                  {revealing?"…":mcpKey?"Ocultar":"Revelar"}
                </button>
                {mcpKey&&<CopyButton text={mcpKey}/>}
                <button onClick={renewKey} disabled={renewing} className="text-[11px] px-2.5 py-1 rounded-lg font-medium"
                  style={{ background:"rgba(239,68,68,0.08)", color:"#fca5a5", border:"1px solid rgba(239,68,68,0.2)" }}>
                  {renewing?"…":"Renovar"}
                </button>
              </div>
            </div>
            <div className="font-mono text-[12px] px-3 py-2 rounded-lg flex items-center justify-between gap-2" style={{ background:"rgba(0,0,0,0.2)", color:"rgba(255,255,255,0.6)" }}>
              <span className="truncate">{mcpKey ?? sysKeys?.mcpKeyMasked ?? "Carregando…"}</span>
              {mcpKey&&<CopyButton text={mcpKey}/>}
            </div>
            {renewedKey&&<div className="flex items-start gap-2 rounded-lg p-2.5" style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)" }}>
              <span>⚠️</span><p className="text-[11px]" style={{ color:"#fca5a5" }}>Chave renovada. Copie e atualize no Claude Code e no EasyPanel (<code className="bg-white/10 px-1 rounded">MCP_API_KEY</code>).</p>
            </div>}
          </div>

          {/* Tavily status */}
          <div className="flex items-center justify-between gap-2 rounded-xl p-3" style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }}>
            <div><p className="text-xs font-semibold text-white/70">Tavily Search</p><p className="text-[10px] text-white/25">{sysKeys?.tavilySet?"Configurado — agente pode pesquisar na internet":"Configure abaixo no role Pesquisa Web"}</p></div>
            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold shrink-0" style={{ background:sysKeys?.tavilySet?"rgba(16,185,129,0.12)":"rgba(245,158,11,0.12)", color:sysKeys?.tavilySet?"#34d399":"#fbbf24" }}>{sysKeys?.tavilySet?"✓ Ativo":"Pendente"}</span>
          </div>
        </div>
      </div>

      {/* ── Setup Prompt ─────────────────────────────────────────────────────── */}
      <SetupPrompt mcpKey={mcpKey} />

      {/* ── Key sharing suggestion ────────────────────────────────────────────── */}
      {shareSuggestion && (
        <div className="rounded-xl p-4 space-y-3" style={{ background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.3)" }}>
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0">💡</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Reutilizar esta chave?</p>
              <p className="text-[12px] mt-1" style={{ color:"rgba(255,255,255,0.5)" }}>
                Você configurou uma chave <strong className="text-white/70">{PROVIDERS[shareSuggestion.provider]?.label}</strong>.
                Os seguintes roles também usam {PROVIDERS[shareSuggestion.provider]?.label} e ainda não têm chave:
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {shareSuggestion.targetRoles.map(r => {
                  const role = ROLES.find(x => x.id===r);
                  return role ? <span key={r} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background:"rgba(99,102,241,0.15)", color:"#a5b4fc", border:"1px solid rgba(99,102,241,0.3)" }}>{role.icon} {role.label}</span> : null;
                })}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => applyKeyShare(true)} className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-all"
              style={{ background:"rgba(99,102,241,0.25)", color:"#a5b4fc", border:"1px solid rgba(99,102,241,0.4)" }}>
              ✓ Sim, usar a mesma chave
            </button>
            <button onClick={() => applyKeyShare(false)} className="px-4 py-2 rounded-xl text-[12px] font-medium"
              style={{ background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.35)", border:"1px solid rgba(255,255,255,0.08)" }}>
              Não
            </button>
          </div>
        </div>
      )}

      {/* ── Role Cards ───────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {ROLES.map(role => {
          const provider  = getField(role.id,"provider") as string;
          const model     = getField(role.id,"model")    as string;
          const apiKey    = getField(role.id,"apiKey")   as string;
          const isActive  = getField(role.id,"isActive") as boolean;
          const prov      = PROVIDERS[provider];
          const hasConfig = !!configs[role.id];
          const isDirty   = !!editing[role.id];
          const isTavily  = role.id === "search";
          const isOllamaLike = provider === "ollama";

          // How many other roles share the same key?
          const sameKeyCount = Object.entries(configs).filter(([r, c]) => r!==role.id && c.apiKey && configs[role.id]?.apiKey && c.provider===provider).length;

          return (
            <div key={role.id} style={{ ...card, ...(isTavily ? { borderColor:"rgba(56,189,248,0.2)", background:"rgba(56,189,248,0.03)" } : isDirty ? { borderColor:"rgba(99,102,241,0.25)" } : {}) }}>
              {/* Role header */}
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl leading-none mt-0.5">{role.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-white">{role.label}</h3>
                    {hasConfig
                      ? <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background:isActive?"rgba(16,185,129,0.12)":"rgba(107,114,128,0.12)", color:isActive?"#34d399":"#9ca3af" }}>{isActive?"ATIVO":"INATIVO"}</span>
                      : <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background:"rgba(245,158,11,0.12)", color:"#fbbf24" }}>NÃO CONFIGURADO</span>}
                    {prov && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background:`${prov.color}12`, color:prov.color }}>{prov.label} · {model}</span>}
                    {sameKeyCount > 0 && <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.3)" }}>🔗 chave compartilhada com {sameKeyCount} role{sameKeyCount>1?"s":""}</span>}
                  </div>
                  <p className="text-xs text-white/30 mt-0.5">{role.desc}</p>
                </div>
              </div>

              {/* Provider + Model */}
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[10px] text-white/40 mb-1 block">Provedor</label>
                  {isTavily
                    ? <div className="w-full rounded-xl px-3 py-2 text-sm border bg-white/5 border-white/10 text-white/50">Tavily</div>
                    : <select value={provider} onChange={e => { setField(role.id,"provider",e.target.value); setField(role.id,"model",PROVIDERS[e.target.value]?.models[0]??""); }} className={inputClass}>
                        {Object.entries(PROVIDERS).filter(([id])=>id!=="tavily").map(([id,p])=><option key={id} value={id}>{p.label}</option>)}
                      </select>}
                </div>
                <div>
                  <label className="text-[10px] text-white/40 mb-1 block">{isTavily?"Plano":"Modelo"}</label>
                  {isTavily
                    ? <div className="w-full rounded-xl px-3 py-2 text-sm border bg-white/5 border-white/10 text-white/50">tavily-search</div>
                    : <select value={model} onChange={e => setField(role.id,"model",e.target.value)} className={inputClass}>
                        {(PROVIDERS[provider]?.models??[]).map(m=><option key={m} value={m}>{m}</option>)}
                        {model && !PROVIDERS[provider]?.models.includes(model) && <option value={model}>{model}</option>}
                      </select>}
                </div>

                {/* API Key */}
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-white/40">
                      {isTavily ? "Tavily API Key" : isOllamaLike ? "API Key (não necessária para Ollama local)" : "API Key"}
                      {prov?.keyPrefix && <span className="ml-1 opacity-50">ex: {prov.keyPrefix}…</span>}
                    </label>
                    {/* Quick fill from another role with same provider */}
                    {!hasConfig && !editing[role.id]?.apiKey && (()=>{
                      const donor = Object.entries(configs).find(([r, c]) => r!==role.id && c.provider===provider && c.apiKey);
                      return donor ? (
                        <button onClick={() => setField(role.id,"apiKey","[use-saved]")}
                          className="text-[10px] px-2 py-0.5 rounded-lg transition-all"
                          style={{ background:"rgba(99,102,241,0.1)", color:"#818cf8", border:"1px solid rgba(99,102,241,0.2)" }}>
                          ↓ Copiar de {ROLES.find(r=>r.id===donor[0])?.label ?? donor[0]}
                        </button>
                      ) : null;
                    })()}
                  </div>
                  <div className="relative">
                    <input type={showKey[role.id]?"text":"password"} value={apiKey}
                      onChange={e => setField(role.id,"apiKey",e.target.value)}
                      placeholder={hasConfig ? "••••••••••••••• (salva)" : isTavily ? "tvly-…" : isOllamaLike ? "(opcional)" : `${prov?.keyPrefix??''}…`}
                      className={inputClass+" pr-10"}
                    />
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                      onClick={() => setShowKey(p => ({ ...p, [role.id]: !p[role.id] }))}>
                      {showKey[role.id]
                        ? <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        : <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>}
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-3 pt-2.5 border-t border-white/[0.05]">
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <Toggle on={isActive} onChange={v => setField(role.id,"isActive",v)}/>
                  <span className="text-xs text-white/35">Ativo</span>
                </label>
                {hasConfig && <button onClick={() => remove(role.id)} className="text-xs text-red-400/50 hover:text-red-400 transition-colors px-2 py-1">Remover</button>}
                <button onClick={() => save(role.id)} disabled={saving===role.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                  style={{ background:saved===role.id?"rgba(16,185,129,0.15)":isDirty?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.05)", color:saved===role.id?"#34d399":isDirty?"#a5b4fc":"rgba(255,255,255,0.3)", border:`1px solid ${saved===role.id?"rgba(16,185,129,0.3)":isDirty?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.08)"}` }}>
                  {saving===role.id?"Salvando…":saved===role.id?"✓ Salvo":"Salvar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info footer */}
      <div className="rounded-xl border border-white/[0.05] px-4 py-3 space-y-2" style={{ background:"rgba(99,102,241,0.03)" }}>
        <p className="text-xs text-white/25 leading-relaxed">
          <span className="text-indigo-400 font-medium">Chave compartilhada:</span> se você usa DeepSeek para tudo, coloque a chave em Síntese e o sistema sugere aplicar nos outros. Chaves são armazenadas criptografadas no banco.
        </p>
        <p className="text-xs text-white/25 leading-relaxed">
          <span className="text-indigo-400 font-medium">Sem config:</span> o sistema usa <code className="text-white/40 bg-white/5 px-1 rounded">OPENAI_API_KEY</code> como fallback.
          Para pesquisa web, configure Tavily em <span className="text-sky-400">app.tavily.com</span> (tem plano gratuito).
        </p>
      </div>
    </div>
  );
}
