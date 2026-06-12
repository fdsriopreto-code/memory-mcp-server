import { useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";

type Memory = {
  id: string; type: string; title: string; content: string;
  tags: string[]; importance: number; accessCount: number; createdAt: string;
};
type Project = { id: string; name: string; slug: string; color: string };

const TYPES = ["DECISION","CONTEXT","PATTERN","NOTE","BUG_FIX","ARCHITECTURE"] as const;
const TYPE_COLORS: Record<string, string> = {
  DECISION: "bg-violet-500/20 text-violet-300",
  CONTEXT:  "bg-blue-500/20 text-blue-300",
  PATTERN:  "bg-emerald-500/20 text-emerald-300",
  NOTE:     "bg-yellow-500/20 text-yellow-300",
  BUG_FIX:  "bg-red-500/20 text-red-300",
  ARCHITECTURE: "bg-orange-500/20 text-orange-300",
};

export default function MemoriesPage() {
  const [projects,  setProjects]  = useState<Project[]>([]);
  const [project,   setProject]   = useState<string>("");
  const [memories,  setMemories]  = useState<Memory[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [form, setForm] = useState({ type: "NOTE" as typeof TYPES[number], title: "", content: "", tags: "", importance: 3 });

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    if (!project) { setMemories([]); return; }
    setLoading(true);
    api.get<Memory[]>(`/api/projects/${project}/memories`)
      .then(setMemories).catch(() => toast.error("Erro ao carregar")).finally(() => setLoading(false));
  }, [project]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/projects/${project}/memories`, {
        ...form,
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      });
      toast.success("Memória salva!");
      setShowForm(false);
      setForm({ type: "NOTE", title: "", content: "", tags: "", importance: 3 });
      const updated = await api.get<Memory[]>(`/api/projects/${project}/memories`);
      setMemories(updated);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover memória?")) return;
    await api.delete(`/api/memories/${id}`);
    setMemories(m => m.filter(x => x.id !== id));
    toast.success("Removida");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Memórias</h1>
        <div className="flex gap-2">
          <select
            value={project} onChange={e => setProject(e.target.value)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="">Selecionar projeto...</option>
            {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>
          {project && (
            <button onClick={() => setShowForm(v => !v)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors">
              + Adicionar
            </button>
          )}
        </div>
      </div>

      {showForm && project && (
        <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
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
              <label className="block text-xs text-gray-400 mb-1">Importância (1-5)</label>
              <input type="number" min={1} max={5} value={form.importance}
                onChange={e => setForm(f => ({ ...f, importance: Number(e.target.value) }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Título</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Conteúdo</label>
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} required rows={5}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 resize-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Tags (separadas por vírgula)</label>
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

      {loading && <div className="text-gray-400 text-sm">Carregando...</div>}

      <div className="space-y-2">
        {memories.map(m => (
          <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div
              className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800/50 transition-colors"
              onClick={() => setExpanded(expanded === m.id ? null : m.id)}
            >
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 ${TYPE_COLORS[m.type] ?? "bg-gray-700 text-gray-300"}`}>
                {m.type}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{m.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  imp: {m.importance}/5 · {m.accessCount} acessos · {m.tags.join(", ") || "sem tags"}
                </p>
              </div>
              <button onClick={e => { e.stopPropagation(); handleDelete(m.id); }}
                className="text-gray-600 hover:text-red-400 transition-colors text-xs shrink-0">✕</button>
            </div>
            {expanded === m.id && (
              <div className="px-4 pb-4 border-t border-gray-800">
                <pre className="text-xs text-gray-300 whitespace-pre-wrap mt-3 font-sans leading-relaxed">{m.content}</pre>
                <p className="text-[10px] text-gray-600 mt-2 font-mono">{m.id}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {!loading && project && memories.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-sm">Nenhuma memória para este projeto.</div>
      )}
      {!project && <div className="text-center py-10 text-gray-500 text-sm">Selecione um projeto para ver as memórias.</div>}
    </div>
  );
}
