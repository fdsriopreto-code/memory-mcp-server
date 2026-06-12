import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { toast } from "sonner";

type Project = {
  id: string; name: string; slug: string; description: string | null; color: string;
  _count: { memories: number; tasks: number; writeRequests: number };
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "", color: "#6366f1" });

  async function load() {
    try { setProjects(await api.get<Project[]>("/api/projects")); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/projects", form);
      toast.success("Projeto criado!");
      setShowForm(false);
      setForm({ name: "", slug: "", description: "", color: "#6366f1" });
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  if (loading) return <div className="text-gray-400 text-sm">Carregando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Projetos</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          + Novo projeto
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Novo projeto</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Slug</label>
              <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} required
                placeholder="ile-manager"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Descrição</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cor</label>
              <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="h-9 w-20 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Criar</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">Cancelar</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map(p => (
          <Link key={p.id} to={`/projects/${p.slug}`}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors block">
            <div className="flex items-start gap-3">
              <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: p.color }} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm">{p.name}</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">{p.slug}</p>
                {p.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{p.description}</p>}
                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                  <span>🧠 {p._count.memories} memórias</span>
                  <span>✓ {p._count.tasks} tasks</span>
                  <span>✎ {p._count.writeRequests} writes</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-16 text-gray-500 text-sm">Nenhum projeto ainda. Crie o primeiro acima.</div>
      )}
    </div>
  );
}
