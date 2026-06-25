import { useEffect, useRef, useState } from "react";
import { useWs } from "../contexts/WsContext";

type AuditEvent = {
  type: "audit_log";
  tool: string;
  outputSummary?: string;
  projectName?: string;
  createdAt: string;
};

type ProactiveEvent = {
  type: "proactive_context";
  project: string;
  query: string;
  anchors: string[];
  memories: { id: string; title: string; type: string; importance: number }[];
  ts: number;
};

type RefreshEvent = {
  type: "refresh";
  resource: string;
  projectSlug?: string;
};

type LiveEvent = {
  id: string;
  type: string;
  payload: AuditEvent | ProactiveEvent | RefreshEvent;
  ts: number;
};

const EVENT_STYLES: Record<string, { bg: string; border: string; label: string; color: string }> = {
  audit_log: {
    bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.2)",
    label: "MCP Tool", color: "#818cf8",
  },
  proactive_context: {
    bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)",
    label: "Proactive Push", color: "#10b981",
  },
  refresh: {
    bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.15)",
    label: "Refresh", color: "#f59e0b",
  },
};

const TOOL_ICONS: Record<string, string> = {
  memory_search: "🔍",
  memory_add: "➕",
  memory_update: "✏️",
  memory_delete: "🗑️",
  brain_session_start: "🚀",
  brain_query: "🎯",
  brain_learn: "🧠",
  brain_time_travel: "⏳",
  anchor_create: "⚡",
  anchor_trigger: "🎣",
  git_extract: "🌿",
  project_context: "📋",
  task_create: "✅",
  task_update: "🔄",
};

export default function SessionMonitorPage() {
  const { subscribe, connected } = useWs();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const counterRef = useRef(0);

  pausedRef.current = paused;

  useEffect(() => {
    const handlers = [
      subscribe("audit_log", (data: any) => {
        if (pausedRef.current) return;
        setEvents(ev => [...ev.slice(-199), {
          id: String(++counterRef.current),
          type: "audit_log",
          payload: { ...data, type: "audit_log" } as AuditEvent,
          ts: Date.now(),
        }]);
      }),
      subscribe("proactive_context", (data: any) => {
        if (pausedRef.current) return;
        setEvents(ev => [...ev.slice(-199), {
          id: String(++counterRef.current),
          type: "proactive_context",
          payload: { ...data, type: "proactive_context" } as ProactiveEvent,
          ts: Date.now(),
        }]);
      }),
      subscribe("refresh", (data: any) => {
        if (pausedRef.current) return;
        setEvents(ev => [...ev.slice(-199), {
          id: String(++counterRef.current),
          type: "refresh",
          payload: { ...data, type: "refresh" } as RefreshEvent,
          ts: Date.now(),
        }]);
      }),
    ];
    return () => handlers.forEach(h => h());
  }, [subscribe]);

  useEffect(() => {
    if (!paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, paused]);

  const filtered = filter === "all" ? events : events.filter(e => e.type === filter);

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderEvent(ev: LiveEvent) {
    const style = EVENT_STYLES[ev.type] ?? { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)", label: ev.type, color: "#94a3b8" };

    if (ev.type === "audit_log") {
      const p = ev.payload as AuditEvent;
      const icon = TOOL_ICONS[p.tool] ?? "🔧";
      return (
        <div key={ev.id} className="flex gap-3 px-4 py-3 rounded-xl border transition-all"
          style={{ background: style.bg, borderColor: style.border }}>
          <span className="text-lg shrink-0 mt-0.5">{icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold font-mono" style={{ color: style.color }}>{p.tool}</span>
              {p.projectName && <span className="text-[10px] text-white/30">{p.projectName}</span>}
              <span className="ml-auto text-[10px] text-white/20 shrink-0">{formatTime(ev.ts)}</span>
            </div>
            {p.outputSummary && (
              <p className="text-xs text-white/50 mt-0.5 truncate">{p.outputSummary}</p>
            )}
          </div>
        </div>
      );
    }

    if (ev.type === "proactive_context") {
      const p = ev.payload as ProactiveEvent;
      return (
        <div key={ev.id} className="flex gap-3 px-4 py-3 rounded-xl border"
          style={{ background: style.bg, borderColor: style.border }}>
          <span className="text-lg shrink-0 mt-0.5">⚡</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: style.color }}>Proactive Push</span>
              <span className="text-[10px] text-white/30">{p.project}</span>
              <span className="ml-auto text-[10px] text-white/20 shrink-0">{formatTime(ev.ts)}</span>
            </div>
            <p className="text-xs text-white/50 mt-0.5">Query: "{p.query.slice(0, 60)}"</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {p.anchors.map((a, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}>
                  {a}
                </span>
              ))}
            </div>
            {p.memories.length > 0 && (
              <p className="text-[10px] text-white/30 mt-1">{p.memories.length} memória(s) injetada(s)</p>
            )}
          </div>
        </div>
      );
    }

    if (ev.type === "refresh") {
      const p = ev.payload as RefreshEvent;
      return (
        <div key={ev.id} className="flex items-center gap-3 px-4 py-2 rounded-xl border"
          style={{ background: style.bg, borderColor: style.border }}>
          <span className="text-sm">🔄</span>
          <span className="text-xs text-white/30">
            {style.label}: <span style={{ color: style.color }}>{p.resource}</span>
            {p.projectSlug && <span className="text-white/20"> ({p.projectSlug})</span>}
          </span>
          <span className="ml-auto text-[10px] text-white/20">{formatTime(ev.ts)}</span>
        </div>
      );
    }

    return null;
  }

  const toolCounts = events.filter(e => e.type === "audit_log").reduce((acc, e) => {
    const tool = (e.payload as AuditEvent).tool;
    acc[tool] = (acc[tool] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              {connected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${connected ? "bg-emerald-500" : "bg-gray-600"}`} />
            </span>
            Session Monitor
          </h1>
          <p className="text-sm text-white/40 mt-0.5">
            {connected ? "Monitorando em tempo real" : "Desconectado"} · {events.length} eventos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="text-sm rounded-xl px-3 py-1.5 border outline-none bg-white/5 border-white/10 text-white/70">
            <option value="all">Todos os eventos</option>
            <option value="audit_log">MCP Tools</option>
            <option value="proactive_context">Proactive Push</option>
            <option value="refresh">Refresh</option>
          </select>
          <button onClick={() => setPaused(p => !p)}
            className="px-3 py-1.5 rounded-xl text-sm border transition-all"
            style={{
              background: paused ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.05)",
              borderColor: paused ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.1)",
              color: paused ? "#f59e0b" : "rgba(255,255,255,0.5)",
            }}>
            {paused ? "Retomar" : "Pausar"}
          </button>
          <button onClick={() => setEvents([])}
            className="px-3 py-1.5 rounded-xl text-sm border border-white/10 text-white/30 hover:text-white/60 transition-colors">
            Limpar
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Event stream */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/20">
              <div className="text-4xl mb-3">👁️</div>
              <p className="text-sm">Aguardando atividade do Claude...</p>
              <p className="text-xs mt-1">Abra o Claude Code e execute algum comando</p>
            </div>
          ) : (
            <>
              {filtered.map(ev => renderEvent(ev))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Stats sidebar */}
        <div className="w-56 shrink-0 space-y-3">
          <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">Top Tools</p>
            {topTools.length === 0 ? (
              <p className="text-xs text-white/20">Sem atividade ainda</p>
            ) : (
              <div className="space-y-2">
                {topTools.map(([tool, count]) => (
                  <div key={tool} className="flex items-center gap-2">
                    <span className="text-sm">{TOOL_ICONS[tool] ?? "🔧"}</span>
                    <span className="text-xs text-white/50 flex-1 truncate font-mono">{tool}</span>
                    <span className="text-xs text-indigo-400 font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">Resumo</p>
            <div className="space-y-1.5">
              {[
                { label: "MCP Calls", value: events.filter(e => e.type === "audit_log").length, color: "#818cf8" },
                { label: "Proactive", value: events.filter(e => e.type === "proactive_context").length, color: "#10b981" },
                { label: "Refreshes", value: events.filter(e => e.type === "refresh").length, color: "#f59e0b" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-white/40">{label}</span>
                  <span className="text-sm font-semibold" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
