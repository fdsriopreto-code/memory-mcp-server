import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../services/api";
import { useWs } from "../contexts/WsContext";

type LogLevel = "log" | "info" | "warn" | "error";

interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  log:   "#9ca3af",
  info:  "#6366f1",
  warn:  "#f59e0b",
  error: "#ef4444",
};

const LEVEL_BG: Record<LogLevel, string> = {
  log:   "#9ca3af18",
  info:  "#6366f118",
  warn:  "#f59e0b18",
  error: "#ef444418",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  log:   "LOG",
  info:  "INFO",
  warn:  "WARN",
  error: "ERR",
};

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour12: false });
}

export default function LogsPage() {
  const [logs,       setLogs]       = useState<LogEntry[]>([]);
  const [filter,     setFilter]     = useState<LogLevel | "all">("all");
  const [search,     setSearch]     = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [newCount,   setNewCount]   = useState(0);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { subscribe, connected } = useWs();

  // Initial load
  useEffect(() => {
    api.get<LogEntry[]>("/api/server-logs?limit=300")
      .then(data => setLogs(data))
      .catch(() => {});
  }, []);

  // Real-time via WS
  useEffect(() => {
    return subscribe("server_log", (data) => {
      const entry = data as LogEntry;
      setLogs(prev => [...prev, entry].slice(-500));
      setNewCount(v => v + 1);
    });
  }, [subscribe]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setNewCount(0);
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
    if (atBottom) setNewCount(0);
  }, []);

  const scrollToBottom = () => {
    setAutoScroll(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setNewCount(0);
  };

  const filtered = logs.filter(l => {
    if (filter !== "all" && l.level !== filter) return false;
    if (search && !l.msg.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    log:   logs.filter(l => l.level === "log").length,
    info:  logs.filter(l => l.level === "info").length,
    warn:  logs.filter(l => l.level === "warn").length,
    error: logs.filter(l => l.level === "error").length,
  };

  return (
    <div className="flex flex-col h-full" style={{ height: "calc(100vh - 48px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Logs do Servidor</h1>
          <p className="text-xs text-gray-500 mt-0.5">stdout/stderr em tempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 tabular-nums">{logs.length} linhas</span>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] border ${
            connected
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-gray-800 border-gray-700 text-gray-600"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-gray-600"}`}/>
            {connected ? "ao vivo" : "offline"}
          </div>
          <button
            onClick={() => setLogs([])}
            className="px-3 py-1 text-[11px] rounded-lg bg-gray-800 text-gray-500 hover:text-red-400 hover:bg-red-950/30 transition-colors border border-gray-700"
          >
            Limpar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3 shrink-0 flex-wrap">
        {(["all", "log", "info", "warn", "error"] as const).map(lvl => {
          const active = filter === lvl;
          const color  = lvl === "all" ? "#6b7280" : LEVEL_COLOR[lvl];
          const cnt    = lvl === "all" ? logs.length : counts[lvl];
          return (
            <button key={lvl} onClick={() => setFilter(lvl)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-mono font-semibold border transition-all"
              style={active
                ? { borderColor: color, background: `${color}22`, color }
                : { borderColor: "#374151", background: "transparent", color: "#6b7280" }
              }>
              {lvl === "all" ? "ALL" : LEVEL_LABEL[lvl]}
              <span className="tabular-nums opacity-70">{cnt}</span>
            </button>
          );
        })}

        <div className="flex-1 min-w-0 ml-auto max-w-xs">
          <input
            type="text"
            placeholder="Filtrar mensagens..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-1 text-xs bg-gray-900 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50"
          />
        </div>
      </div>

      {/* Terminal */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto rounded-xl border border-gray-800"
          style={{ background: "#080c14", fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
        >
          {/* Top bar */}
          <div className="sticky top-0 flex items-center gap-1.5 px-4 py-2 border-b border-gray-800/60"
            style={{ background: "#0d1117" }}>
            <span className="w-3 h-3 rounded-full bg-red-500/60"/>
            <span className="w-3 h-3 rounded-full bg-yellow-500/60"/>
            <span className="w-3 h-3 rounded-full bg-green-500/60"/>
            <span className="text-[10px] text-gray-600 ml-2 font-sans">
              memory-mcp-server — stdout
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-700 text-sm font-sans">
              {logs.length === 0 ? "Aguardando logs..." : "Nenhum log corresponde ao filtro"}
            </div>
          ) : (
            <div className="p-2 space-y-px">
              {filtered.map((l, i) => (
                <div key={i}
                  className="flex items-start gap-3 px-3 py-1 rounded-md group hover:bg-white/[0.02] transition-colors"
                  style={l.level === "error" || l.level === "warn" ? { background: LEVEL_BG[l.level] } : {}}>
                  {/* Timestamp */}
                  <span className="text-[10px] text-gray-700 tabular-nums shrink-0 mt-px pt-[1px]">
                    {fmt(l.ts)}
                  </span>
                  {/* Level badge */}
                  <span
                    className="text-[9px] font-bold tabular-nums shrink-0 mt-px px-1 py-px rounded"
                    style={{ color: LEVEL_COLOR[l.level], background: LEVEL_BG[l.level] }}>
                    {LEVEL_LABEL[l.level]}
                  </span>
                  {/* Message */}
                  <span className="text-[12px] leading-relaxed break-all whitespace-pre-wrap flex-1"
                    style={{ color: LEVEL_COLOR[l.level] }}>
                    {l.msg}
                  </span>
                </div>
              ))}
              <div ref={bottomRef}/>
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {!autoScroll && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg border border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
          >
            {newCount > 0 && (
              <span className="bg-indigo-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                +{newCount}
              </span>
            )}
            ↓ ir para o final
          </button>
        )}
      </div>
    </div>
  );
}
