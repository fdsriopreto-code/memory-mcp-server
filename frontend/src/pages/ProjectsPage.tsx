import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type Project = {
  id: string; name: string; slug: string; description: string | null; color: string;
  _count: { memories: number; tasks: number; writeRequests: number };
};
type Connection = { id: string; name: string; type: string; isActive: boolean };
type View = "card" | "list";

const COLORS = ["#6366f1","#8b5cf6","#ec4899","#10b981","#3b82f6","#f59e0b","#ef4444","#14b8a6"];

function Avatar({ name, color, size = "md" }: { name: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sz = { sm: "w-7 h-7 text-xs", md: "w-9 h-9 text-sm", lg: "w-12 h-12 text-base" }[size];
  return (
    <div className={`${sz} rounded-xl flex items-center justify-center font-bold shrink-0`}
      style={{ background: `${color}22`, color, border: `1.5px solid ${color}44` }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function ConnectionBadge({ conn, onDelete }: { conn: Connection; onDelete: (id: string) => void }) {
  const colors: Record<string, string> = {
    POSTGRES: "#3b82f6", MYSQL: "#f97316", REDIS: "#ef4444", HTTP: "#8b5cf6",
  };
  const c = colors[conn.type] ?? "#6b7280";
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl group"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
      <span className="text-[10px] font-bold rounded px-1.5 py-0.5"
        style={{ background: `${c}22`, color: c }}>{conn.type}</span>
      <span className="text-xs flex-1 truncate" style={{ color: "var(--text-2)" }}>{conn.name}</span>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conn.isActive ? "bg-emerald-400" : "bg-gray-500"}`} />
      <button onClick={() => onDelete(conn.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: "var(--text-3)" }}>
        <svg fill="none" viewBox="0 0 14 14" className="w-3 h-3"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

function ProjectCardView({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
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
    } catch { /**/ } finally { setLoadingConns(false); }
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

  const total = project._count.memories + project._count.tasks;

  return (
    <div className="rounded-2xl overflow-hidden group transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-card)",
      }}>
      {/* Gradient header */}
      <div className="h-2" style={{ background: `linear-gradient(90deg, ${project.color}, ${project.color}88)` }} />

      <div className="p-5">
        <div className="flex items-start gap-3">
          <Avatar name={project.name} color={project.color} size="md" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base leading-tight" style={{ color: "var(--text-1)" }}>{project.name}</p>
            <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--text-3)" }}>/{project.slug}</p>
            {project.description && (
              <p className="text-xs mt-1.5 leading-relaxed line-clamp-2" style={{ color: "var(--text-2)" }}>{project.description}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Memórias", value: project._count.memories, icon: "◉" },
            { label: "Tasks",    value: project._count.tasks,    icon: "✓" },
            { label: "Writes",   value: project._count.writeRequests, icon: "✎" },
          ].map(s => (
            <div key={s.label} className="rounded-xl py-2 px-3 text-center"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <p className="text-lg font-bold" style={{ color: "var(--text-1)" }}>{s.value}</p>
              <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: "var(--text-3)" }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Activity bar */}
        {total > 0 && (
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
            <div className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (project._count.memories / Math.max(total,1)) * 100)}%`,
                background: `linear-gradient(90deg, ${project.color}, ${project.color}88)`,
              }} />
          </div>
        )}

        {/* Connections toggle */}
        <button onClick={handleExpand}
          className="mt-3 flex items-center gap-1.5 text-xs transition-colors"
          style={{ color: expanded ? project.color : "var(--text-3)" }}>
          <svg fill="none" viewBox="0 0 14 14" className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Conexões</span>
          {connections.length > 0 && (
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
              style={{ background: `${project.color}22`, color: project.color }}>{connections.length}</span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-2 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="pt-3 space-y-2">
            {loadingConns && <p className="text-xs" style={{ color: "var(--text-3)" }}>Carregando...</p>}
            {connections.map(c => <ConnectionBadge key={c.id} conn={c} onDelete={deleteConn} />)}
            {!loadingConns && connections.length === 0 && !showConnForm && (
              <p className="text-xs" style={{ color: "var(--text-3)" }}>Sem conexões configuradas.</p>
            )}
          </div>

          {showConnForm ? (
            <form onSubmit={addConnection} className="space-y-2 mt-2">
              <input value={connForm.name} onChange={e => setConnForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Nome da conexão" required
                className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text-1)" }} />
              <div className="flex gap-2">
                <select value={connForm.type} onChange={e => setConnForm(f => ({ ...f, type: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text-1)" }}>
                  {["POSTGRES","MYSQL","REDIS","HTTP"].map(t => <option key={t}>{t}</option>)}
                </select>
                <input value={connForm.connectionString} onChange={e => setConnForm(f => ({ ...f, connectionString: e.target.value }))}
                  placeholder="Connection string" required
                  className="flex-[2] px-3 py-2 rounded-xl text-xs outline-none"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text-1)" }} />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white"
                  style={{ background: project.color }}>Adicionar</button>
                <button type="button" onClick={() => setShowConnForm(false)}
                  className="px-4 py-1.5 rounded-lg text-xs"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-2)" }}>Cancelar</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowConnForm(true)}
              className="text-xs flex items-center gap-1 mt-1 font-medium"
              style={{ color: project.color }}>
              + Adicionar conexão
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectListRow({ project }: { project: Project }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl group transition-all duration-150 hover:-translate-x-0.5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)" }}>
      <div className="w-1 self-stretch rounded-full" style={{ background: project.color }} />
      <Avatar name={project.name} color={project.color} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{project.name}</p>
        <p className="text-[11px] font-mono" style={{ color: "var(--text-3)" }}>/{project.slug}</p>
      </div>
      {project.description && (
        <p className="text-xs truncate max-w-[200px] hidden lg:block" style={{ color: "var(--text-2)" }}>{project.description}</p>
      )}
      <div className="flex items-center gap-4 shrink-0 ml-auto">
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--text-1)" }}>{project._count.memories}</p>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>mem.</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold" style={{ color: "var(--text-1)" }}>{project._count.tasks}</p>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>tasks</p>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [view,     setView]     = useState<View>(() => (localStorage.getItem("projects-view") as View) ?? "card");
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
      if ((data as { resource: string }).resource === "project") load();
    });
  }, [subscribe, load]);

  function setViewP(v: View) { setView(v); localStorage.setItem("projects-view", v); }

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

  const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500/30";
  const inputStyle = { background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", color: "var(--text-1)" };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando projetos…</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>Projetos</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-3)" }}>
            {projects.length} {projects.length === 1 ? "projeto" : "projetos"} configurados
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden p-0.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            {(["card", "list"] as const).map(v => (
              <button key={v} onClick={() => setViewP(v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={view === v
                  ? { background: "var(--accent-soft)", color: "var(--accent)" }
                  : { color: "var(--text-3)" }}>
                {v === "card"
                  ? <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></svg>
                  : <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                }
              </button>
            ))}
          </div>
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
            <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Novo projeto
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-2xl p-6 space-y-5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-glow)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold" style={{ color: "var(--text-1)" }}>Novo projeto</h2>
            <button onClick={() => setShowForm(false)} style={{ color: "var(--text-3)" }}>
              <svg fill="none" viewBox="0 0 16 16" className="w-4 h-4"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Nome *</label>
                <input value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") }))}
                  required className={inputCls} style={inputStyle} placeholder="Meu Projeto" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Slug *</label>
                <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} required
                  className={`${inputCls} font-mono`} style={inputStyle} placeholder="meu-projeto" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Descrição</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className={inputCls} style={inputStyle} placeholder="Descreva o projeto…" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Cor do projeto</label>
                <div className="flex items-center gap-3">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                      className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                      style={{
                        background: c,
                        outline: form.color === c ? `2px solid ${c}` : "none",
                        outlineOffset: "2px",
                      }} />
                  ))}
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent" title="Custom color" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="px-5 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${form.color}, ${form.color}bb)` }}>
                Criar projeto
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-5 py-2 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", color: "var(--text-2)" }}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Projects grid/list */}
      {view === "card" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {projects.map(p => <ProjectCardView key={p.id} project={p} onRefresh={load} />)}
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map(p => <ProjectListRow key={p.id} project={p} />)}
        </div>
      )}

      {projects.length === 0 && !loading && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <svg fill="none" viewBox="0 0 32 32" className="w-8 h-8" style={{ color: "var(--text-3)" }}>
              <rect x="3" y="7" width="26" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M3 12h26M10 7L8 3M22 7l2-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Nenhum projeto ainda</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Crie o primeiro projeto para começar.</p>
          <button onClick={() => setShowForm(true)}
            className="mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
            + Criar projeto
          </button>
        </div>
      )}
    </div>
  );
}
