import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type Task = {
  id: string; title: string; description: string | null;
  status: string; priority: string; createdAt: string;
};
type Project = { id: string; name: string; slug: string };
type ViewMode = "board" | "list";

const STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
type Status = typeof STATUSES[number];

const STATUS_META: Record<Status, { label: string; color: string; dot: string; icon: string }> = {
  OPEN:        { label: "Aberto",       color: "rgba(99,102,241,0.1)",  dot: "#6366f1", icon: "○" },
  IN_PROGRESS: { label: "Em Progresso", color: "rgba(245,158,11,0.1)",  dot: "#f59e0b", icon: "◑" },
  DONE:        { label: "Concluído",    color: "rgba(16,185,129,0.1)",  dot: "#10b981", icon: "●" },
  CANCELLED:   { label: "Cancelado",    color: "rgba(239,68,68,0.08)",  dot: "#ef4444", icon: "✕" },
};

const PRIORITY_META: Record<string, { label: string; color: string; bg: string }> = {
  LOW:      { label: "Baixa",    color: "#64748b", bg: "rgba(100,116,139,0.1)" },
  MEDIUM:   { label: "Média",    color: "#3b82f6", bg: "rgba(59,130,246,0.1)"  },
  HIGH:     { label: "Alta",     color: "#f97316", bg: "rgba(249,115,22,0.1)"  },
  CRITICAL: { label: "Crítica",  color: "#ef4444", bg: "rgba(239,68,68,0.12)"  },
};

function relTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function BoardCard({ task, onStatusChange, onDelete }: {
  task: Task; onStatusChange: (id: string, status: string) => void; onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pm = PRIORITY_META[task.priority] ?? PRIORITY_META.MEDIUM;
  const sm = STATUS_META[task.status as Status] ?? STATUS_META.OPEN;

  return (
    <div className="rounded-2xl overflow-hidden group transition-all duration-150 hover:-translate-y-0.5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-card)",
      }}>
      {/* Priority line */}
      <div className="h-0.5" style={{ background: pm.color }} />

      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug cursor-pointer flex-1"
            style={{ color: "var(--text-1)" }}
            onClick={() => setOpen(v => !v)}>
            {task.title}
          </p>
          <button onClick={() => onDelete(task.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded-lg hover:bg-red-500/10"
            style={{ color: "var(--text-3)" }}>
            <svg fill="none" viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {task.description && (
          <p className={`text-xs mt-1.5 leading-relaxed ${open ? "" : "line-clamp-2"}`}
            style={{ color: "var(--text-2)" }} onClick={() => setOpen(v => !v)}>
            {task.description}
          </p>
        )}

        <div className="flex items-center justify-between mt-3 gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: pm.bg, color: pm.color }}>
              {pm.label}
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-3)" }}>{relTime(task.createdAt)}</span>
          </div>
          <select value={task.status} onChange={e => onStatusChange(task.id, e.target.value)}
            onClick={e => e.stopPropagation()}
            className="text-[10px] rounded-lg px-2 py-1 outline-none cursor-pointer"
            style={{ background: sm.color, color: sm.dot, border: `1px solid ${sm.dot}44` }}>
            {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function ListRow({ task, onStatusChange, onDelete }: {
  task: Task; onStatusChange: (id: string, status: string) => void; onDelete: (id: string) => void;
}) {
  const pm = PRIORITY_META[task.priority] ?? PRIORITY_META.MEDIUM;
  const sm = STATUS_META[task.status as Status] ?? STATUS_META.OPEN;

  return (
    <div className="flex items-center gap-3 px-4 py-3 group transition-all"
      style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-sm shrink-0" style={{ color: sm.dot }}>{sm.icon}</span>
      <p className="flex-1 text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>{task.title}</p>
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
        style={{ background: pm.bg, color: pm.color }}>{pm.label}</span>
      <select value={task.status} onChange={e => onStatusChange(task.id, e.target.value)}
        className="text-[10px] rounded-lg px-2 py-1 outline-none cursor-pointer shrink-0"
        style={{ background: sm.color, color: sm.dot, border: `1px solid ${sm.dot}44` }}>
        {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>
      <span className="text-[10px] w-10 text-right shrink-0" style={{ color: "var(--text-3)" }}>{relTime(task.createdAt)}</span>
      <button onClick={() => onDelete(task.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-500/10 shrink-0"
        style={{ color: "var(--text-3)" }}>
        <svg fill="none" viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

export default function TasksPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [view,     setView]     = useState<ViewMode>(() => (localStorage.getItem("tasks-view") as ViewMode) ?? "board");
  const [statusFilter, setStatusFilter] = useState<string>("");
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
      if (log.tool.startsWith("task_") && log.project?.slug === project) loadTasks();
    });
  }, [subscribe, project, loadTasks]);

  useEffect(() => {
    return subscribe("refresh", (data) => {
      if ((data as { resource: string }).resource === "task") loadTasks();
    });
  }, [subscribe, loadTasks]);

  function setViewP(v: ViewMode) { setView(v); localStorage.setItem("tasks-view", v); }

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

  const filteredList = statusFilter ? tasks.filter(t => t.status === statusFilter) : tasks;

  const totalOpen = (grouped.OPEN?.length ?? 0) + (grouped.IN_PROGRESS?.length ?? 0);
  const totalDone = grouped.DONE?.length ?? 0;
  const progress  = tasks.length > 0 ? Math.round((totalDone / tasks.length) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>Tasks</h1>
          {project && (
            <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>
              {tasks.length} tasks · {totalOpen} abertas · {progress}% concluídas
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={project} onChange={e => { setProject(e.target.value); setStatusFilter(""); }}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-1)" }}>
            <option value="">Selecionar projeto…</option>
            {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
          </select>

          {project && (
            <div className="flex rounded-xl overflow-hidden p-0.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              {(["board","list"] as const).map(v => (
                <button key={v} onClick={() => setViewP(v)}
                  className="px-3 py-1.5 rounded-lg transition-all"
                  style={view === v ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-3)" }}>
                  {v === "board"
                    ? <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><rect x="1" y="1" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="6" y="1" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="1" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.4"/></svg>
                    : <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  }
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      )}

      {project && !loading && (
        <>
          {/* Stats strip */}
          <div className="grid grid-cols-4 gap-2">
            {STATUSES.map(s => {
              const meta = STATUS_META[s];
              const count = grouped[s].length;
              return (
                <div key={s} className="rounded-2xl px-4 py-3 cursor-pointer transition-all"
                  style={{
                    background: statusFilter === s ? meta.color : "var(--bg-card)",
                    border: `1px solid ${statusFilter === s ? meta.dot + "44" : "var(--border)"}`,
                    boxShadow: "var(--shadow-card)",
                  }}
                  onClick={() => setStatusFilter(view === "list" ? (statusFilter === s ? "" : s) : "")}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs" style={{ color: meta.dot }}>{meta.icon}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.dot }}>{meta.label}</span>
                  </div>
                  <p className="text-2xl font-bold" style={{ color: "var(--text-1)" }}>{count}</p>
                  {tasks.length > 0 && (
                    <div className="mt-2 h-0.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${(count / tasks.length) * 100}%`, background: meta.dot }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          {tasks.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progress}%`, background: "linear-gradient(90deg, #6366f1, #10b981)" }} />
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: progress === 100 ? "#10b981" : "var(--text-3)" }}>
                {progress}%
              </span>
            </div>
          )}

          {/* Board view */}
          {view === "board" && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {STATUSES.map(s => {
                const meta = STATUS_META[s];
                return (
                  <div key={s}>
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <span className="text-sm" style={{ color: meta.dot }}>{meta.icon}</span>
                      <span className="text-xs font-bold" style={{ color: meta.dot }}>{meta.label}</span>
                      <span className="ml-auto text-[10px] rounded-full px-1.5 py-0.5 font-bold"
                        style={{ background: meta.color, color: meta.dot }}>
                        {grouped[s].length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {grouped[s].map(t => (
                        <BoardCard key={t.id} task={t} onStatusChange={updateStatus} onDelete={deleteTask} />
                      ))}
                      {grouped[s].length === 0 && (
                        <div className="rounded-2xl border-dashed border-2 py-6 text-center"
                          style={{ borderColor: "var(--border)" }}>
                          <p className="text-[11px]" style={{ color: "var(--text-4)" }}>Vazio</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* List view */}
          {view === "list" && (
            <div className="rounded-2xl overflow-hidden"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-3 px-4 py-2.5"
                style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                <div className="w-4 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest flex-1" style={{ color: "var(--text-3)" }}>Título</span>
                <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: "var(--text-3)" }}>Prioridade</span>
                <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: "var(--text-3)" }}>Status</span>
                <span className="text-[10px] font-bold uppercase tracking-widest w-10 text-right shrink-0" style={{ color: "var(--text-3)" }}>Há</span>
                <div className="w-6 shrink-0" />
              </div>
              {filteredList.length === 0 && (
                <div className="py-8 text-center" style={{ color: "var(--text-3)" }}>
                  <p className="text-sm">Nenhuma task{statusFilter ? " com este status" : ""}.</p>
                </div>
              )}
              {filteredList.map(t => (
                <ListRow key={t.id} task={t} onStatusChange={updateStatus} onDelete={deleteTask} />
              ))}
            </div>
          )}
        </>
      )}

      {!project && !loading && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <svg fill="none" viewBox="0 0 32 32" className="w-8 h-8" style={{ color: "var(--text-3)" }}>
              <path d="M6 8h20M6 14h14M6 20h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="25" cy="23" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M23 23l1.5 1.5L27 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Selecione um projeto</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Escolha um projeto para ver as tasks.</p>
        </div>
      )}
    </div>
  );
}
