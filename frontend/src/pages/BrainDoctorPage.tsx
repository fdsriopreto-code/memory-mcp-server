import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { useWs } from "../contexts/WsContext";

type WsCtx = { connected: boolean; subscribe: (type: string, handler: (data: unknown) => void) => () => void };

// ── Types ──────────────────────────────────────────────────────────────────────
interface AIModel {
  id:          string;
  name:        string;
  provider:    string;
  description: string;
  envKey:      string;
  hasKey:      boolean;
}

interface DoctorConfig {
  enabled:   boolean;
  frequency: string;
  model:     string;
  projects:  string[];
  hour:      number;
}

interface DoctorRun {
  id:           string;
  projectSlug:  string;
  model:        string;
  status:       string;
  goal:         string | null;
  stats:        Record<string, unknown> | null;
  summary:      string | null;
  error:        string | null;
  startedAt:    string;
  completedAt:  string | null;
}

interface LogEntry {
  ts:      number;
  type:    string;
  message: string;
  ok?:     boolean;
}

interface Project {
  slug: string;
  name: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PROVIDER_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  openai:    { label: "OpenAI",    color: "#10b981", bg: "rgba(16,185,129,0.08)"  },
  anthropic: { label: "Anthropic", color: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
  deepseek:  { label: "DeepSeek",  color: "#38bdf8", bg: "rgba(56,189,248,0.08)" },
  google:    { label: "Google",    color: "#a78bfa", bg: "rgba(167,139,250,0.08)" },
};

const FREQ_OPTIONS = [
  { value: "daily",    label: "Diária"    },
  { value: "weekly",   label: "Semanal"   },
  { value: "biweekly", label: "Quinzenal" },
  { value: "monthly",  label: "Mensal"    },
];

const STEP_ICONS: Record<string, string> = {
  start:     "🚀", phase:     "📍", plan:      "📋",
  action:    "⚡", result:    "→",  done:      "✅",
  error:     "❌", vaccinate: "💉", relate:    "🔗",
  promote:   "✅", pin:       "📌", synthesize:"🔮",
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function BrainDoctorPage() {
  const { subscribe } = useWs() as WsCtx;

  // Data
  const [models,   setModels]   = useState<AIModel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [config,   setConfig]   = useState<DoctorConfig>({ enabled: false, frequency: "weekly", model: "gpt-4o", projects: [], hour: 3 });
  const [runs,     setRuns]     = useState<DoctorRun[]>([]);

  // Form state
  const [selProject, setSelProject] = useState("");
  const [selModel,   setSelModel]   = useState("gpt-4o");
  const [goal,       setGoal]       = useState("");
  const [extraKey,   setExtraKey]   = useState("");
  const [running,    setRunning]    = useState(false);
  const [currentRun, setCurrentRun] = useState<string | null>(null);

  // Live log
  const [log, setLog]       = useState<LogEntry[]>([]);
  const logRef              = useRef<HTMLDivElement>(null);

  // Config editor
  const [configDraft, setConfigDraft] = useState<DoctorConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Load initial data — cada chamada independente para não bloquear projetos/modelos
  useEffect(() => {
    api.get<{ slug: string; name: string }[]>("/api/projects")
      .then(p => { setProjects(p); if (p.length) setSelProject(p[0].slug); })
      .catch(() => {});

    api.get<AIModel[]>("/api/brain-doctor/models")
      .then(setModels)
      .catch(() => {});

    api.get<DoctorConfig>("/api/brain-doctor/config")
      .then(c => { setConfig(c); setConfigDraft(c); })
      .catch(() => {}); // falha se migration não aplicada ainda

    api.get<DoctorRun[]>("/api/brain-doctor/runs")
      .then(setRuns)
      .catch(() => {}); // falha se migration não aplicada ainda
  }, []);

  // Scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // WebSocket events
  const currentRunRef = useRef<string | null>(null);
  useEffect(() => { currentRunRef.current = currentRun; }, [currentRun]);

  useEffect(() => {
    const EVENTS = ["start","phase","plan","action","result","done","error"];

    const unsubs = EVENTS.map(event =>
      subscribe(`brain:doctor:${event}`, (raw) => {
        const data = (raw ?? {}) as Record<string, unknown>;
        const runId = String(data.runId ?? "");

        // Only process events for the current run (once we know it)
        if (runId && currentRunRef.current && runId !== currentRunRef.current) return;

        switch (event) {
          case "start":
            setLog([{ ts: Date.now(), type: "start", message: `🚀 Brain Doctor iniciado — projeto: ${data.project} · modelo: ${data.model}` }]);
            break;
          case "phase":
            addLog("phase", String(data.message ?? ""));
            break;
          case "plan":
            addLog("plan", `📋 Plano gerado: ${(data.plan as unknown[])?.length ?? 0} operações`);
            break;
          case "action":
            addLog("action", `[${data.step}/${data.total}] ${STEP_ICONS[String(data.op)] ?? "⚡"} ${data.op}: ${data.reason}`);
            break;
          case "result":
            addLog("result", `  → ${data.result}`, Boolean(data.success));
            break;
          case "done": {
            const s = (data.stats ?? {}) as Record<string, number>;
            addLog("done", `✅ Concluído! ${s.linksCreated ?? 0} links · ${s.memoriesPromoted ?? 0} validadas · ${s.anchorsCreated ?? 0} âncoras`);
            setRunning(false);
            api.get<DoctorRun[]>("/api/brain-doctor/runs").then(setRuns).catch(() => {});
            break;
          }
          case "error":
            addLog("error", `❌ Erro: ${data.message}`);
            setRunning(false);
            break;
        }
      })
    );

    return () => unsubs.forEach(u => u());
  }, [subscribe]);

  function addLog(type: string, message: string, ok?: boolean) {
    setLog(prev => [...prev, { ts: Date.now(), type, message, ok }]);
  }

  async function handleRun() {
    if (!selProject || !selModel || running) return;
    setRunning(true);
    setLog([]);
    setCurrentRun(null);

    try {
      const body: Record<string, string> = { projectSlug: selProject, modelId: selModel };
      if (goal) body.goal = goal;
      if (extraKey) body.apiKey = extraKey;

      const res = await api.post<{ runId: string }>("/api/brain-doctor/run", body);
      setCurrentRun(res.runId);
    } catch (e: unknown) {
      addLog("error", `❌ ${(e as Error).message}`);
      setRunning(false);
    }
  }

  async function handleSaveConfig() {
    if (!configDraft) return;
    setSavingConfig(true);
    try {
      await api.put("/api/brain-doctor/config", configDraft);
      setConfig(configDraft);
    } catch { /* */ }
    setSavingConfig(false);
  }

  // Derived
  const selectedModel = models.find(m => m.id === selModel);
  const needsExtraKey = selectedModel && !selectedModel.hasKey && selectedModel.provider !== "openai";
  const modelsByProvider = models.reduce<Record<string, AIModel[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m); return acc;
  }, {});

  const glassCard = {
    background:   "rgba(255,255,255,0.02)",
    border:       "1px solid rgba(255,255,255,0.07)",
    borderRadius: "1rem",
    padding:      "1.25rem",
  };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            🧠 Médico do Cérebro
          </h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            IA autônoma que mantém o cérebro saudável — conecta sinapses, valida memórias, previne bugs
          </p>
        </div>
        {running && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}>
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-xs font-semibold text-indigo-400">IA trabalhando...</span>
          </div>
        )}
      </div>

      {/* Main grid */}
      <div className="grid lg:grid-cols-2 gap-5">

        {/* Left: Controls */}
        <div className="space-y-4">

          {/* Run config */}
          <div style={glassCard} className="space-y-4">
            <h2 className="text-sm font-bold text-white">Executar manutenção</h2>

            {/* Project */}
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>Projeto</label>
              <select value={selProject} onChange={e => setSelProject(e.target.value)}
                className="mt-1 w-full text-sm rounded-lg px-3 py-2"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
                {projects.map(p => (
                  <option key={p.slug} value={p.slug} style={{ background: "#1a1a2e" }}>{p.name} ({p.slug})</option>
                ))}
              </select>
            </div>

            {/* Model selector */}
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>Modelo de IA</label>
              <div className="mt-1 space-y-2">
                {Object.entries(modelsByProvider).map(([provider, provModels]) => {
                  const meta = PROVIDER_LABELS[provider] ?? { label: provider, color: "#fff", bg: "rgba(255,255,255,0.05)" };
                  return (
                    <div key={provider} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="px-3 py-1.5 flex items-center gap-2" style={{ background: meta.bg }}>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}40` }}>
                          {meta.label}
                        </span>
                        {!provModels.some(m => m.hasKey) && provider !== "openai" && (
                          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>API Key não configurada</span>
                        )}
                      </div>
                      <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                        {provModels.map(m => (
                          <button key={m.id} onClick={() => setSelModel(m.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all"
                            style={{ background: selModel === m.id ? "rgba(99,102,241,0.12)" : "transparent" }}>
                            <div className="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
                              style={{ borderColor: selModel === m.id ? "#6366f1" : "rgba(255,255,255,0.2)" }}>
                              {selModel === m.id && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-white flex items-center gap-2">
                                {m.name}
                                {!m.hasKey && provider !== "openai" && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24" }}>Key Necessária</span>
                                )}
                              </div>
                              <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{m.description}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* API Key (only if needed) */}
            {needsExtraKey && (
              <div>
                <label className="text-xs font-semibold" style={{ color: "#fbbf24" }}>
                  API Key — {PROVIDER_LABELS[selectedModel.provider]?.label}
                </label>
                <input type="password" placeholder={`Cole a key ${selectedModel.provider} aqui...`}
                  value={extraKey} onChange={e => setExtraKey(e.target.value)}
                  className="mt-1 w-full text-sm rounded-lg px-3 py-2 font-mono"
                  style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.25)", color: "white" }}
                />
                <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                  Usada somente nesta execução. Para persistir, configure {selectedModel.envKey} no servidor.
                </p>
              </div>
            )}

            {/* Goal */}
            <div>
              <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>
                Objetivo <span style={{ color: "rgba(255,255,255,0.2)" }}>(opcional)</span>
              </label>
              <input type="text" placeholder="Ex: conectar memórias de pagamento, fortalecer módulo Tarot..."
                value={goal} onChange={e => setGoal(e.target.value)}
                className="mt-1 w-full text-sm rounded-lg px-3 py-2"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "white" }}
              />
            </div>

            {/* Run button */}
            <button onClick={handleRun} disabled={running || !selProject}
              className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
              style={{
                background:  running ? "rgba(99,102,241,0.1)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color:       running ? "rgba(255,255,255,0.3)" : "white",
                cursor:      running ? "not-allowed" : "pointer",
                boxShadow:   running ? "none" : "0 4px 24px rgba(99,102,241,0.3)",
              }}>
              {running ? "⏳ IA trabalhando..." : "▶ Executar Manutenção"}
            </button>
          </div>

          {/* Schedule config */}
          {configDraft && (
            <div style={glassCard} className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-white">⏰ Agendamento automático</h2>
                <button onClick={() => setConfigDraft(d => d ? { ...d, enabled: !d.enabled } : d)}
                  className="w-10 h-5 rounded-full transition-all relative"
                  style={{ background: configDraft.enabled ? "#6366f1" : "rgba(255,255,255,0.1)" }}>
                  <span className="absolute top-0.5 transition-all w-4 h-4 rounded-full bg-white"
                    style={{ left: configDraft.enabled ? "calc(100% - 18px)" : "2px" }} />
                </button>
              </div>

              {configDraft.enabled && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Frequência</label>
                      <select value={configDraft.frequency} onChange={e => setConfigDraft(d => d ? { ...d, frequency: e.target.value } : d)}
                        className="mt-1 w-full text-xs rounded-lg px-2 py-1.5"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
                        {FREQ_OPTIONS.map(f => <option key={f.value} value={f.value} style={{ background: "#1a1a2e" }}>{f.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Hora (UTC)</label>
                      <input type="number" min={0} max={23} value={configDraft.hour}
                        onChange={e => setConfigDraft(d => d ? { ...d, hour: Number(e.target.value) } : d)}
                        className="mt-1 w-full text-xs rounded-lg px-2 py-1.5"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Modelo</label>
                    <select value={configDraft.model} onChange={e => setConfigDraft(d => d ? { ...d, model: e.target.value } : d)}
                      className="mt-1 w-full text-xs rounded-lg px-2 py-1.5"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}>
                      {models.map(m => <option key={m.id} value={m.id} style={{ background: "#1a1a2e" }}>{m.name} ({PROVIDER_LABELS[m.provider]?.label})</option>)}
                    </select>
                  </div>
                  <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Projetos: {configDraft.projects.length ? configDraft.projects.join(", ") : "todos"}
                  </p>
                </div>
              )}

              <button onClick={handleSaveConfig} disabled={savingConfig}
                className="w-full py-2 rounded-xl text-xs font-bold transition-all"
                style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc" }}>
                {savingConfig ? "Salvando..." : "💾 Salvar agendamento"}
              </button>
            </div>
          )}
        </div>

        {/* Right: Live log */}
        <div style={glassCard} className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white">📡 Log em tempo real</h2>
            {log.length > 0 && (
              <button onClick={() => setLog([])} className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>
                Limpar
              </button>
            )}
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto space-y-1 font-mono text-[11px] max-h-96 min-h-48"
            style={{ color: "rgba(255,255,255,0.7)" }}>
            {log.length === 0 ? (
              <div className="flex items-center justify-center h-32" style={{ color: "rgba(255,255,255,0.15)" }}>
                <span>Execute uma manutenção para ver o log aqui...</span>
              </div>
            ) : log.map((entry, i) => (
              <div key={i} className="flex gap-2 leading-relaxed">
                <span className="shrink-0 text-[9px] tabular-nums mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {new Date(entry.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{
                  color: entry.type === "error"  ? "#f87171" :
                         entry.type === "done"   ? "#34d399" :
                         entry.type === "result" && entry.ok === false ? "#fb923c" :
                         entry.type === "plan"   ? "#a5b4fc" :
                         entry.type === "phase"  ? "#fbbf24" :
                         "rgba(255,255,255,0.7)",
                }}>
                  {entry.message}
                </span>
              </div>
            ))}
            {running && (
              <div className="flex gap-2 items-center mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                <span className="text-[9px]">{new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className="animate-pulse">▌</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Run history */}
      <div style={glassCard}>
        <h2 className="text-sm font-bold text-white mb-4">📊 Histórico de execuções</h2>
        {runs.length === 0 ? (
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>Nenhuma execução ainda</p>
        ) : (
          <div className="space-y-2">
            {runs.map(run => {
              const stats = run.stats as Record<string, number> | null;
              const isDone  = run.status === "done";
              const isError = run.status === "error";
              const isRun   = run.status === "running";
              return (
                <div key={run.id} className="flex items-center gap-4 px-3 py-2.5 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {/* Status dot */}
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isRun ? "animate-pulse" : ""}`}
                    style={{ background: isDone ? "#34d399" : isError ? "#f87171" : "#fbbf24" }} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-white">{run.projectSlug}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
                        {run.model}
                      </span>
                      {isRun && <span className="text-[10px] text-yellow-400 animate-pulse">executando...</span>}
                    </div>
                    {run.summary && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.3)" }}>{run.summary}</p>
                    )}
                    {run.error && (
                      <p className="text-[11px] mt-0.5 text-red-400 truncate">{run.error}</p>
                    )}
                  </div>

                  {/* Stats */}
                  {stats && isDone && (
                    <div className="flex items-center gap-3 shrink-0">
                      <Stat icon="🔗" value={stats.linksCreated ?? 0}     label="links"    />
                      <Stat icon="✅" value={stats.memoriesPromoted ?? 0} label="valid."   />
                      <Stat icon="💉" value={stats.anchorsCreated ?? 0}   label="âncoras"  />
                    </div>
                  )}

                  {/* Date */}
                  <span className="text-[10px] shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>
                    {new Date(run.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    {" "}
                    {new Date(run.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-xs font-bold text-white">{icon} {value}</div>
      <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>{label}</div>
    </div>
  );
}
