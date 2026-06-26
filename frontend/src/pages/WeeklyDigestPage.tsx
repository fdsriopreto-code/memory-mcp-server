import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";

type Project = { slug: string; name: string; color: string };

type Digest = {
  id: string; period: string; type: string;
  summary: string; insights: any[]; hotTopics: any[]; coldTopics: any[];
  gaps: { area: string; description: string; priority: "high"|"medium"|"low" }[];
  healthScore: number; memoriesIn: number; newSyntheses: number; createdAt: string;
};

type Pulse = {
  healthScore: number; total: number; syntheses: number; recentWeek: number;
  validated: number; deprecated: number; withEmbedding: number;
  hot: { id: string; title: string; type: string; importance: number; accessCount: number }[];
  cold: { id: string; title: string; type: string; importance: number }[];
};

const PRIORITY_COLOR = { high: "#ef4444", medium: "#f59e0b", low: "#6366f1" };
const HEALTH_COLOR   = (s: number) => s >= 75 ? "#10b981" : s >= 50 ? "#f59e0b" : "#ef4444";

function HealthRing({ score }: { score: number }) {
  const r = 36; const c = 2 * Math.PI * r;
  const color = HEALTH_COLOR(score);
  return (
    <div className="relative flex items-center justify-center w-24 h-24">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8"/>
        <circle cx="44" cy="44" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }}/>
      </svg>
      <div className="text-center z-10">
        <p className="text-2xl font-bold" style={{ color }}>{score}</p>
        <p className="text-[9px] text-white/30">/ 100</p>
      </div>
    </div>
  );
}

export default function WeeklyDigestPage() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [project, setProject]     = useState("");
  const [digest, setDigest]       = useState<Digest | null>(null);
  const [history, setHistory]     = useState<Digest[]>([]);
  const [pulse, setPulse]         = useState<Pulse | null>(null);
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [tab, setTab]             = useState<"digest"|"pulse"|"history">("digest");

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      api.get<Digest|null>(`/api/projects/${project}/digest/latest`),
      api.get<Digest[]>(`/api/projects/${project}/digest/history`),
      api.get<Pulse>(`/api/projects/${project}/pulse`),
    ]).then(([d, h, p]) => {
      setDigest(d);
      setHistory(h);
      setPulse(p);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { load(); }, [load]);

  async function triggerSynth() {
    if (!project) return;
    setSyncing(true);
    try {
      await api.post(`/api/projects/${project}/synthesize`, {});
      setTimeout(load, 3000);
    } catch { /* silent */ }
    finally { setSyncing(false); }
  }

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  const card = "rounded-2xl border border-white/10 p-5" as const;
  const cardBg: React.CSSProperties = { background: "rgba(255,255,255,0.02)" };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Brain Digest</h1>
          <p className="text-sm text-white/40 mt-0.5">Síntese autônoma semanal e pulso do conhecimento</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={project} onChange={e => setProject(e.target.value)}
            className="text-sm rounded-xl px-3 py-1.5 border outline-none bg-white/5 border-white/10 text-white/70">
            {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          <button onClick={triggerSynth} disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}>
            {syncing ? (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
              </svg>
            ) : (
              <svg fill="none" viewBox="0 0 16 16" className="w-3.5 h-3.5">
                <path d="M8 2v2M8 12v2M2 8h2M12 8h2M4.1 4.1l1.4 1.4M10.5 10.5l1.4 1.4M4.1 11.9l1.4-1.4M10.5 5.5l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
            {syncing ? "Sintetizando…" : "Sintetizar agora"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl border border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
        {(["digest","pulse","history"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-1.5 rounded-lg text-sm font-medium transition-all capitalize"
            style={{
              background: tab === t ? "rgba(99,102,241,0.2)" : "transparent",
              color: tab === t ? "#a5b4fc" : "rgba(255,255,255,0.35)",
            }}>
            {t === "digest" ? "Digest Semanal" : t === "pulse" ? "Pulso" : "Histórico"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-white/30 py-20">Carregando…</div>
      ) : (
        <>
          {/* ── DIGEST TAB ── */}
          {tab === "digest" && (
            <div className="space-y-4">
              {!digest ? (
                <div className={`${card} text-center py-16`} style={cardBg}>
                  <p className="text-white/30 text-sm mb-3">Nenhum digest gerado ainda</p>
                  <p className="text-white/20 text-xs">O sistema sintetiza automaticamente toda semana às 03:00 UTC.<br/>Clique em "Sintetizar agora" para gerar o primeiro.</p>
                </div>
              ) : (
                <>
                  {/* Meta info */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 text-white/50">
                      Semana {digest.period}
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 text-white/50">
                      {digest.memoriesIn} memórias analisadas
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 text-white/50">
                      +{digest.newSyntheses} sínteses criadas
                    </span>
                    <span className="text-xs text-white/30">{formatDate(digest.createdAt)}</span>
                  </div>

                  {/* Health + Summary */}
                  <div className={`${card} flex gap-6`} style={cardBg}>
                    <div className="shrink-0 flex flex-col items-center gap-2">
                      <HealthRing score={digest.healthScore} />
                      <p className="text-[10px] text-white/30">Brain Health</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-white/80 mb-3">Narrativa da semana</h3>
                      <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">{digest.summary}</p>
                    </div>
                  </div>

                  {/* Hot / Cold Topics */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className={card} style={cardBg}>
                      <h3 className="text-xs font-semibold text-white/50 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                        Tópicos Quentes
                      </h3>
                      {digest.hotTopics.length === 0 ? (
                        <p className="text-xs text-white/20">Nenhum acesso registrado</p>
                      ) : (
                        <div className="space-y-2">
                          {digest.hotTopics.map((t: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                                style={{ background: "rgba(16,185,129,0.12)", color: "#34d399" }}>
                                {t.type}
                              </span>
                              <span className="text-xs text-white/50">{t.count}×</span>
                              <span className="text-xs text-white/70 truncate">{t.keywords?.join(", ")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className={card} style={cardBg}>
                      <h3 className="text-xs font-semibold text-white/50 mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-gray-500"/>
                        Tópicos Esquecidos
                      </h3>
                      {digest.coldTopics.length === 0 ? (
                        <p className="text-xs text-white/20">Tudo ativo</p>
                      ) : (
                        <div className="space-y-2">
                          {digest.coldTopics.map((t: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                                style={{ background: "rgba(107,114,128,0.12)", color: "#9ca3af" }}>
                                {t.type}
                              </span>
                              <span className="text-xs text-white/70 truncate">{t.keywords?.join(", ")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Gaps */}
                  {digest.gaps.length > 0 && (
                    <div className={card} style={cardBg}>
                      <h3 className="text-xs font-semibold text-white/50 mb-3">Lacunas de Conhecimento Identificadas</h3>
                      <div className="space-y-3">
                        {digest.gaps.map((g, i) => (
                          <div key={i} className="flex gap-3">
                            <span className="mt-0.5 shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full h-fit"
                              style={{ background: `${PRIORITY_COLOR[g.priority]}18`, color: PRIORITY_COLOR[g.priority] }}>
                              {g.priority.toUpperCase()}
                            </span>
                            <div>
                              <p className="text-xs font-semibold text-white/80">{g.area}</p>
                              <p className="text-xs text-white/40 mt-0.5">{g.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── PULSE TAB ── */}
          {tab === "pulse" && pulse && (
            <div className="space-y-4">
              {/* KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Brain Health", value: pulse.healthScore, suffix: "/100", color: HEALTH_COLOR(pulse.healthScore) },
                  { label: "Total Memórias", value: pulse.total, suffix: "", color: "#818cf8" },
                  { label: "Validadas", value: pulse.validated, suffix: "", color: "#10b981" },
                  { label: "Sínteses Criadas", value: pulse.syntheses, suffix: "", color: "#f59e0b" },
                ].map(({ label, value, suffix, color }) => (
                  <div key={label} className={card} style={cardBg}>
                    <p className="text-2xl font-bold" style={{ color }}>{value}{suffix}</p>
                    <p className="text-xs text-white/40 mt-1">{label}</p>
                  </div>
                ))}
              </div>

              {/* Mini health ring */}
              <div className={`${card} flex items-center gap-6`} style={cardBg}>
                <HealthRing score={pulse.healthScore} />
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 flex-1">
                  {[
                    { label: "Memórias esta semana", value: pulse.recentWeek, color: "#818cf8" },
                    { label: "Com embedding vetorial", value: pulse.withEmbedding, color: "#6366f1" },
                    { label: "Validadas", value: pulse.validated, color: "#10b981" },
                    { label: "Depreciadas", value: pulse.deprecated, color: "#ef4444" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <p className="text-sm font-bold" style={{ color }}>{value}</p>
                      <p className="text-[10px] text-white/30">{label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hot memories */}
              <div className={card} style={cardBg}>
                <h3 className="text-xs font-semibold text-white/50 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
                  Conhecimento mais acessado (7 dias)
                </h3>
                {pulse.hot.length === 0 ? (
                  <p className="text-xs text-white/20">Nenhum acesso registrado ainda</p>
                ) : (
                  <div className="space-y-2">
                    {pulse.hot.map(m => (
                      <div key={m.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                          style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}>{m.type}</span>
                        <span className="text-xs text-white/70 flex-1 truncate">{m.title}</span>
                        <span className="text-xs font-bold text-emerald-400">{m.accessCount}×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cold memories */}
              {pulse.cold.length > 0 && (
                <div className={card} style={cardBg}>
                  <h3 className="text-xs font-semibold text-white/50 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500"/>
                    Conhecimento esquecido (sem acesso &gt; 30 dias)
                  </h3>
                  <div className="space-y-2">
                    {pulse.cold.map(m => (
                      <div key={m.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                          style={{ background: "rgba(107,114,128,0.12)", color: "#9ca3af" }}>{m.type}</span>
                        <span className="text-xs text-white/50 flex-1 truncate">{m.title}</span>
                        <span className="text-xs text-white/25">imp {m.importance}/5</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY TAB ── */}
          {tab === "history" && (
            <div className="space-y-3">
              {history.length === 0 ? (
                <div className={`${card} text-center py-12`} style={cardBg}>
                  <p className="text-white/30 text-sm">Nenhum digest gerado ainda</p>
                </div>
              ) : (
                history.map(d => (
                  <div key={d.id} className={`${card} flex gap-4`} style={cardBg}>
                    <div className="shrink-0 text-center">
                      <p className="text-lg font-bold" style={{ color: HEALTH_COLOR(d.healthScore) }}>{d.healthScore}</p>
                      <p className="text-[9px] text-white/30">health</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-white/70">{d.period}</span>
                        <span className="text-[10px] text-white/30">{formatDate(d.createdAt)}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
                          {d.memoriesIn} mem · +{d.newSyntheses} sínteses
                        </span>
                      </div>
                      <p className="text-xs text-white/40 line-clamp-2">{d.summary}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
