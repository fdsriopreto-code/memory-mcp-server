import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { toast } from "sonner";

type MemoryMini = { id: string; title: string; type: string };

type RecentLink = {
  id: string;
  fromId: string;
  toId: string;
  fromTitle: string;
  fromType: string;
  toTitle: string;
  toType: string;
  relation: string;
  weight: number;
};

type BrainStats = {
  total: number;
  pinned: number;
  withEmbedding: number;
  links: number;
  byType: { type: string; count: number }[];
  epistemicDist?: { status: string; count: number }[];
  topAccessed: { id: string; title: string; type: string; importance: number; accessCount: number; epistemicStatus?: string }[];
  pinnedMemories: { id: string; title: string; type: string; importance: number; content: string; linkCount: number; epistemicStatus?: string }[];
  brainMemories: { id: string; title: string; content: string; importance: number; createdAt: string; epistemicStatus?: string }[];
  recentLinks: RecentLink[];
};

type Project = { id: string; name: string; slug: string; color: string };

const LINK_TYPES = ["EXTENDS", "SUPERSEDES", "CONTRADICTS", "DEPENDS_ON", "EXAMPLE_OF", "RELATED"] as const;
type LinkType = typeof LINK_TYPES[number];

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  DECISION:     { bg: "rgba(99,102,241,0.12)",  text: "#818cf8", dot: "#6366f1" },
  CONTEXT:      { bg: "rgba(59,130,246,0.12)",  text: "#93c5fd", dot: "#3b82f6" },
  PATTERN:      { bg: "rgba(16,185,129,0.12)",  text: "#6ee7b7", dot: "#10b981" },
  NOTE:         { bg: "rgba(245,158,11,0.12)",  text: "#fcd34d", dot: "#f59e0b" },
  BUG_FIX:      { bg: "rgba(239,68,68,0.12)",   text: "#fca5a5", dot: "#ef4444" },
  ARCHITECTURE: { bg: "rgba(139,92,246,0.12)",  text: "#c4b5fd", dot: "#8b5cf6" },
  BRAIN:        { bg: "rgba(236,72,153,0.12)",  text: "#f9a8d4", dot: "#ec4899" },
};

const RELATION_META: Record<string, { label: string; color: string; bg: string; desc: string; symbol: string }> = {
  EXTENDS:     { label: "Estende",     color: "#818cf8", bg: "rgba(99,102,241,0.15)",  desc: "A aprofunda ou adiciona detalhes a B",     symbol: "→" },
  SUPERSEDES:  { label: "Substitui",   color: "#c084fc", bg: "rgba(168,85,247,0.15)",  desc: "A substitui B — B está desatualizada",      symbol: "⇒" },
  CONTRADICTS: { label: "Contradiz",   color: "#f87171", bg: "rgba(239,68,68,0.15)",   desc: "A conflita ou nega B",                      symbol: "⊗" },
  DEPENDS_ON:  { label: "Depende de",  color: "#60a5fa", bg: "rgba(59,130,246,0.15)",  desc: "A só faz sentido quando B é conhecida",     symbol: "⟵" },
  EXAMPLE_OF:  { label: "Exemplo de",  color: "#34d399", bg: "rgba(16,185,129,0.15)",  desc: "A é um caso concreto ou instância de B",    symbol: "∈" },
  RELATED:     { label: "Relacionada", color: "#9ca3af", bg: "rgba(107,114,128,0.15)", desc: "A e B têm relação semântica geral",          symbol: "~" },
};

function TypeBadge({ type, small = false }: { type: string; small?: boolean }) {
  const s = TYPE_COLORS[type] ?? { bg: "rgba(107,114,128,0.15)", text: "#9ca3af", dot: "#6b7280" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${small ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"}`}
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

function Panel({ title, sub, children, accent = "#6366f1", action }: {
  title: string; sub?: string; children: React.ReactNode; accent?: string; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] overflow-hidden"
      style={{ background: "linear-gradient(135deg,#0d1117 0%,#0a0d18 100%)" }}>
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.05] flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-1 h-4 rounded-full shrink-0" style={{ background: accent }} />
            <p className="text-sm font-semibold text-white tracking-tight">{title}</p>
          </div>
          {sub && <p className="text-[11px] mt-1 ml-3.5" style={{ color: "rgba(255,255,255,0.28)" }}>{sub}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function BrainPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [stats,    setStats]    = useState<BrainStats | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [memories, setMemories] = useState<MemoryMini[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formFrom, setFormFrom] = useState("");
  const [formTo,   setFormTo]   = useState("");
  const [formRel,  setFormRel]  = useState<LinkType>("RELATED");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length > 0) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      api.get<BrainStats>(`/api/projects/${project}/brain-stats`),
      api.get<MemoryMini[]>(`/api/projects/${project}/memories`),
    ])
      .then(([s, m]) => { setStats(s); setMemories(m); })
      .catch(() => toast.error("Erro ao carregar brain stats"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { load(); }, [load]);

  const createLink = async () => {
    if (!formFrom || !formTo || formFrom === formTo) {
      toast.error("Selecione duas memórias diferentes");
      return;
    }
    setCreating(true);
    try {
      await api.post(`/api/projects/${project}/memories/link`, { fromId: formFrom, toId: formTo, relation: formRel });
      toast.success("Sinapse criada!");
      setShowForm(false);
      setFormFrom(""); setFormTo(""); setFormRel("RELATED");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar link");
    } finally {
      setCreating(false);
    }
  };

  const deleteLink = async (id: string) => {
    try {
      await api.delete(`/api/memories/links/${id}`);
      toast.success("Sinapse removida");
      load();
    } catch {
      toast.error("Erro ao remover sinapse");
    }
  };

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

  const selStyle = {
    background: "#080c1a",
    borderColor: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.75)",
  };

  const fromMem = memories.find(m => m.id === formFrom);
  const toMem   = memories.find(m => m.id === formTo);
  const relMeta = RELATION_META[formRel];

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
            Segundo cérebro da IA — grafo de conhecimento auto-evolutivo (CRE)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select value={project} onChange={e => setProject(e.target.value)}
            className="text-sm rounded-xl px-3 py-2 border outline-none"
            style={selStyle}>
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
          Selecione um projeto para ver o estado do cérebro.
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
                    { label: "Memórias",   value: stats.total,         icon: "🧠" },
                    { label: "Pinadas",    value: stats.pinned,        icon: "📌" },
                    { label: "Embeddings", value: stats.withEmbedding, icon: "🔢" },
                    { label: "Sinapses",   value: stats.links,         icon: "⚡" },
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

          {/* 3-col grid */}
          <div className="grid grid-cols-3 gap-4">

            {/* Type distribution */}
            <Panel title="Distribuição por Tipo" sub="Cobertura do conhecimento" accent="#6366f1">
              <div className="space-y-3">
                {stats.byType.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.2)" }}>Nenhuma memória ainda</p>
                )}
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

            {/* Brain Graph shortcut */}
            <Panel title="Brain Graph 3D" sub="Visualização força-dirigida do grafo" accent="#ec4899">
              <div className="space-y-4">
                {/* Mini node preview */}
                <div className="relative h-32 rounded-xl overflow-hidden"
                  style={{ background: "radial-gradient(ellipse at center, rgba(236,72,153,0.08) 0%, transparent 70%)" }}>
                  <svg width="100%" height="100%" viewBox="0 0 200 120">
                    {stats.recentLinks.slice(0, 4).map((_, i) => {
                      const x1 = 30 + (i % 2) * 140, y1 = 30 + Math.floor(i / 2) * 60;
                      const x2 = 100, y2 = 60;
                      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="rgba(139,92,246,0.3)" strokeWidth="1" strokeDasharray="3,3" />;
                    })}
                    {[
                      { x: 30,  y: 30,  r: 8,  c: "#6366f1" },
                      { x: 170, y: 30,  r: 6,  c: "#10b981" },
                      { x: 100, y: 60,  r: 12, c: "#ec4899" },
                      { x: 30,  y: 90,  r: 5,  c: "#f59e0b" },
                      { x: 170, y: 90,  r: 7,  c: "#8b5cf6" },
                    ].map((n, i) => (
                      <g key={i}>
                        <circle cx={n.x} cy={n.y} r={n.r + 4} fill={`${n.c}15`} />
                        <circle cx={n.x} cy={n.y} r={n.r} fill={`${n.c}40`} stroke={n.c} strokeWidth="1.5" />
                      </g>
                    ))}
                  </svg>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {stats.links} sinapses entre {stats.total} memórias renderizadas em tempo real com física força-dirigida e partículas.
                </p>
                <button
                  onClick={() => navigate("/brain-graph")}
                  className="w-full py-2.5 rounded-xl text-[12px] font-semibold transition-all"
                  style={{ background: "linear-gradient(135deg,rgba(236,72,153,0.2),rgba(139,92,246,0.2))",
                    color: "#f9a8d4", border: "1px solid rgba(236,72,153,0.2)" }}>
                  Abrir Brain Graph →
                </button>
              </div>
            </Panel>
          </div>

          {/* Knowledge Graph — full width */}
          <Panel
            title="Grafo de Conhecimento"
            sub={`${stats.links} sinapse${stats.links !== 1 ? "s" : ""} · ${memories.length} memórias disponíveis`}
            accent="#8b5cf6"
            action={
              <button onClick={() => setShowForm(v => !v)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
                style={{ background: showForm ? "rgba(139,92,246,0.25)" : "rgba(139,92,246,0.1)",
                  color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.2)" }}>
                {showForm ? "✕ Fechar" : "⚡ Nova Sinapse"}
              </button>
            }
          >

            {/* Add link form */}
            {showForm && (
              <div className="mb-6 rounded-xl border p-4"
                style={{ background: "rgba(139,92,246,0.04)", borderColor: "rgba(139,92,246,0.15)" }}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-4"
                  style={{ color: "rgba(139,92,246,0.7)" }}>Criar Nova Conexão Sináptica</p>

                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="text-[10px] block mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>De (origem)</label>
                    <select value={formFrom} onChange={e => setFormFrom(e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-2 border outline-none"
                      style={selStyle}>
                      <option value="">Selecionar memória...</option>
                      {memories.map(m => (
                        <option key={m.id} value={m.id}>[{m.type.slice(0,3)}] {m.title.slice(0, 45)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] block mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>Tipo de relação</label>
                    <select value={formRel} onChange={e => setFormRel(e.target.value as LinkType)}
                      className="w-full text-xs rounded-lg px-2.5 py-2 border outline-none font-semibold"
                      style={{ ...selStyle, color: RELATION_META[formRel]?.color }}>
                      {LINK_TYPES.map(t => (
                        <option key={t} value={t}>{RELATION_META[t].symbol} {RELATION_META[t].label}</option>
                      ))}
                    </select>
                    <p className="text-[9px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                      {relMeta?.desc}
                    </p>
                  </div>

                  <div>
                    <label className="text-[10px] block mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>Para (destino)</label>
                    <select value={formTo} onChange={e => setFormTo(e.target.value)}
                      className="w-full text-xs rounded-lg px-2.5 py-2 border outline-none"
                      style={selStyle}>
                      <option value="">Selecionar memória...</option>
                      {memories.filter(m => m.id !== formFrom).map(m => (
                        <option key={m.id} value={m.id}>[{m.type.slice(0,3)}] {m.title.slice(0, 45)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Preview */}
                {fromMem && toMem && (
                  <div className="flex items-center gap-2 mt-4 p-3 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <TypeBadge type={fromMem.type} small />
                    <span className="text-[11px] text-white/60 truncate max-w-[140px]">{fromMem.title}</span>
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold"
                      style={{ background: relMeta?.bg, color: relMeta?.color }}>
                      {relMeta?.symbol} {relMeta?.label}
                    </span>
                    <span className="text-[11px] text-white/60 truncate max-w-[140px]">{toMem.title}</span>
                    <TypeBadge type={toMem.type} small />
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <button onClick={createLink} disabled={creating || !formFrom || !formTo}
                    className="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: (!formFrom || !formTo) ? "rgba(139,92,246,0.08)" : "rgba(139,92,246,0.3)",
                      color: "#c4b5fd", opacity: (!formFrom || !formTo) ? 0.5 : 1,
                      cursor: (!formFrom || !formTo) ? "not-allowed" : "pointer",
                    }}>
                    {creating ? "⏳ Criando..." : "⚡ Criar Sinapse"}
                  </button>
                  <button onClick={() => { setShowForm(false); setFormFrom(""); setFormTo(""); setFormRel("RELATED"); }}
                    className="px-4 py-2 rounded-lg text-xs"
                    style={{ color: "rgba(255,255,255,0.3)" }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Empty state */}
            {stats.recentLinks.length === 0 && (
              <div className="py-10 flex flex-col items-center gap-5">
                <div className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(139,92,246,0.08)", border: "1px dashed rgba(139,92,246,0.25)" }}>
                  <span className="text-2xl">🕸️</span>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white/50 mb-1">Nenhuma sinapse ainda</p>
                  <p className="text-xs max-w-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
                    Crie conexões entre memórias usando o botão acima ou via MCP com <code className="font-mono text-purple-400">brain_relate()</code>.
                    O algoritmo CRE também cria sinapses automaticamente ao rodar <code className="font-mono text-pink-400">brain_synthesize()</code>.
                  </p>
                </div>

                {/* Relation types guide */}
                <div className="grid grid-cols-3 gap-2 w-full max-w-lg mt-2">
                  {Object.entries(RELATION_META).map(([key, m]) => (
                    <div key={key} className="rounded-lg p-2.5 border"
                      style={{ background: `${m.bg}`, borderColor: `${m.color}25` }}>
                      <span className="text-sm font-bold" style={{ color: m.color }}>{m.symbol}</span>
                      <p className="text-[10px] font-semibold mt-0.5" style={{ color: m.color }}>{m.label}</p>
                      <p className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Links list */}
            {stats.recentLinks.length > 0 && (
              <div className="space-y-2">
                {stats.recentLinks.map(l => {
                  const rel = RELATION_META[l.relation] ?? { label: l.relation, color: "#9ca3af", bg: "rgba(107,114,128,0.1)", symbol: "~", desc: "" };
                  const wPct = Math.round(l.weight * 100);
                  return (
                    <div key={l.id}
                      className="flex items-center gap-3 rounded-xl p-3 border border-white/[0.04] group transition-all"
                      style={{ background: "rgba(255,255,255,0.02)" }}>

                      {/* From */}
                      <div className="flex-1 min-w-0">
                        <TypeBadge type={l.fromType} small />
                        <p className="text-[11px] text-white/70 truncate mt-0.5 leading-tight">{l.fromTitle}</p>
                      </div>

                      {/* Relation + weight */}
                      <div className="shrink-0 flex flex-col items-center gap-1 px-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{ background: rel.bg, color: rel.color }}>
                          {rel.symbol} {rel.label}
                        </span>
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-1 rounded-full bg-white/[0.06]">
                            <div className="h-full rounded-full transition-all" style={{ width: `${wPct}%`, background: rel.color, opacity: 0.7 }} />
                          </div>
                          <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>{l.weight.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* To */}
                      <div className="flex-1 min-w-0 text-right">
                        <div className="flex justify-end"><TypeBadge type={l.toType} small /></div>
                        <p className="text-[11px] text-white/70 truncate mt-0.5 leading-tight">{l.toTitle}</p>
                      </div>

                      {/* Delete */}
                      <button onClick={() => deleteLink(l.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
                        title="Remover sinapse">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

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
                      <p className="text-[10px] mt-2" style={{ color: "rgba(255,255,255,0.25)" }}>⚡ {m.linkCount} sinapses</p>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Brain memories (meta-knowledge) */}
          {stats.brainMemories.length > 0 && (
            <Panel title="🧠 Meta-Conhecimento (BRAIN)" sub="Cristais e notas do algoritmo CRE" accent="#ec4899">
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

          {/* Epistemic Distribution */}
          {stats.epistemicDist && stats.epistemicDist.length > 0 && (
            <Panel title="Status Epistêmico" sub="Distribuição de confiança nas memórias" accent="#10b981">
              <div className="space-y-3">
                {[
                  { key: "HYPOTHESIS",  label: "Hipótese",   color: "#f59e0b", icon: "?" },
                  { key: "VALIDATED",   label: "Validado",   color: "#10b981", icon: "✓" },
                  { key: "CONTESTED",   label: "Contestado", color: "#ef4444", icon: "!" },
                  { key: "DEPRECATED",  label: "Obsoleto",   color: "#6b7280", icon: "✕" },
                ].map(({ key, label, color, icon }) => {
                  const entry = stats.epistemicDist!.find(e => e.status === key);
                  const count = entry?.count ?? 0;
                  const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold w-4 text-center" style={{ color }}>{icon}</span>
                          <span className="text-[11px] text-white/60">{label}</span>
                        </div>
                        <span className="text-[11px] font-mono text-white/40">{count}</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.05]">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* Tools guide */}
          <Panel title="🛠️ Ferramentas MCP Disponíveis" sub="Use via Claude Code — todas requerem project_slug" accent="#3b82f6">
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "brain_session_start", desc: "Kickoff de sessão com contexto otimizado + pinadas + foco semântico", accent: "#6366f1", tag: "SESSÃO" },
                { name: "brain_learn",         desc: "Digere resumo de sessão com IA e extrai memórias estruturadas automaticamente", accent: "#10b981", tag: "IA" },
                { name: "brain_query",         desc: "Busca semântica + traversal do grafo (1-2 saltos) + pinadas", accent: "#3b82f6", tag: "BUSCA" },
                { name: "brain_reflect",       desc: "Analisa estado do cérebro — gaps, duplicatas, obsoletos e sugestões", accent: "#f59e0b", tag: "ANALISE" },
                { name: "brain_evolve",        desc: "Auto-melhoria: eleva memórias muito acessadas, rebaixa obsoletas", accent: "#8b5cf6", tag: "EVOLUÇÃO" },
                { name: "brain_relate",        desc: "Cria links tipados: brain_relate(fromId, toId, 'EXTENDS'|'DEPENDS_ON'|…)", accent: "#ec4899", tag: "GRAFO" },
                { name: "brain_consolidate",   desc: "Usa IA para mesclar memórias fragmentadas em uma única completa", accent: "#ef4444", tag: "IA" },
                { name: "brain_knowledge_map", desc: "Mapa textual do grafo de conhecimento por tipo e relação", accent: "#f97316", tag: "GRAFO" },
                { name: "brain_synthesize",    desc: "Roda ciclo CRE completo: OBSERVE → ASSOCIATE → CRYSTALLIZE → PRUNE → EVOLVE", accent: "#ec4899", tag: "CRE" },
                { name: "brain_pulse",         desc: "Status do algoritmo CRE: parâmetros λ/θ/σ/τ, ciclo atual, estado cognitivo", accent: "#8b5cf6", tag: "CRE" },
                { name: "brain_dream",         desc: "Modo SONHO — conecta memórias dormentes com sinapses criativas inesperadas", accent: "#6366f1", tag: "CRE" },
                { name: "brain_resonance_map", desc: "Mapa de ressonância cognitiva — memórias organizadas por temperatura e peso sináptico", accent: "#10b981", tag: "CRE" },
                { name: "brain_epistemic",        desc: "Visualiza e promove status epistêmico: HYPOTHESIS→VALIDATED→CONTESTED→DEPRECATED", accent: "#10b981", tag: "EPISTÊMICO" },
                { name: "brain_causal_discover",  desc: "Descobre relações CAUSES automaticamente analisando padrões de co-acesso nos logs", accent: "#f59e0b", tag: "CAUSAL" },
                { name: "brain_predict_context",  desc: "Prediz quais memórias você precisará agora baseado em padrões horários/diários", accent: "#6366f1", tag: "PREDITIVO" },
                { name: "brain_cross_transfer",   desc: "Busca conhecimento em outros projetos quando o atual não tem resposta suficiente", accent: "#3b82f6", tag: "TRANSFER" },
                { name: "brain_infer",            desc: "Inferência zero-shot: atravessa o grafo de links para responder sem memória direta", accent: "#8b5cf6", tag: "INFERÊNCIA" },
                { name: "brain_consensus",        desc: "Debate multi-agente: 2 GPTs debatem memórias conflitantes e um árbitro sintetiza", accent: "#ec4899", tag: "CONSENSO" },
              ].map(t => (
                <div key={t.name} className="rounded-xl p-3.5 border border-white/[0.05]"
                  style={{ background: `${t.accent}08` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[11px] font-bold font-mono" style={{ color: t.accent }}>{t.name}</p>
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold"
                      style={{ background: `${t.accent}20`, color: t.accent }}>
                      {t.tag}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>{t.desc}</p>
                </div>
              ))}
            </div>

            {/* CRE explanation */}
            <div className="mt-4 rounded-xl p-4 border"
              style={{ background: "rgba(236,72,153,0.03)", borderColor: "rgba(236,72,153,0.12)" }}>
              <p className="text-[11px] font-bold mb-2" style={{ color: "#f9a8d4" }}>
                ⟡ CRE — Cognitive Resonance Evolution
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
                Algoritmo auto-evolutivo de 5 fases: <strong className="text-white/60">OBSERVE</strong> calcula ressonância de cada memória ·{" "}
                <strong className="text-white/60">ASSOCIATE</strong> fortalece sinapses Hebbians (w = w×0.88 + coRes×0.12) ·{" "}
                <strong className="text-white/60">CRYSTALLIZE</strong> gera cristais de conhecimento via GPT-4o-mini de clusters quentes ·{" "}
                <strong className="text-white/60">PRUNE</strong> remove sinapses fracas (w &lt; τ) ·{" "}
                <strong className="text-white/60">EVOLVE</strong> auto-ajusta os parâmetros λ/θ/σ/τ baseado no estado cognitivo observado.
              </p>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
