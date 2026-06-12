import { useEffect, useState } from "react";
import { api } from "../services/api";

type Log = { id: string; tool: string; input: unknown; outputSummary: string | null; createdAt: string; project: { name: string } | null };
type Project = { id: string; name: string; slug: string };

export default function AuditLogPage() {
  const [logs,     setLogs]     = useState<Log[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [loading,  setLoading]  = useState(true);

  useEffect(() => { api.get<Project[]>("/api/projects").then(setProjects).catch(console.error); }, []);

  useEffect(() => {
    setLoading(true);
    api.get<Log[]>(`/api/audit-logs${project ? `?projectSlug=${project}` : ""}`)
      .then(setLogs).catch(console.error).finally(() => setLoading(false));
  }, [project]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Audit Log</h1>
        <select value={project} onChange={e => setProject(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500">
          <option value="">Todos os projetos</option>
          {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {loading && <div className="text-gray-400 text-sm">Carregando...</div>}

      <div className="space-y-1.5">
        {logs.map(l => (
          <div key={l.id} className="flex items-start gap-3 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-xs">
            <span className="text-gray-500 font-mono shrink-0 pt-0.5 w-36 truncate">
              {new Date(l.createdAt).toLocaleString("pt-BR")}
            </span>
            <span className="bg-indigo-500/20 text-indigo-300 font-bold px-1.5 py-0.5 rounded shrink-0">{l.tool}</span>
            <span className="text-gray-400 shrink-0">{l.project?.name ?? "—"}</span>
            <span className="text-gray-400 flex-1 truncate">{l.outputSummary ?? ""}</span>
          </div>
        ))}
      </div>

      {!loading && logs.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-sm">Nenhum registro.</div>
      )}
    </div>
  );
}
