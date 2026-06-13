import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type Memory = {
  id: string; type: string; title: string; content: string;
  tags: string[]; importance: number; accessCount: number; createdAt: string;
};
type Project = { id: string; name: string; slug: string; color: string };

const TYPES = ["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE"] as const;

const TYPE_META: Record<string, { bg: string; text: string; dot: string }> = {
  DECISION:     { bg: "bg-violet-500/15", text: "text-violet-300",  dot: "#8b5cf6" },
  CONTEXT:      { bg: "bg-blue-500/15",   text: "text-blue-300",    dot: "#3b82f6" },
  PATTERN:      { bg: "bg-emerald-500/15",text: "text-emerald-300", dot: "#10b981" },
  NOTE:         { bg: "bg-yellow-500/15", text: "text-yellow-300",  dot: "#f59e0b" },
  BUG_FIX:      { bg: "bg-red-500/15",    text: "text-red-300",     dot: "#ef4444" },
  ARCHITECTURE: { bg: "bg-orange-500/15", text: "text-orange-300",  dot: "#f97316" },
};

function ImportanceDots({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5 items-center">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${i < value ? "bg-indigo-400" : "bg-gray-700"}`}
        />
      ))}
    </span>
  );
}

const EMPTY_FORM = { type: "NOTE" as typeof TYPES[number], title: "", content: "", tags: "", importance: 3 };

export default function MemoriesPage() {
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [project,   setProject]   = useState<string>("");
  const [memories,  setMemories]  = useState<Memory[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [typeFilter,setTypeFilter]= useState<string>("");
  const [form, setForm] = useState(EMPTY_FORM);
  const { subscribe } = useWs();

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(setProjects).catch(console.error);
  }, []);

  const loadMemories = useCallback(() => {
    if (!project) { setMemories([]); return; }
    setLoading(true);
    api.get<Memory[]>(`/api/projects/${project}/memories`)
      .then(setMemories).catch(() => toast.error("Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  // refresh when MCP tools change memories
  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as { tool: string; project?: { slug: string } };
      if (log.tool.startsWith("memory_") && log.project?.slug === project) {
        loadMemories();
      }
    });
  }, [subscribe, project, loadMemories]);

  // refresh when REST API changes memories
  useEffect(() => {
    return subscribe("refresh", (data) => {
      const ev = data as { resource: string; projectSlug?: string };
      if (ev.resource === "memory" && (!ev.projectSlug || ev.projectSlug === project)) {
        loadMemories();
      }
    });
  }, [subscribe, project, loadMemories]);

  const visible = useMemo(() => {
    let m = memories;
    if (typeFilter) m = m.filter(x => x.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      m = m.filter(x =>
        x.title.toLowerCase().includes(q) ||
        x.content.toLowerCase().includes(q) ||
        x.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return m;
  }, [memories, search, typeFilter]);

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

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    memories.forEach(m => { counts[m.type] = (counts[m.type] ?? 0) + 1; });
    return counts;
  }, [memories]);

  const currentProject = projects.find(p => p.slug === project);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Memórias</h1>
          {project && (
            <p className="text-xs text-gray-500 mt-0.5">
              {memories.length} memórias · {currentProject?.name}
            </p>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={project} onChange={e => { setProject(e.target.value); setSearch(""); setTypeFilter(""); }}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Selecionar projeto...</option>
            {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
          {project && (
            <button onClick={() => setShowForm(v => !v)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shrink-0">
              + Nova
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {showForm && project && (
        <form onSubmit={handleCreate} className="bg-gray-900 border border-indigo-500/30 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Nova memória</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tipo</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as typeof TYPES[number] }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500">
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Importância</label>
              <div className="flex gap-2 items-center mt-2">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setForm(f => ({ ...f, importance: n }))}
                    className={`w-6 h-6 rounded-full text-xs font-bold transition-colors ${
                      n <= form.importance ? "bg-indigo-500 text-white" : "bg-gray-800 text-gray-600 hover:bg-gray-700"
                    }`}>{n}</button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Título</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Conteúdo</label>
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} required rows={5}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 resize-none font-mono" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Tags <span className="text-gray-600">(separar por vírgula)</span></label>
              <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                placeholder="auth, backend, prisma"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Salvar</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">Cancelar</button>
          </div>
        </form>
      )}

      {/* Filters */}
      {project && !loading && memories.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">⌕</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar memórias..."
              className="w-full pl-8 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setTypeFilter("")}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                !typeFilter ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300" : "border-gray-800 text-gray-500 hover:border-gray-700"
              }`}
            >Todos ({memories.length})</button>
            {TYPES.filter(t => typeCounts[t]).map(t => {
              const meta = TYPE_META[t];
              return (
                <button key={t} onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    typeFilter === t ? `${meta.bg} ${meta.text} border-current` : "border-gray-800 text-gray-500 hover:border-gray-700"
                  }`}>
                  {t.replace("_"," ")} ({typeCounts[t]})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && <div className="text-gray-500 text-sm">Carregando...</div>}

      {/* Memory cards */}
      <div className="grid grid-cols-1 gap-2">
        {visible.map(m => {
          const meta = TYPE_META[m.type] ?? { bg: "bg-gray-700/20", text: "text-gray-400", dot: "#6b7280" };
          const isExp = expanded === m.id;
          return (
            <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors">
              <div
                className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                onClick={() => setExpanded(isExp ? null : m.id)}
              >
                {/* Type indicator bar */}
                <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: meta.dot }} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.bg} ${meta.text}`}>
                      {m.type.replace("_"," ")}
                    </span>
                    <ImportanceDots value={m.importance} />
                    {m.accessCount > 0 && (
                      <span className="text-[10px] text-gray-600">{m.accessCount}× lido</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-white leading-snug">{m.title}</p>
                  {!isExp && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{m.content}</p>
                  )}
                  {m.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-1.5">
                      {m.tags.map(tag => (
                        <span key={tag} className="text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(m.id); }}
                    className="text-gray-700 hover:text-red-400 transition-colors text-sm opacity-0 group-hover:opacity-100 p-1"
                    style={{ opacity: 1 }}
                  >✕</button>
                  <span className="text-gray-600 text-xs">{isExp ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExp && (
                <div className="px-4 pb-4 border-t border-gray-800 pt-3">
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{m.content}</pre>
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-[10px] text-gray-700 font-mono">{m.id}</p>
                    <p className="text-[10px] text-gray-700">
                      {new Date(m.createdAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && project && visible.length === 0 && memories.length > 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">Nenhuma memória para o filtro atual.</div>
      )}
      {!loading && project && memories.length === 0 && (
        <div className="text-center py-12 text-gray-600 text-sm">
          <div className="text-4xl mb-3 opacity-20">◉</div>
          <p>Nenhuma memória neste projeto.</p>
          <p className="text-xs mt-1 text-gray-700">O Claude pode criar memórias via MCP.</p>
        </div>
      )}
      {!project && (
        <div className="text-center py-12 text-gray-600 text-sm">
          <div className="text-4xl mb-3 opacity-20">◉</div>
          Selecione um projeto para ver as memórias.
        </div>
      )}
    </div>
  );
}
