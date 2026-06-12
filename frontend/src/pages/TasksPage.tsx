import { useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";

type Task = { id: string; title: string; description: string | null; status: string; priority: string; createdAt: string };
type Project = { id: string; name: string; slug: string };

const PRIORITY_STYLE: Record<string, string> = {
  LOW:      "text-gray-500",
  MEDIUM:   "text-blue-400",
  HIGH:     "text-orange-400",
  CRITICAL: "text-red-400",
};

export default function TasksPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { api.get<Project[]>("/api/projects").then(setProjects).catch(console.error); }, []);

  useEffect(() => {
    if (!project) { setTasks([]); return; }
    setLoading(true);
    api.get<Task[]>(`/api/projects/${project}/tasks`)
      .then(setTasks).catch(() => toast.error("Erro")).finally(() => setLoading(false));
  }, [project]);

  async function updateStatus(id: string, status: string) {
    await api.patch(`/api/tasks/${id}`, { status });
    setTasks(t => t.map(x => x.id === id ? { ...x, status } : x));
  }

  async function deleteTask(id: string) {
    if (!confirm("Remover task?")) return;
    await api.delete(`/api/tasks/${id}`);
    setTasks(t => t.filter(x => x.id !== id));
    toast.success("Removida");
  }

  const grouped = {
    OPEN:        tasks.filter(t => t.status === "OPEN"),
    IN_PROGRESS: tasks.filter(t => t.status === "IN_PROGRESS"),
    DONE:        tasks.filter(t => t.status === "DONE"),
    CANCELLED:   tasks.filter(t => t.status === "CANCELLED"),
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Tasks</h1>
        <select value={project} onChange={e => setProject(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500">
          <option value="">Selecionar projeto...</option>
          {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {loading && <div className="text-gray-400 text-sm">Carregando...</div>}

      {project && !loading && (
        <div className="grid grid-cols-2 gap-4">
          {(["OPEN","IN_PROGRESS","DONE","CANCELLED"] as const).map(status => (
            <div key={status} className="space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">{status.replace("_"," ")} ({grouped[status].length})</p>
              {grouped[status].map(t => (
                <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-white font-medium leading-tight">{t.title}</p>
                    <button onClick={() => deleteTask(t.id)} className="text-gray-600 hover:text-red-400 text-xs shrink-0">✕</button>
                  </div>
                  {t.description && <p className="text-xs text-gray-400">{t.description}</p>}
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
                    <select
                      value={t.status}
                      onChange={e => updateStatus(t.id, e.target.value)}
                      className="ml-auto text-[10px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 focus:outline-none"
                    >
                      {["OPEN","IN_PROGRESS","DONE","CANCELLED"].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!project && <div className="text-center py-10 text-gray-500 text-sm">Selecione um projeto.</div>}
    </div>
  );
}
