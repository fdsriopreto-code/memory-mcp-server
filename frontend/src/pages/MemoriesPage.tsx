import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type Memory = {
  id: string; type: string; title: string; content: string;
  tags: string[]; importance: number; accessCount: number; createdAt: string;
  epistemicStatus?: string;
};
type Project = { id: string; name: string; slug: string; color: string };
type View = "card" | "list";

const TYPES = ["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE","BRAIN"] as const;

const TYPE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  DECISION:     { label: "Decisão",      color: "#6366f1", bg: "rgba(99,102,241,0.1)",   icon: "⚑" },
  CONTEXT:      { label: "Contexto",     color: "#3b82f6", bg: "rgba(59,130,246,0.1)",   icon: "◎" },
  PATTERN:      { label: "Padrão",       color: "#10b981", bg: "rgba(16,185,129,0.1)",   icon: "⬡" },
  NOTE:         { label: "Nota",         color: "#f59e0b", bg: "rgba(245,158,11,0.1)",   icon: "✎" },
  BUG_FIX:      { label: "Bug Fix",      color: "#ef4444", bg: "rgba(239,68,68,0.1)",    icon: "⚠" },
  ARCHITECTURE: { label: "Arquitetura",  color: "#8b5cf6", bg: "rgba(139,92,246,0.1)",   icon: "⬢" },
  BRAIN:        { label: "Brain",        color: "#ec4899", bg: "rgba(236,72,153,0.1)",   icon: "◈" },
};

const EPISTEMIC_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  HYPOTHESIS:  { label: "Hipótese",   color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  icon: "?" },
  VALIDATED:   { label: "Validado",   color: "#10b981", bg: "rgba(16,185,129,0.12)",  icon: "✓" },
  CONTESTED:   { label: "Contestado", color: "#ef4444", bg: "rgba(239,68,68,0.12)",   icon: "!" },
  DEPRECATED:  { label: "Obsoleto",   color: "#6b7280", bg: "rgba(107,114,128,0.12)", icon: "✕" },
};

const EMPTY_FORM = { type: "NOTE" as typeof TYPES[number], title: "", content: "", tags: "", importance: 3 };

function ImportancePips({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5 items-center">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="inline-block w-1.5 h-1.5 rounded-full transition-colors"
          style={{ background: i < value ? "#6366f1" : "var(--border-strong)" }} />
      ))}
    </span>
  );
}

function EpistemicBadge({ status }: { status?: string }) {
  if (!status || status === "HYPOTHESIS") return null;
  const m = EPISTEMIC_META[status];
  if (!m) return null;
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: m.bg, color: m.color }}>
      {m.icon} {m.label}
    </span>
  );
}

function MemoryCard({ mem, onDelete, expanded, onToggle }: {
  mem: Memory; onDelete: (id: string) => void;
  expanded: boolean; onToggle: () => void;
}) {
  const meta = TYPE_META[mem.type] ?? { label: mem.type, color: "#6b7280", bg: "rgba(107,114,128,0.1)", icon: "◉" };
  const heat = Math.min(1, mem.accessCount / 20);

  return (
    <div onClick={onToggle}
      className="rounded-2xl overflow-hidden cursor-pointer group transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${expanded ? meta.color + "55" : "var(--border)"}`,
        boxShadow: expanded ? `0 0 0 1px ${meta.color}22, var(--shadow-card)` : "var(--shadow-card)",
      }}>
      {/* Type color top bar */}
      <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${meta.color}, ${meta.color}44)` }} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 mt-0.5"
            style={{ background: meta.bg, color: meta.color }}>
            {meta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: meta.bg, color: meta.color }}>
                {meta.label}
              </span>
              <EpistemicBadge status={mem.epistemicStatus} />
              <ImportancePips value={mem.importance} />
              {mem.accessCount > 0 && (
                <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                  {mem.accessCount > 0 && heat > 0.3 ? "🔥" : ""} {mem.accessCount}×
                </span>
              )}
            </div>
            <p className="text-sm font-semibold mt-1.5 leading-snug" style={{ color: "var(--text-1)" }}>
              {mem.title}
            </p>
          </div>
          <button onClick={e => { e.stopPropagation(); onDelete(mem.id); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded-lg hover:bg-red-500/10"
            style={{ color: "var(--text-3)" }}>
            <svg fill="none" viewBox="0 0 14 14" className="w-3.5 h-3.5"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Content */}
        <p className={`text-xs mt-3 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}
          style={{ color: "var(--text-2)" }}>
          {mem.content}
        </p>

        {/* Tags + meta */}
        <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {mem.tags.slice(0, expanded ? undefined : 3).map(tag => (
              <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-elevated)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                {tag}
              </span>
            ))}
            {!expanded && mem.tags.length > 3 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-elevated)", color: "var(--text-3)" }}>
                +{mem.tags.length - 3}
              </span>
            )}
          </div>
          <span className="text-[10px] shrink-0" style={{ color: "var(--text-3)" }}>
            {new Date(mem.createdAt).toLocaleDateString("pt-BR")}
          </span>
        </div>

        {/* Expanded footer */}
        {expanded && (
          <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>{mem.id.slice(-14)}</p>
            <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-3)" }}>
              <svg fill="none" viewBox="0 0 14 14" className="w-3 h-3"><path d="M7 1v6M10 4L7 7 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              {expanded ? "Colapsar" : "Expandir"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryRow({ mem, onDelete }: { mem: Memory; onDelete: (id: string) => void }) {
  const [exp, setExp] = useState(false);
  const meta = TYPE_META[mem.type] ?? { label: mem.type, color: "#6b7280", bg: "rgba(107,114,128,0.1)", icon: "◉" };
  return (
    <div className="group transition-all"
      style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExp(v => !v)}>
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
        <span className="text-[10px] font-bold w-20 shrink-0 px-2 py-0.5 rounded-full text-center"
          style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
        <EpistemicBadge status={mem.epistemicStatus} />
        <p className="flex-1 text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{mem.title}</p>
        <ImportancePips value={mem.importance} />
        {mem.accessCount > 0 && (
          <span className="text-[10px] w-12 text-right shrink-0" style={{ color: "var(--text-3)" }}>{mem.accessCount}×</span>
        )}
        <span className="text-[10px] w-20 text-right shrink-0 hidden md:block" style={{ color: "var(--text-3)" }}>
          {new Date(mem.createdAt).toLocaleDateString("pt-BR")}
        </span>
        <button onClick={e => { e.stopPropagation(); onDelete(mem.id); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 p-1 rounded hover:bg-red-500/10"
          style={{ color: "var(--text-3)" }}>
          <svg fill="none" viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
      {exp && (
        <div className="px-4 pb-3">
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>{mem.content}</p>
          {mem.tags.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {mem.tags.map(t => (
                <span key={t} className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-3)" }}>{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MemoriesPage() {
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [project,    setProject]    = useState<string>("");
  const [memories,   setMemories]   = useState<Memory[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [showForm,   setShowForm]   = useState(false);
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [search,         setSearch]         = useState("");
  const [typeFilter,     setTypeFilter]     = useState<string>("");
  const [epistemicFilter, setEpistemicFilter] = useState<string>("");
  const [view,       setView]       = useState<View>(() => (localStorage.getItem("memories-view") as View) ?? "card");
  const [form, setForm] = useState(EMPTY_FORM);
  const { subscribe } = useWs();

  useEffect(() => { api.get<Project[]>("/api/projects").then(setProjects).catch(console.error); }, []);

  const loadMemories = useCallback(() => {
    if (!project) { setMemories([]); return; }
    setLoading(true);
    api.get<Memory[]>(`/api/projects/${project}/memories`)
      .then(setMemories).catch(() => toast.error("Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as { tool: string; project?: { slug: string } };
      if (log.tool.startsWith("memory_") && log.project?.slug === project) loadMemories();
    });
  }, [subscribe, project, loadMemories]);

  useEffect(() => {
    return subscribe("refresh", (data) => {
      const ev = data as { resource: string; projectSlug?: string };
      if (ev.resource === "memory" && (!ev.projectSlug || ev.projectSlug === project)) loadMemories();
    });
  }, [subscribe, project, loadMemories]);

  function setViewP(v: View) { setView(v); localStorage.setItem("memories-view", v); }

  const visible = useMemo(() => {
    let m = memories;
    if (typeFilter) m = m.filter(x => x.type === typeFilter);
    if (epistemicFilter) m = m.filter(x => (x.epistemicStatus ?? "HYPOTHESIS") === epistemicFilter);
    if (search) {
      const q = search.toLowerCase();
      m = m.filter(x =>
        x.title.toLowerCase().includes(q) ||
        x.content.toLowerCase().includes(q) ||
        x.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return m;
  }, [memories, search, typeFilter, epistemicFilter]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    memories.forEach(m => { c[m.type] = (c[m.type] ?? 0) + 1; });
    return c;
  }, [memories]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/projects/${project}/memories`, {
        ...form,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      });
      toast.success("Memória salva!");
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover memória?")) return;
    setMemories(m => m.filter(x => x.id !== id));
    await api.delete(`/api/memories/${id}`).catch(() => loadMemories());
    toast.success("Removida");
  }

  const currentProject = projects.find(p => p.slug === project);
  const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500/30";
  const inputStyle = { background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text-1)" };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>Memórias</h1>
          {project && (
            <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>
              {memories.length} memórias · {currentProject?.name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Project selector */}
          <select value={project} onChange={e => { setProject(e.target.value); setSearch(""); setTypeFilter(""); setEpistemicFilter(""); }}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-1)" }}>
            <option value="">Selecionar projeto…</option>
            {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>

          {/* View toggle */}
          {project && (
            <div className="flex rounded-xl overflow-hidden p-0.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              {(["card","list"] as const).map(v => (
                <button key={v} onClick={() => setViewP(v)}
                  className="px-3 py-1.5 rounded-lg transition-all"
                  style={view === v ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-3)" }}>
                  {v === "card"
                    ? <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></svg>
                    : <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  }
                </button>
              ))}
            </div>
          )}

          {project && (
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
              <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Nova
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showForm && project && (
        <div className="rounded-2xl p-6 space-y-4"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-glow)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: "var(--text-1)" }}>Nova memória</h2>
            <button onClick={() => setShowForm(false)} style={{ color: "var(--text-3)" }}>
              <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Tipo</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as typeof TYPES[number] }))}
                  className={inputCls} style={inputStyle}>
                  {TYPES.map(t => <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Importância</label>
                <div className="flex gap-2 items-center mt-1">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} type="button" onClick={() => setForm(f => ({ ...f, importance: n }))}
                      className="w-8 h-8 rounded-xl text-xs font-bold transition-all"
                      style={n <= form.importance
                        ? { background: "#6366f1", color: "#fff" }
                        : { background: "var(--bg-elevated)", color: "var(--text-3)" }}>{n}</button>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Título *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
                  className={inputCls} style={inputStyle} placeholder="Descreva o que foi decidido…" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Conteúdo *</label>
                <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} required rows={4}
                  className={`${inputCls} resize-none font-mono text-xs`} style={inputStyle}
                  placeholder="Detalhes completos, raciocínio, exemplos…" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
                  Tags <span style={{ color: "var(--text-3)" }}>(separar por vírgula)</span>
                </label>
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  className={inputCls} style={inputStyle} placeholder="auth, backend, prisma" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="px-5 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>Salvar memória</button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-5 py-2 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", color: "var(--text-2)" }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Search + Type filters */}
      {project && !loading && memories.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <svg fill="none" viewBox="0 0 16 16" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--text-3)" }}>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M12 12l-2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar memórias por título, conteúdo ou tag…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-1)" }} />
          </div>

          {/* Type filter tabs */}
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setTypeFilter("")}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={!typeFilter
                ? { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)44" }
                : { background: "var(--bg-card)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
              Todos ({memories.length})
            </button>
            {TYPES.filter(t => typeCounts[t]).map(t => {
              const meta = TYPE_META[t];
              return (
                <button key={t} onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                  style={typeFilter === t
                    ? { background: `${meta.color}20`, color: meta.color, border: `1px solid ${meta.color}55` }
                    : { background: "var(--bg-card)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                  {meta.label} ({typeCounts[t]})
                </button>
              );
            })}
          </div>

          {/* Epistemic filter tabs */}
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setEpistemicFilter("")}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={!epistemicFilter
                ? { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)44" }
                : { background: "var(--bg-card)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
              Status: Todos
            </button>
            {Object.entries(EPISTEMIC_META).map(([key, m]) => (
              <button key={key} onClick={() => setEpistemicFilter(epistemicFilter === key ? "" : key)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                style={epistemicFilter === key
                  ? { background: m.bg, color: m.color, border: `1px solid ${m.color}55` }
                  : { background: "var(--bg-card)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      )}

      {/* Memories display */}
      {!loading && visible.length > 0 && (
        view === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visible.map(m => (
              <MemoryCard key={m.id} mem={m}
                expanded={expanded === m.id}
                onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            {/* List header */}
            <div className="flex items-center gap-3 px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <div className="w-1.5 h-1.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest w-20" style={{ color: "var(--text-3)" }}>Tipo</span>
              <span className="text-[10px] font-bold uppercase tracking-widest flex-1" style={{ color: "var(--text-3)" }}>Título</span>
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Importância</span>
              <span className="text-[10px] font-bold uppercase tracking-widest w-12 text-right" style={{ color: "var(--text-3)" }}>Acessos</span>
              <span className="text-[10px] font-bold uppercase tracking-widest w-20 text-right hidden md:block" style={{ color: "var(--text-3)" }}>Data</span>
              <div className="w-6" />
            </div>
            {visible.map(m => <MemoryRow key={m.id} mem={m} onDelete={handleDelete} />)}
          </div>
        )
      )}

      {/* Empty states */}
      {!loading && project && visible.length === 0 && memories.length > 0 && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhuma memória para o filtro atual.</p>
          <button onClick={() => { setSearch(""); setTypeFilter(""); setEpistemicFilter(""); }}
            className="mt-2 text-xs font-medium" style={{ color: "var(--accent)" }}>
            Limpar filtros
          </button>
        </div>
      )}
      {!loading && project && memories.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <svg fill="none" viewBox="0 0 32 32" className="w-8 h-8" style={{ color: "var(--text-3)" }}>
              <path d="M16 4C10.477 4 6 8.477 6 14c0 3.86 2.13 7.23 5.274 9.033L12.5 28h7l1.226-4.967C23.87 21.23 26 17.86 26 14c0-5.523-4.477-10-10-10z"
                stroke="currentColor" strokeWidth="1.5"/>
              <path d="M13 28h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Nenhuma memória ainda</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Claude pode criar memórias via MCP automaticamente.</p>
        </div>
      )}
      {!project && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <svg fill="none" viewBox="0 0 32 32" className="w-8 h-8" style={{ color: "var(--text-3)" }}>
              <rect x="4" y="8" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M4 13h24M12 8l-2-4M20 8l2-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Selecione um projeto</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Escolha um projeto acima para ver as memórias.</p>
        </div>
      )}
    </div>
  );
}
