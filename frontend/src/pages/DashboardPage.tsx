import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useLiveAudit } from "../hooks/useLiveAudit";

// ── Types ─────────────────────────────────────────────────────────────────────
type SystemHealth = {
  circuitBreaker: { state: "CLOSED" | "OPEN" | "HALF_OPEN"; failures: number };
  redis: "connected" | "error" | "unavailable";
  queue: { active: number; waiting: number; completed: number; failed: number };
  tokensToday: number;
  costTodayUsd: number;
  uptime: number;
};

type Stats = {
  totals: { projects: number; memories: number; tasks: number; auditLogs: number; logsToday: number };
  memoriesByType:  { type: string; count: number }[];
  tasksByStatus:   { status: string; count: number }[];
  tasksByPriority: { priority: string; count: number }[];
  topTools:        { tool: string; count: number }[];
  mostAccessed:    { id: string; title: string; type: string; accessCount: number; project: { name: string; color: string } }[];
  activityByDay:   { day: string; count: number }[];
  embeddings:      { estimatedTokens: number; estimatedCostUSD: number; searchCount: number; memoriesWithEmbeddings: number };
};

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_COLOR: Record<string, string> = {
  DECISION:     "#6366f1",
  CONTEXT:      "#3b82f6",
  PATTERN:      "#10b981",
  NOTE:         "#f59e0b",
  BUG_FIX:      "#ef4444",
  ARCHITECTURE: "#8b5cf6",
  BRAIN:        "#ec4899",
};
const STATUS_COLOR: Record<string, string> = {
  OPEN: "#6b7280", IN_PROGRESS: "#3b82f6", DONE: "#10b981", CANCELLED: "#ef4444",
};
const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444", HIGH: "#f59e0b", MEDIUM: "#3b82f6", LOW: "#6b7280",
};

function toolColor(tool: string) {
  if (tool.includes("search"))      return "#3b82f6";
  if (tool.includes("add"))         return "#10b981";
  if (tool.includes("update"))      return "#f59e0b";
  if (tool.startsWith("task_"))     return "#8b5cf6";
  if (tool.startsWith("project_"))  return "#f59e0b";
  if (tool.startsWith("db_"))       return "#ef4444";
  return "#6366f1";
}

function fmtTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 5)    return "agora";
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  return `${Math.floor(diff / 3600)}h`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

// ── Small Components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-5 group transition-all hover:border-white/[0.10]"
      style={{ background: "linear-gradient(135deg, #0d1117 0%, #0a0d18 100%)" }}>
      <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-[0.08] group-hover:opacity-[0.13] transition-opacity blur-2xl"
        style={{ background: accent }} />
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
      <p className="mt-2.5 text-[1.9rem] font-bold tabular-nums leading-none text-white">{value}</p>
      {sub && <p className="mt-1.5 text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>{sub}</p>}
      <div className="absolute bottom-0 left-0 right-0 h-px opacity-50"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}44, transparent)` }} />
    </div>
  );
}

function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-[11px] text-gray-400 w-28 truncate shrink-0">{label.replace(/_/g, " ")}</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[11px] text-gray-500 tabular-nums w-8 text-right shrink-0">{value}</span>
    </div>
  );
}

// ── SVG Bar Chart (14-day activity) ──────────────────────────────────────────
function ActivityChart({ data }: { data: { day: string; count: number }[] }) {
  if (data.length === 0) return (
    <div className="flex items-center justify-center h-full text-gray-700 text-xs">Sem dados</div>
  );

  const max = Math.max(...data.map(d => d.count), 1);
  const W = 100, H = 56;
  const padT = 4, padB = 4;
  const chartH = H - padT - padB;
  const n = data.length;
  const slotW = W / n;
  const barW  = slotW * 0.55;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity=".85" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity=".25" />
        </linearGradient>
        {/* Subtle grid lines */}
        <line id="gl" x1="0" x2={W} stroke="rgba(255,255,255,.04)" strokeWidth=".5" />
      </defs>
      {/* Grid lines at 25%, 50%, 75% */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f}
          x1={0} y1={padT + (1 - f) * chartH}
          x2={W} y2={padT + (1 - f) * chartH}
          stroke="rgba(255,255,255,.04)" strokeWidth=".5"
        />
      ))}
      {/* Bars */}
      {data.map((d, i) => {
        const barH = (d.count / max) * chartH;
        const x = i * slotW + (slotW - barW) / 2;
        const y = padT + chartH - barH;
        return (
          <rect key={i} x={x} y={y} width={barW} height={Math.max(barH, 0.5)}
            rx="1.2" fill="url(#bg)" />
        );
      })}
    </svg>
  );
}

// ── SVG Donut Chart ───────────────────────────────────────────────────────────
function Donut({ slices }: { slices: { value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      <circle cx="50" cy="50" r="38" fill="none" stroke="#1f2937" strokeWidth="14" />
      <text x="50" y="54" textAnchor="middle" fill="#374151" fontSize="9">—</text>
    </svg>
  );

  const R = 38, r = 24, CX = 50, CY = 50;
  let angle = -Math.PI / 2;
  const paths = slices.filter(s => s.value > 0).map(sl => {
    const sweep = (sl.value / total) * 2 * Math.PI * 0.98; // 0.98 = small gap
    const gapAngle = (2 * Math.PI * 0.02) / slices.length;
    const a1 = angle, a2 = angle + sweep;
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
    const x2 = CX + R * Math.cos(a2), y2 = CY + R * Math.sin(a2);
    const ix1 = CX + r * Math.cos(a2), iy1 = CY + r * Math.sin(a2);
    const ix2 = CX + r * Math.cos(a1), iy2 = CY + r * Math.sin(a1);
    const lg = sweep > Math.PI ? 1 : 0;
    const d = `M${x1},${y1} A${R},${R},0,${lg},1,${x2},${y2} L${ix1},${iy1} A${r},${r},0,${lg},0,${ix2},${iy2}Z`;
    angle += sweep + gapAngle;
    return { d, color: sl.color };
  });

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full">
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity=".9" />)}
      <text x={CX} y={CY - 4} textAnchor="middle" fill="white" fontSize="13" fontWeight="bold"
        style={{ fontFamily: "monospace" }}>
        {fmtNum(total)}
      </text>
      <text x={CX} y={CY + 9} textAnchor="middle" fill="#6b7280" fontSize="5.5">memórias</text>
    </svg>
  );
}

// ── Fill missing days ─────────────────────────────────────────────────────────
function fillDays(raw: { day: string; count: number }[], days = 14) {
  const map = new Map(raw.map(d => [d.day, d.count]));
  const result: { day: string; count: number; label: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    result.push({
      day: key,
      count: map.get(key) ?? 0,
      label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    });
  }
  return result;
}

// ── System Observatory ────────────────────────────────────────────────────────
function fmtUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function SystemObservatory() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [err,    setErr]    = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<SystemHealth>("/api/system/health");
      setHealth(data); setErr(false);
    } catch { setErr(true); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const cb = health?.circuitBreaker;
  const cbColor = cb?.state === "CLOSED" ? "#10b981" : cb?.state === "OPEN" ? "#ef4444" : "#f59e0b";
  const cbLabel = cb?.state ?? "—";

  const redisColor = health?.redis === "connected" ? "#10b981" : health?.redis === "error" ? "#ef4444" : "#6b7280";
  const redisLabel = health?.redis ?? "—";

  return (
    <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-semibold text-white">🔭 System Observatory</p>
          <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
            Estado em tempo real do sistema · refresh 30s
          </p>
        </div>
        <button onClick={load}
          className="text-xs px-3 py-1.5 rounded-xl border transition-all"
          style={{ background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.2)", color: "rgba(165,180,252,0.8)" }}>
          ↻
        </button>
      </div>

      {err && (
        <p className="text-xs text-center py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
          Não foi possível carregar — sistema pode não ter Redis/fila.
        </p>
      )}

      {!err && (
        <div className="grid grid-cols-3 gap-3">
          {/* Circuit Breaker */}
          <div className="rounded-xl p-4 border border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              Circuit Breaker
            </p>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cbColor }} />
              <span className="text-sm font-bold" style={{ color: cbColor }}>{cbLabel}</span>
            </div>
            {health?.circuitBreaker && (
              <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
                {health.circuitBreaker.failures} falhas
              </p>
            )}
          </div>

          {/* Redis */}
          <div className="rounded-xl p-4 border border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              Redis
            </p>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: redisColor }} />
              <span className="text-sm font-bold" style={{ color: redisColor }}>{redisLabel}</span>
            </div>
          </div>

          {/* Queue */}
          <div className="rounded-xl p-4 border border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              Queue
            </p>
            {health?.queue ? (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: "#6366f1" }}>Ativo</span>
                  <span className="text-[11px] font-bold" style={{ color: "#6366f1" }}>{health.queue.active}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Aguardando</span>
                  <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{health.queue.waiting}</span>
                </div>
              </div>
            ) : <span className="text-sm text-white/20">—</span>}
          </div>

          {/* Tokens today */}
          <div className="rounded-xl p-4 border border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              Tokens Hoje
            </p>
            <p className="text-lg font-bold text-white tabular-nums">
              {health?.tokensToday != null ? fmtNum(health.tokensToday) : "—"}
            </p>
          </div>

          {/* Cost today */}
          <div className="rounded-xl p-4 border border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              Custo Hoje
            </p>
            <p className="text-lg font-bold tabular-nums" style={{ color: "#10b981" }}>
              {health?.costTodayUsd != null
                ? (health.costTodayUsd < 0.001 ? "< $0.001" : `$${health.costTodayUsd.toFixed(4)}`)
                : "—"}
            </p>
          </div>

          {/* Uptime */}
          <div className="rounded-xl p-4 border border-white/[0.05]" style={{ background: "rgba(255,255,255,0.02)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
              Uptime
            </p>
            <p className="text-lg font-bold text-white tabular-nums">
              {health?.uptime != null ? fmtUptime(health.uptime) : "—"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const { logs, isActive } = useLiveAudit(10);

  const load = useCallback(async () => {
    try {
      const data = await api.get<Stats>("/api/stats");
      setStats(data); setUpdatedAt(new Date());
    } catch { /* silently */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const filledDays = useMemo(() => fillDays(stats?.activityByDay ?? []), [stats]);
  const donutSlices = useMemo(() =>
    (stats?.memoriesByType ?? []).map(m => ({ value: m.count, color: TYPE_COLOR[m.type] ?? "#6b7280" })),
    [stats]);

  const topTool = stats?.topTools[0]?.count ?? 1;
  const topStatus = Math.max(...(stats?.tasksByStatus.map(t => t.count) ?? [1]));
  const topPrio   = Math.max(...(stats?.tasksByPriority.map(t => t.count) ?? [1]));

  if (loading) return (
    <div className="flex items-center justify-center h-72">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <span className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin inline-block" />
        Carregando dashboard…
      </div>
    </div>
  );

  if (!stats) return (
    <div className="text-center py-24 text-gray-600 text-sm">Erro ao carregar dados.</div>
  );

  const costStr = stats.embeddings.estimatedCostUSD < 0.001
    ? "< $0.001" : `$${stats.embeddings.estimatedCostUSD.toFixed(4)}`;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.25)" }}>
            Atualizado às {updatedAt.toLocaleTimeString("pt-BR")} · auto-refresh 30s
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-4 py-2 text-xs rounded-xl border transition-all"
          style={{ background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.2)", color: "rgba(165,180,252,0.8)" }}
          onMouseOver={e => (e.currentTarget.style.background = "rgba(99,102,241,0.15)")}
          onMouseOut={e  => (e.currentTarget.style.background = "rgba(99,102,241,0.08)")}>
          <svg fill="none" viewBox="0 0 16 16" className="w-3.5 h-3.5"><path d="M13.5 8A5.5 5.5 0 012.5 8a5.5 5.5 0 019.18-4.09M13.5 2.5V6h-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Atualizar
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="Projetos"   value={stats.totals.projects}  accent="#6366f1" />
        <StatCard label="Memórias"   value={stats.totals.memories}  sub={`~${fmtNum(stats.embeddings.estimatedTokens)} tokens`} accent="#10b981" />
        <StatCard label="Tasks"      value={stats.totals.tasks}     accent="#3b82f6" />
        <StatCard label="Logs hoje"  value={stats.totals.logsToday} sub={`${fmtNum(stats.totals.auditLogs)} total`} accent="#f59e0b" />
        <StatCard label="Embed cost" value={costStr}                sub="text-embedding-3-small" accent="#ec4899" />
      </div>

      {/* ── Activity Chart + Donut ── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Activity */}
        <div className="col-span-2 rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-white">Atividade — 14 dias</p>
              <p className="text-[11px] text-gray-500">Chamadas de ferramentas por dia</p>
            </div>
            {isActive ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/25 rounded-full">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-emerald-400 text-[10px] font-medium">Claude ativo</span>
              </div>
            ) : (
              <span className="text-[10px] text-gray-700 px-2 py-1 border border-gray-800 rounded-full">inativo</span>
            )}
          </div>

          <div className="h-28">
            <ActivityChart data={filledDays} />
          </div>

          {/* X-axis labels */}
          <div className="flex justify-between mt-2 px-1">
            {[0, 3, 6, 9, 13].map(i => (
              <span key={i} className="text-[9px] text-gray-700 font-mono">
                {filledDays[i]?.label ?? ""}
              </span>
            ))}
          </div>
        </div>

        {/* Donut */}
        <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
          <p className="text-sm font-semibold text-white">Tipos de Memória</p>
          <p className="text-[11px] text-gray-500 mb-4">Distribuição por categoria</p>
          <div className="flex items-center gap-4">
            <div className="w-[90px] h-[90px] shrink-0">
              <Donut slices={donutSlices} />
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              {stats.memoriesByType.map(m => (
                <div key={m.type} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: TYPE_COLOR[m.type] ?? "#6b7280" }} />
                  <span className="text-[10px] text-gray-400 truncate flex-1">
                    {m.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-gray-500 tabular-nums shrink-0">{m.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tools + Tasks ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Top Tools */}
        <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
          <p className="text-sm font-semibold text-white tracking-tight">Ferramentas Mais Usadas</p>
          <p className="text-[11px] mb-4 mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Total de chamadas por ferramenta</p>
          <div className="space-y-0.5">
            {stats.topTools.map(t => (
              <HBar key={t.tool} label={t.tool} value={t.count} max={topTool} color={toolColor(t.tool)} />
            ))}
            {stats.topTools.length === 0 && (
              <p className="text-xs text-gray-700 py-4 text-center">Sem dados ainda</p>
            )}
          </div>
        </div>

        {/* Task Distribution */}
        <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
          <p className="text-sm font-semibold text-white tracking-tight">Tasks</p>
          <p className="text-[11px] mb-4 mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>Por status e prioridade</p>

          <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">Status</p>
          <div className="space-y-0.5 mb-5">
            {stats.tasksByStatus.map(t => (
              <HBar key={t.status} label={t.status} value={t.count} max={topStatus} color={STATUS_COLOR[t.status] ?? "#6b7280"} />
            ))}
          </div>

          <p className="text-[9px] font-bold text-gray-600 uppercase tracking-widest mb-2">Prioridade</p>
          <div className="space-y-0.5">
            {stats.tasksByPriority.map(t => (
              <HBar key={t.priority} label={t.priority} value={t.count} max={topPrio} color={PRIORITY_COLOR[t.priority] ?? "#6b7280"} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Most Accessed + Live Feed ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Most accessed memories */}
        <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
          <p className="text-sm font-semibold text-white tracking-tight">Memórias Mais Acessadas</p>
          <p className="text-[11px] mb-4 mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>O Claude busca estas com mais frequência</p>

          {stats.mostAccessed.length === 0 ? (
            <p className="text-xs text-gray-700 py-6 text-center">
              Nenhuma memória acessada via busca ainda.<br />
              Use memory_search para começar.
            </p>
          ) : (
            <div className="space-y-3">
              {stats.mostAccessed.map((m, i) => (
                <div key={m.id} className="flex items-start gap-3 group">
                  <span className="text-xs text-gray-700 tabular-nums w-4 shrink-0 mt-0.5 font-mono">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate group-hover:text-indigo-300 transition-colors">
                      {m.title}
                    </p>
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {m.project.name} ·{" "}
                      <span style={{ color: TYPE_COLOR[m.type] ?? "#6b7280" }}>
                        {m.type.replace(/_/g, " ")}
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="text-xs font-bold text-amber-400 tabular-nums">{m.accessCount}</span>
                    <p className="text-[9px] text-gray-600">acessos</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live feed */}
        <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-white">Atividade Recente</p>
              <p className="text-[11px] text-gray-500">Tempo real via WebSocket</p>
            </div>
            {isActive ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-emerald-400 text-[10px]">ao vivo</span>
              </div>
            ) : (
              <span className="text-[10px] text-gray-700">aguardando…</span>
            )}
          </div>
          <div className="space-y-2.5">
            {logs.slice(0, 9).map(l => (
              <div key={l.id} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600 font-mono shrink-0 w-10 text-right">
                  {fmtTime(l.createdAt)}
                </span>
                <span
                  className="shrink-0 px-1.5 py-px rounded text-[10px] font-semibold"
                  style={{ background: `${toolColor(l.tool)}22`, color: toolColor(l.tool) }}
                >
                  {l.tool.replace(/_/g, "_").split("_").slice(0, 2).join("_")}
                </span>
                <span className="text-[11px] text-gray-500 truncate min-w-0">
                  {l.project?.name ?? "—"}
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-xs text-gray-700 py-6 text-center">Sem atividade recente</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Embedding Cost Detail ── */}
      <div className="rounded-2xl border border-white/[0.06] p-5" style={{ background: "linear-gradient(135deg,#0d1117,#0a0d18)" }}>
        <div className="flex items-center gap-2 mb-4">
          <p className="text-sm font-semibold text-white">Uso de Embeddings OpenAI</p>
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-500">
            text-embedding-3-small
          </span>
        </div>
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[
            { label: "Memórias indexadas", value: fmtNum(stats.embeddings.memoriesWithEmbeddings) },
            { label: "Buscas semânticas",  value: fmtNum(stats.embeddings.searchCount) },
            { label: "Tokens estimados",   value: fmtNum(stats.embeddings.estimatedTokens) },
            { label: "Custo estimado (USD)", value: costStr, highlight: true },
          ].map(c => (
            <div key={c.label} className="text-center px-4 py-3 rounded-xl bg-gray-950/50 border border-gray-800">
              <p className={`text-2xl font-bold tabular-nums ${c.highlight ? "text-emerald-400" : "text-white"}`}>
                {c.value}
              </p>
              <p className="text-[10px] text-gray-600 mt-1">{c.label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-700 text-center leading-relaxed">
          Estimativa conservadora: ~150 tokens/memória + ~15 tokens/busca · $0.02/1M tokens<br/>
          Redis cache de 7 dias evita re-embedding de conteúdos iguais
        </p>
      </div>

      {/* ── System Observatory ── */}
      <SystemObservatory />

    </div>
  );
}
