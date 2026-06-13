import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type Project = {
  id: string; name: string; slug: string; description: string | null; color: string;
  _count: { memories: number; tasks: number; writeRequests: number };
};
type Connection = { id: string; name: string; type: string; isActive: boolean };

const CONN_TYPE_COLORS: Record<string, string> = {
  POSTGRES: "text-blue-400",
  MYSQL:    "text-orange-400",
  REDIS:    "text-red-400",
  HTTP:     "text-purple-400",
};

function ConnectionRow({ conn, onDelete }: { conn: Connection; onDelete: (id: string) => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
      <span className={`text-[10px] font-bold ${CONN_TYPE_COLORS[conn.type] ?? "text-gray-400"}`}>{conn.type}</span>
      <span className="text-xs text-gray-300 flex-1">{conn.name}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${conn.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-gray-700 text-gray-500"}`}>
        {conn.isActive ? "ativo" : "inativo"}
      </span>
      <button
        onClick={() => onDelete(conn.id)}
        className="text-gray-700 hover:text-red-400 transition-colors text-xs"
      >✕</button>
    </div>
  );
}

function ProjectCard({
  project, onRefresh,
}: {
  project: Project;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loadingConns, setLoadingConns] = useState(false);
  const [showConnForm, setShowConnForm] = useState(false);
  const [connForm, setConnForm] = useState({ name: "", type: "POSTGRES", connectionString: "" });

  async function loadConnections() {
    setLoadingConns(true);
    try {
      const proj = await api.get<{ connections: Connection[] }>(`/api/projects/${project.slug}`);
      setConnections(proj.connections);
    } catch { /* silently */ }
    finally { setLoadingConns(false); }
  }

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && connections.length === 0) loadConnections();
  }

  async function addConnection(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/projects/${project.slug}/connections`, connForm);
      toast.success("Conexão adicionada!");
      setShowConnForm(false);
      setConnForm({ name: "", type: "POSTGRES", connectionString: "" });
      loadConnections();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  async function deleteConn(id: string) {
    if (!confirm("Remover conexão?")) return;
    await api.delete(`/api/connections/${id}`).catch(() => {});
    setConnections(c => c.filter(x => x.id !== id));
    toast.success("Removida");
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-colors">
      {/* Color accent bar */}
      <div className="h-0.5 w-full" style={{ background: project.color }} />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
              style={{ background: `${project.color}22`, color: project.color }}
            >
              {project.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">{project.name}</p>
              <p className="text-[11px] text-gray-600 font-mono">{project.slug}</p>
              {project.description && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{project.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Stat chips */}
        <div className="flex gap-2 mt-4 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">◉</span>
            <span className="text-xs font-semibold text-white">{project._count.memories}</span>
            <span className="text-[10px] text-gray-600">memórias</span>
          </div>
          <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">✓</span>
            <span className="text-xs font-semibold text-white">{project._count.tasks}</span>
            <span className="text-[10px] text-gray-600">tasks</span>
          </div>
          <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-gray-500">✎</span>
            <span className="text-xs font-semibold text-white">{project._count.writeRequests}</span>
            <span className="text-[10px] text-gray-600">writes</span>
          </div>
        </div>

        {/* Connections toggle */}
        <button
          onClick={handleExpand}
          className="mt-3 text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1"
        >
          <span>{expanded ? "▲" : "▼"}</span>
          <span>Conexões DB</span>
          {connections.length > 0 && (
            <span className="ml-1 bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-[10px]">
              {connections.length}
            </span>
          )}
        </button>
      </div>

      {/* Connections panel */}
      {expanded && (
        <div className="border-t border-gray-800 px-5 py-4 space-y-2">
          {loadingConns && <p className="text-xs text-gray-600">Carregando...</p>}

          {connections.map(c => (
            <ConnectionRow key={c.id} conn={c} onDelete={deleteConn} />
          ))}

          {!loadingConns && connections.length === 0 && !showConnForm && (
            <p className="text-xs text-gray-700">Sem conexões configuradas.</p>
          )}

          {showConnForm ? (
            <form onSubmit={addConnection} className="space-y-2 mt-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={connForm.name} onChange={e => setConnForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome da conexão" required
                  className="col-span-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-indigo-500"
                />
                <select
                  value={connForm.type} onChange={e => setConnForm(f => ({ ...f, type: e.target.value }))}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-indigo-500"
                >
                  {["POSTGRES","MYSQL","REDIS","HTTP"].map(t => <option key={t}>{t}</option>)}
                </select>
                <input
                  value={connForm.connectionString} onChange={e => setConnForm(f => ({ ...f, connectionString: e.target.value }))}
                  placeholder="Connection string" required
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors">
                  Adicionar
                </button>
                <button type="button" onClick={() => setShowConnForm(false)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowConnForm(true)}
              className="text-xs text-indigo-500 hover:text-indigo-400 transition-colors mt-1 flex items-center gap-1"
            >
              + Adicionar conexão
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "", color: "#6366f1" });
  const { subscribe } = useWs();

  const load = useCallback(async () => {
    try { setProjects(await api.get<Project[]>("/api/projects")); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe("refresh", (data) => {
      const ev = data as { resource: string };
      if (ev.resource === "project") load();
    });
  }, [subscribe, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/projects", form);
      toast.success("Projeto criado!");
      setShowForm(false);
      setForm({ name: "", slug: "", description: "", color: "#6366f1" });
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="text-gray-600 text-sm">Carregando projetos...</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Projetos</h1>
          <p className="text-xs text-gray-500 mt-0.5">{projects.length} projetos configurados</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          + Novo projeto
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-gray-900 border border-indigo-500/30 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Novo projeto</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
                required
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Slug</label>
              <input
                value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} required
                placeholder="ile-manager"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Descrição</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Cor do projeto</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="h-9 w-12 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer p-0.5" />
                <span className="text-xs text-gray-500 font-mono">{form.color}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Criar projeto</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors">Cancelar</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map(p => (
          <ProjectCard key={p.id} project={p} onRefresh={load} />
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-16 text-gray-600 text-sm">
          <div className="text-4xl mb-3 opacity-20">⬡</div>
          <p>Nenhum projeto ainda.</p>
          <p className="text-xs mt-1 text-gray-700">Crie o primeiro projeto acima.</p>
        </div>
      )}
    </div>
  );
}
