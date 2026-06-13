import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useLiveAudit } from "../hooks/useLiveAudit";

type Project = { id: string; name: string; slug: string };

const TOOL_STYLE: Record<string, string> = {
  memory_add:       "bg-emerald-500/20 text-emerald-300 border-emerald-500/20",
  memory_list:      "bg-blue-500/20 text-blue-300 border-blue-500/20",
  memory_search:    "bg-sky-500/20 text-sky-300 border-sky-500/20",
  memory_update:    "bg-amber-500/20 text-amber-300 border-amber-500/20",
  project_context:  "bg-purple-500/20 text-purple-300 border-purple-500/20",
  task_create:      "bg-violet-500/20 text-violet-300 border-violet-500/20",
  task_list:        "bg-violet-400/20 text-violet-200 border-violet-400/20",
  task_update:      "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/20",
  db_query:         "bg-orange-500/20 text-orange-300 border-orange-500/20",
  db_write_request: "bg-red-500/20 text-red-300 border-red-500/20",
  db_write_status:  "bg-rose-400/20 text-rose-300 border-rose-400/20",
  redis_get:        "bg-yellow-500/20 text-yellow-300 border-yellow-500/20",
};

function toolStyle(tool: string) {
  return TOOL_STYLE[tool] ?? "bg-indigo-500/20 text-indigo-300 border-indigo-500/20";
}

function relativeTime(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 5)    return "agora";
  if (diff < 60)   return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

export default function AuditLogPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter,   setFilter]   = useState<string>("");
  const { logs, newIds, isActive } = useLiveAudit(200);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(setProjects).catch(console.error);
  }, []);

  const visible = useMemo(
    () => filter ? logs.filter(l => l.project?.slug === filter) : logs,
    [logs, filter],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl font-bold text-white shrink-0">Atividade em Tempo Real</h1>

          {isActive ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-emerald-400 text-xs font-medium">Claude ativo</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-800/60 border border-gray-700 rounded-full shrink-0">
              <span className="inline-flex rounded-full h-2 w-2 bg-gray-600" />
              <span className="text-gray-500 text-xs">inativo</span>
            </div>
          )}
        </div>

        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="shrink-0 px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value="">Todos os projetos</option>
          {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {/* Log feed */}
      <div className="space-y-1.5">
        {visible.map(l => {
          const isNew = newIds.has(l.id);
          return (
            <div
              key={l.id}
              className={`flex items-start gap-3 px-4 py-2.5 rounded-xl text-xs border transition-colors duration-700 ${
                isNew
                  ? "bg-indigo-900/25 border-indigo-500/35"
                  : "bg-gray-900 border-gray-800"
              }`}
            >
              {/* timestamp */}
              <span className="text-gray-500 font-mono shrink-0 pt-0.5 w-20 text-right tabular-nums">
                {relativeTime(l.createdAt)}
              </span>

              {/* tool badge */}
              <span className={`font-semibold px-2 py-0.5 rounded border text-[11px] shrink-0 ${toolStyle(l.tool)}`}>
                {l.tool}
              </span>

              {/* project */}
              {l.project && (
                <span className="text-gray-500 shrink-0 max-w-[7rem] truncate">{l.project.name}</span>
              )}

              {/* summary */}
              <span className="text-gray-400 flex-1 truncate">{l.outputSummary ?? ""}</span>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {visible.length === 0 && (
        <div className="text-center py-16 text-gray-600 text-sm">
          <div className="text-4xl mb-3 opacity-40">🧠</div>
          <p>Aguardando atividade do Claude...</p>
          <p className="text-xs mt-1 text-gray-700">Atualiza automaticamente a cada 3s</p>
        </div>
      )}
    </div>
  );
}
