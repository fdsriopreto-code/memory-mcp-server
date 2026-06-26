import { useEffect, useState } from "react";
import { api } from "../services/api";

type AIConfig = {
  role: string; provider: string; model: string;
  apiKey: string; isActive: boolean;
};

const ROLES = [
  { id: "synthesis",  label: "Síntese Autônoma",   desc: "Analisa memórias e gera insights consolidados diariamente",   icon: "🧠" },
  { id: "embedding",  label: "Embeddings",           desc: "Converte memórias em vetores para busca semântica",           icon: "🔢" },
  { id: "chat",       label: "Chat / Brain Chat",    desc: "Responde perguntas sobre o grafo de conhecimento",            icon: "💬" },
  { id: "agent",      label: "Agente Autônomo",      desc: "Executa tarefas multi-step no Agent Run",                    icon: "🤖" },
];

const PROVIDERS: Record<string, { label: string; color: string; models: string[] }> = {
  openai:    { label: "OpenAI",    color: "#10b981", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "text-embedding-3-small", "text-embedding-3-large"] },
  anthropic: { label: "Anthropic", color: "#f97316", models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  deepseek:  { label: "DeepSeek",  color: "#6366f1", models: ["deepseek-chat", "deepseek-reasoner"] },
  groq:      { label: "Groq",      color: "#ec4899", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"] },
  ollama:    { label: "Ollama (local)", color: "#8b5cf6", models: ["llama3.2", "mistral", "qwen2.5-coder", "phi4"] },
};

const DEFAULT_MODELS: Record<string, { provider: string; model: string }> = {
  synthesis:  { provider: "openai",    model: "gpt-4o-mini" },
  embedding:  { provider: "openai",    model: "text-embedding-3-small" },
  chat:       { provider: "anthropic", model: "claude-sonnet-4-6" },
  agent:      { provider: "openai",    model: "gpt-4o" },
};

export default function AIConfigPage() {
  const [configs, setConfigs] = useState<Record<string, AIConfig>>({});
  const [editing, setEditing] = useState<Record<string, Partial<AIConfig>>>({});
  const [saving,  setSaving]  = useState<string | null>(null);
  const [saved,   setSaved]   = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get<AIConfig[]>("/api/ai-config").then(list => {
      const map: Record<string, AIConfig> = {};
      for (const c of list) map[c.role] = c;
      setConfigs(map);
    }).catch(() => {});
  }, []);

  function getField<K extends keyof AIConfig>(role: string, field: K): AIConfig[K] {
    return (editing[role]?.[field] ?? configs[role]?.[field] ?? (field === "provider" ? DEFAULT_MODELS[role]?.provider : field === "model" ? DEFAULT_MODELS[role]?.model : field === "apiKey" ? "" : true)) as AIConfig[K];
  }

  function setField(role: string, field: keyof AIConfig, val: string | boolean) {
    setEditing(prev => ({ ...prev, [role]: { ...prev[role], [field]: val } }));
  }

  async function save(role: string) {
    const provider = getField(role, "provider") as string;
    const model    = getField(role, "model")    as string;
    const apiKey   = getField(role, "apiKey")   as string;
    const isActive = getField(role, "isActive") as boolean;
    if (!provider || !model) return;
    setSaving(role);
    try {
      const saved = await api.put<AIConfig>(`/api/ai-config/${role}`, { provider, model, apiKey, isActive });
      setConfigs(prev => ({ ...prev, [role]: saved }));
      setEditing(prev => { const c = { ...prev }; delete c[role]; return c; });
      setSaved(role);
      setTimeout(() => setSaved(null), 2000);
    } catch { /* silent */ }
    finally { setSaving(null); }
  }

  async function remove(role: string) {
    await api.delete(`/api/ai-config/${role}`).catch(() => {});
    setConfigs(prev => { const c = { ...prev }; delete c[role]; return c; });
  }

  const card: React.CSSProperties = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "1rem", padding: "1.25rem" };
  const inputClass = "w-full rounded-xl px-3 py-2 text-sm border outline-none bg-white/5 border-white/10 text-white/80 placeholder-white/20 focus:border-indigo-500/50";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Configuração de IA</h1>
        <p className="text-sm text-white/40 mt-0.5">Escolha qual modelo e provedor executa cada função do sistema</p>
      </div>

      {/* Provider legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(PROVIDERS).map(([id, p]) => (
          <span key={id} className="text-[11px] px-2.5 py-1 rounded-full border"
            style={{ background: `${p.color}12`, color: p.color, borderColor: `${p.color}30` }}>
            {p.label}
          </span>
        ))}
      </div>

      {/* Role cards */}
      <div className="space-y-4">
        {ROLES.map(role => {
          const provider = getField(role.id, "provider") as string;
          const model    = getField(role.id, "model")    as string;
          const apiKey   = getField(role.id, "apiKey")   as string;
          const isActive = getField(role.id, "isActive") as boolean;
          const prov     = PROVIDERS[provider];
          const hasConfig = !!configs[role.id];
          const isDirty   = !!editing[role.id];

          return (
            <div key={role.id} style={card}>
              {/* Role header */}
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl leading-none mt-0.5">{role.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-white">{role.label}</h3>
                    {hasConfig && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                        style={{ background: isActive ? "rgba(16,185,129,0.12)" : "rgba(107,114,128,0.12)",
                                 color: isActive ? "#34d399" : "#9ca3af" }}>
                        {isActive ? "ATIVO" : "INATIVO"}
                      </span>
                    )}
                    {!hasConfig && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full font-bold"
                        style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24" }}>
                        NÃO CONFIGURADO
                      </span>
                    )}
                    {prov && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full"
                        style={{ background: `${prov.color}12`, color: prov.color }}>
                        {prov.label} · {model}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/30 mt-0.5">{role.desc}</p>
                </div>
              </div>

              {/* Fields */}
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                {/* Provider */}
                <div>
                  <label className="text-[10px] text-white/40 mb-1 block">Provedor</label>
                  <select value={provider}
                    onChange={e => { setField(role.id, "provider", e.target.value); setField(role.id, "model", PROVIDERS[e.target.value]?.models[0] ?? ""); }}
                    className={inputClass}>
                    {Object.entries(PROVIDERS).map(([id, p]) => (
                      <option key={id} value={id}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {/* Model */}
                <div>
                  <label className="text-[10px] text-white/40 mb-1 block">Modelo</label>
                  <select value={model} onChange={e => setField(role.id, "model", e.target.value)} className={inputClass}>
                    {(PROVIDERS[provider]?.models ?? []).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {model && !PROVIDERS[provider]?.models.includes(model) && (
                      <option value={model}>{model}</option>
                    )}
                  </select>
                </div>

                {/* API Key */}
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-white/40 mb-1 block">
                    API Key {provider === "ollama" && <span className="text-white/20">(não necessária para Ollama local)</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showKey[role.id] ? "text" : "password"}
                      value={apiKey}
                      onChange={e => setField(role.id, "apiKey", e.target.value)}
                      placeholder={hasConfig ? "••••••••••••••• (salva)" : `sk-... ou chave do ${prov?.label ?? provider}`}
                      className={inputClass + " pr-10"}
                    />
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                      onClick={() => setShowKey(p => ({ ...p, [role.id]: !p[role.id] }))}>
                      {showKey[role.id] ? (
                        <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      ) : (
                        <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Active toggle + actions */}
              <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <div className="relative w-8 h-4"
                    onClick={() => setField(role.id, "isActive", !isActive)}>
                    <div className="absolute inset-0 rounded-full transition-colors"
                      style={{ background: isActive ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)" }}/>
                    <div className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                      style={{ transform: isActive ? "translateX(16px)" : "none" }}/>
                  </div>
                  <span className="text-xs text-white/40">Ativo</span>
                </label>

                {hasConfig && (
                  <button onClick={() => remove(role.id)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors px-2 py-1">
                    Remover
                  </button>
                )}

                <button onClick={() => save(role.id)}
                  disabled={saving === role.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                  style={{
                    background: saved === role.id ? "rgba(16,185,129,0.15)" : isDirty ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
                    color: saved === role.id ? "#34d399" : isDirty ? "#a5b4fc" : "rgba(255,255,255,0.3)",
                    border: `1px solid ${saved === role.id ? "rgba(16,185,129,0.3)" : isDirty ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.08)"}`,
                  }}>
                  {saving === role.id ? "Salvando…" : saved === role.id ? "✓ Salvo" : "Salvar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="rounded-xl border border-white/[0.06] px-4 py-3" style={{ background: "rgba(99,102,241,0.04)" }}>
        <p className="text-xs text-white/30 leading-relaxed">
          <span className="text-indigo-400 font-medium">Como funciona:</span> cada role usa o modelo configurado. Se uma role não tiver config, o sistema usa a variável de ambiente <code className="text-white/50 bg-white/5 px-1 rounded">OPENAI_API_KEY</code> como fallback. As chaves são armazenadas criptografadas no banco de dados.
        </p>
      </div>
    </div>
  );
}
