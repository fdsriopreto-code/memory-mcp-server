import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";

type BrainStats = {
  total: number;
  pinned: number;
  withEmbedding: number;
  links: number;
  byType: { type: string; count: number }[];
  topAccessed: { id: string; title: string; type: string; importance: number; accessCount: number }[];
  pinnedMemories: { id: string; title: string; type: string; importance: number; content: string; linkCount: number }[];
  brainMemories: { id: string; title: string; content: string; importance: number; createdAt: string }[];
  recentLinks: { fromTitle: string; toTitle: string; relation: string }[];
};

type Project = { id: string; name: string; slug: string; color: string };

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  DECISION:     { bg: "rgba(99,102,241,0.12)",  text: "#818cf8", dot: "#6366f1" },
  CONTEXT:      { bg: "rgba(59,130,246,0.12)",  text: "#93c5fd", dot: "#3b82f6" },
  PATTERN:      { bg: "rgba(16,185,129,0.12)",  text: "#6ee7b7", dot: "#10b981" },
  NOTE:         { bg: "rgba(245,158,11,0.12)",  text: "#fcd34d", dot: "#f59e0b" },
  BUG_FIX:      { bg: "rgba(239,68,68,0.12)",   text: "#fca5a5", dot: "#ef4444" },
  ARCHITECTURE: { bg: "rgba(139,92,246,0.12)",  text: "#c4b5fd", dot: "#8b5cf6" },
  BRAIN:        { bg: "rgba(236,72,153,0.12)",  text: "#f9a8d4", dot: "#ec4899" },
};

const RELATION_STYLE: Record<string, string> = {
  EXTENDS:    "text-indigo-400",
  SUPERSEDES: "text-purple-400",
  CONTRADICTS:"text-red-400",
  DEPENDS_ON: "text-blue-400",
  EXAMPLE_OF: "text-emerald-400",
  RELATED:    "text-gray-400",
};

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_COLORS[type] ?? { bg: "rgba(107,114,128,0.15)", text: "#9ca3af", dot: "#6b7280" };
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      {type.replace(/_/g, " ")}
    </span>
  );
}

function ImpStars({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <span key={i} className="text-[10px]" style={{ color: i <= value ? "#f59e0b" : "rgba(255,255,255,0.1)" }}>★</span>
      ))}
    </span>
  );
}

function Panel({ title, sub, children, accent = "#6366f1" }: {
  title: string; sub?: string; children: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] overflow-hidden"
      style={{ background: "linear-gradient(135deg,#0d1117 0%,#0a0d18 100%)" }}>
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.05]">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-4 rounded-full" style={{ background: accent }} />
          <p className="text-sm font-semibold text-white tracking-tight">{title}</p>
        </div>
        {sub && <p className="text-[11px] mt-1 ml-3.5" style={{ color: "rgba(255,255,255,0.28)" }}>{sub}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function BrainPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [stats,    setStats]    = useState<BrainStats | null>(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length > 0) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    api.get<BrainStats>(`/api/projects/${project}/brain-stats`)
      .then(setStats)
      .catch(() => toast.error("Erro ao carregar brain stats"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { load(); }, [load]);

  const healthScore = stats
    ? Math.round(
        (stats.pinned > 0 ? 20 : 0) +
        Math.min(30, (stats.withEmbedding / Math.max(stats.total, 1)) * 30) +
        Math.min(20, (stats.links / Math.max(stats.total * 0.5, 1)) * 20) +
        Math.min(20, Math.min(stats.total / 10, 1) * 20) +
        (stats.brainMemories.length > 0 ? 10 : 0)
      )
    : 0;

  const healthColor = healthScore >= 80 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : "#ef4444";
  const healthLabel = healthScore >= 80 ? "Excelente" : healthScore >= 50 ? "Bom" : "Precisa atenção";

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
              <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4 text-white">
                <path d="M10 3c-1.5 0-2.8.7-3.5 1.8-.6-.3-1.3-.3-2 0C3.5 5.5 3 6.7 3 8c0 1 .4 2 1 2.6.2 1.4 1.1 2.5 2.3 3.1L7 17h6l.7-3.3c1.2-.6 2.1-1.7 2.3-3.1.6-.6 1-1.6 1-2.6 0-1.3-.5-2.5-1.5-3.2-.7-.3-1.4-.3-2 0C12.8 3.7 11.5 3 10 3z"
                  stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Brain</h1>
          </div>
          <p className="text-[12px] ml-11" style={{ color: "rgba(255,255,255,0.28)" }}>
            Segundo cérebro da IA — grafo de conhecimento auto-evolutivo
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={project}
            onChange={e => setProject(e.target.value)}
            className="text-sm rounded-xl px-3 py-2 border outline-none transition-all"
            style={{ background: "#0d1117", borderColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
          >
            {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          <button onClick={load}
            className="px-3 py-2 rounded-xl text-sm border transition-all"
            style={{ background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.2)", color: "rgba(165,180,252,0.8)" }}>
            ↻
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <span className="h-5 w-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && !stats && (
        <div className="text-center py-20 text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
          Selecione um projeto para ver o estado do cérebro.<br/>
          <span className="text-[11px]">A API /brain-stats precisa ser configurada no backend.</span>
        </div>
      )}

      {!loading && stats && (
        <>
          {/* Brain Health Score */}
          <div className="rounded-2xl border border-white/[0.06] p-6 overflow-hidden relative"
            style={{ background: "linear-gradient(135deg,#0d1117 0%,#0a0d18 100%)" }}>
            <div className="absolute top-0 right-0 w-48 h-48 rounded-full blur-3xl opacity-[0.06]"
              style={{ background: healthColor }} />
            <div className="flex items-center gap-8">
              {/* Score ring */}
              <div className="relative shrink-0 w-24 h-24">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="40" fill="none"
                    stroke={healthColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - healthScore / 100)}`}
                    style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-white tabular-nums">{healthScore}</span>
                  <span className="text-[9px] font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>/ 100</span>
                </div>
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-lg font-bold text-white">Brain Health</p>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{ background: `${healthColor}20`, color: healthColor }}>
                    {healthLabel}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: "Memórias",    value: stats.total,         icon: "🧠" },
                    { label: "Pinadas",     value: stats.pinned,        icon: "📌" },
                    { label: "Embeddings",  value: stats.withEmbedding, icon: "🔢" },
                    { label: "Links",       value: stats.links,         icon: "🔗" },
                  ].map(m => (
                    <div key={m.label}>
                      <p className="text-xl font-bold text-white tabular-nums">{m.value}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{m.icon} {m.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">

            {/* Type distribution */}
            <Panel title="Distribuição por Tipo" sub="Cobertura do conhecimento" accent="#6366f1">
              <div className="space-y-3">
                {stats.byType.map(t => {
                  const c = TYPE_COLORS[t.type]?.dot ?? "#6b7280";
                  const pct = stats.total > 0 ? (t.count / stats.total) * 100 : 0;
                  return (
                    <div key={t.type}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                          <span className="text-[11px] text-white/60">{t.type.replace(/_/g, " ")}</span>
                        </div>
                        <span className="text-[11px] font-mono text-white/40">{t.count}</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.05]">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: c }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* Top accessed */}
            <Panel title="Mais Acessadas" sub="Memórias com maior uso" accent="#10b981">
              <div className="space-y-3">
                {stats.topAccessed.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.2)" }}>Nenhum acesso ainda</p>
                )}
                {stats.topAccessed.map((m, i) => (
                  <div key={m.id} className="flex items-start gap-2.5">
                    <span className="text-[11px] font-mono w-4 shrink-0 mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-white/80 truncate leading-tight">{m.title}</p>
                      <TypeBadge type={m.type} />
                    </div>
                    <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: "#fcd34d" }}>{m.accessCount}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Knowledge graph links */}
            <Panel title="Grafo de Conhecimento" sub="Links recentes entre memórias" accent="#8b5cf6">
              <div className="space-y-3">
                {stats.recentLinks.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.2)" }}>
                    Nenhum link ainda.<br/>Use brain_relate() para conectar memórias.
                  </p>
                )}
                {stats.recentLinks.map((l, i) => (
                  <div key={i} className="text-[11px]">
                    <p className="text-white/70 truncate">{l.fromTitle}</p>
                    <p className={`font-semibold ml-2 ${RELATION_STYLE[l.relation] ?? "text-gray-400"}`}>
                      ↓ {l.relation.replace(/_/g, " ")}
                    </p>
                    <p className="text-white/50 truncate ml-4">{l.toTitle}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Pinned memories */}
          {stats.pinnedMemories.length > 0 && (
            <Panel title="📌 Memórias Pinadas" sub="Sempre incluídas no contexto de sessão" accent="#f59e0b">
              <div className="grid grid-cols-2 gap-3">
                {stats.pinnedMemories.map(m => (
                  <div key={m.id} className="rounded-xl p-4 border border-white/[0.05]"
                    style={{ background: "rgba(245,158,11,0.04)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <TypeBadge type={m.type} />
                      <ImpStars value={m.importance} />
                    </div>
                    <p className="text-[12px] font-semibold text-white leading-tight mb-1">{m.title}</p>
                    <p className="text-[11px] line-clamp-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {m.content.slice(0, 120)}{m.content.length > 120 ? "…" : ""}
                    </p>
                    {m.linkCount > 0 && (
                      <p className="text-[10px] mt-2" style={{ color: "rgba(255,255,255,0.25)" }}>🔗 {m.linkCount} links</p>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Brain memories (meta-knowledge) */}
          {stats.brainMemories.length > 0 && (
            <Panel title="🧠 Meta-Conhecimento (BRAIN)" sub="Notas sobre como trabalhar com este projeto" accent="#ec4899">
              <div className="space-y-4">
                {stats.brainMemories.map(m => (
                  <div key={m.id} className="rounded-xl p-4 border border-white/[0.05]"
                    style={{ background: "rgba(236,72,153,0.04)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[12px] font-semibold text-white">{m.title}</p>
                      <ImpStars value={m.importance} />
                    </div>
                    <p className="text-[11px] leading-relaxed whitespace-pre-line"
                      style={{ color: "rgba(255,255,255,0.5)" }}>
                      {m.content.slice(0, 400)}{m.content.length > 400 ? "…" : ""}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Tools guide */}
          <Panel title="🛠️ Ferramentas Disponíveis" sub="Use via Claude Code / MCP" accent="#3b82f6">
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "brain_session_start", desc: "Kickoff de sessão com contexto otimizado + pinadas + foco semântico", accent: "#6366f1" },
                { name: "brain_learn",         desc: "Digere resumo de sessão com IA e extrai memórias estruturadas automaticamente", accent: "#10b981" },
                { name: "brain_query",         desc: "Busca semântica + traversal do grafo (1-2 saltos) + pinadas", accent: "#3b82f6" },
                { name: "brain_reflect",       desc: "Analisa estado do cérebro — gaps, duplicatas, obsoletos e sugestões", accent: "#f59e0b" },
                { name: "brain_evolve",        desc: "Auto-melhoria: eleva memórias muito acessadas, rebaixa obsoletas", accent: "#8b5cf6" },
                { name: "brain_relate",        desc: "Cria links tipados entre memórias (EXTENDS, SUPERSEDES, CONTRADICTS…)", accent: "#ec4899" },
                { name: "brain_consolidate",   desc: "Usa IA para mesclar memórias fragmentadas em uma única completa", accent: "#ef4444" },
                { name: "brain_knowledge_map", desc: "Mapa textual do grafo de conhecimento por tipo e relação", accent: "#f97316" },
              ].map(t => (
                <div key={t.name} className="rounded-xl p-3.5 border border-white/[0.05]"
                  style={{ background: `${t.accent}08` }}>
                  <p className="text-[11px] font-bold font-mono mb-1" style={{ color: t.accent }}>{t.name}</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>{t.desc}</p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
