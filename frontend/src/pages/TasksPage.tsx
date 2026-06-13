import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type Task = {
  id: string; title: string; description: string | null;
  status: string; priority: string; createdAt: string;
};
type Project = { id: string; name: string; slug: string };

const STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
type Status = typeof STATUSES[number];

const STATUS_META: Record<Status, { label: string; color: string; text: string; border: string }> = {
  OPEN:        { label: "Aberto",       color: "bg-gray-500/10",   text: "text-gray-400",   border: "border-gray-800" },
  IN_PROGRESS: { label: "Em Progresso", color: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-800/40" },
  DONE:        { label: "Concluído",    color: "bg-emerald-500/10",text: "text-emerald-400",border: "border-emerald-800/40" },
  CANCELLED:   { label: "Cancelado",    color: "bg-red-500/10",    text: "text-red-400",    border: "border-red-900/40" },
};

const PRIORITY_META: Record<string, { color: string; dot: string }> = {
  LOW:      { color: "text-gray-500",   dot: "#6b7280" },
  MEDIUM:   { color: "text-blue-400",   dot: "#3b82f6" },
  HIGH:     { color: "text-orange-400", dot: "#f97316" },
  CRITICAL: { color: "text-red-400",    dot: "#ef4444" },
};

function relTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function TaskCard({
  task, onStatusChange, onDelete,
}: {
  task: Task;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pmeta = PRIORITY_META[task.priority] ?? PRIORITY_META.MEDIUM;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors group">
      <div className="flex items-start gap-0">
        {/* Priority accent bar */}
        <div className="w-0.5 self-stretch shrink-0" style={{ background: pmeta.dot }} />

        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-1.5">
            <p
              className="text-sm text-white font-medium leading-snug cursor-pointer hover:text-indigo-300 transition-colors"
              onClick={() => setOpen(v => !v)}
            >{task.title}</p>
            <button
              onClick={() => onDelete(task.id)}
              className="text-gray-700 hover:text-red-400 transition-colors text-xs shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
            >✕</button>
          </div>

          {task.description && !open && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
          )}
          {open && task.description && (
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{task.description}</p>
          )}

          <div className="flex items-center justify-between mt-2 gap-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold ${pmeta.color}`}>{task.priority}</span>
              <span className="text-[10px] text-gray-700">{relTime(task.createdAt)}</span>
            </div>
            <select
              value={task.status}
              onChange={e => onStatusChange(task.id, e.target.value)}
              onClick={e => e.stopPropagation()}
              className="text-[10px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 focus:outline-none cursor-pointer"
            >
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [loading,  setLoading]  = useState(false);
  const { subscribe } = useWs();

  useEffect(() => { api.get<Project[]>("/api/projects").then(setProjects).catch(console.error); }, []);

  const loadTasks = useCallback(() => {
    if (!project) { setTasks([]); return; }
    setLoading(true);
    api.get<Task[]>(`/api/projects/${project}/tasks`)
      .then(setTasks).catch(() => toast.error("Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as { tool: string; project?: { slug: string } };
      if (log.tool.startsWith("task_") && log.project?.slug === project) {
        loadTasks();
      }
    });
  }, [subscribe, project, loadTasks]);

  useEffect(() => {
    return subscribe("refresh", (data) => {
      const ev = data as { resource: string };
      if (ev.resource === "task") loadTasks();
    });
  }, [subscribe, loadTasks]);

  async function updateStatus(id: string, status: string) {
    setTasks(t => t.map(x => x.id === id ? { ...x, status } : x));
    await api.patch(`/api/tasks/${id}`, { status }).catch(() => loadTasks());
  }

  async function deleteTask(id: string) {
    if (!confirm("Remover task?")) return;
    setTasks(t => t.filter(x => x.id !== id));
    await api.delete(`/api/tasks/${id}`).catch(() => loadTasks());
    toast.success("Removida");
  }

  const grouped = STATUSES.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s);
    return acc;
  }, {} as Record<Status, Task[]>);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Tasks</h1>
          {project && (
            <p className="text-xs text-gray-500 mt-0.5">{tasks.length} tasks no projeto</p>
          )}
        </div>
        <select
          value={project} onChange={e => setProject(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">Selecionar projeto...</option>
          {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {loading && <div className="text-gray-500 text-sm">Carregando...</div>}

      {project && !loading && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-4 gap-2">
            {STATUSES.map(s => {
              const meta = STATUS_META[s];
              const count = grouped[s].length;
              return (
                <div key={s} className={`rounded-xl border px-3 py-2.5 ${meta.color} ${meta.border}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${meta.text}`}>{meta.label}</p>
                  <p className="text-xl font-bold text-white mt-0.5">{count}</p>
                </div>
              );
            })}
          </div>

          {/* Kanban board */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {STATUSES.map(s => {
              const meta = STATUS_META[s];
              return (
                <div key={s} className="min-w-0">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.text}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-gray-600">({grouped[s].length})</span>
                  </div>
                  <div className="space-y-2">
                    {grouped[s].map(t => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onStatusChange={updateStatus}
                        onDelete={deleteTask}
                      />
                    ))}
                    {grouped[s].length === 0 && (
                      <div className={`rounded-xl border border-dashed ${meta.border} px-3 py-4 text-center`}>
                        <p className="text-[11px] text-gray-700">Vazio</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!project && (
        <div className="text-center py-12 text-gray-600 text-sm">
          <div className="text-4xl mb-3 opacity-20">✓</div>
          Selecione um projeto para ver as tasks.
        </div>
      )}
    </div>
  );
}
