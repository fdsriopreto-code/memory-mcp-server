import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";

type Project = { id: string; name: string; slug: string; color: string };

type TimelineData = {
  project: { name: string; slug: string; color: string };
  period: { days: number; since: string };
  totals: { now: number; atStart: number; created: number };
  createdByDay: { day: string; type: string; count: number }[];
  growthByWeek: { week: string; count: number }[];
  milestones: { id: string; title: string; type: string; date: string }[];
  accessByDay: { day: string; count: number }[];
};

const TYPE_COLORS: Record<string, string> = {
  DECISION:     "#6366f1",
  CONTEXT:      "#3b82f6",
  PATTERN:      "#10b981",
  NOTE:         "#f59e0b",
  BUG_FIX:      "#ef4444",
  ARCHITECTURE: "#8b5cf6",
  BRAIN:        "#ec4899",
};

const PERIODS = [
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "180 dias", days: 180 },
  { label: "1 ano", days: 365 },
];

export default function TimelinePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState("");
  const [days, setDays] = useState(90);
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    api.get<TimelineData>(`/api/projects/${project}/timeline?days=${days}`)
      .then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [project, days]);

  useEffect(() => { load(); }, [load]);

  // Agregar createdByDay por dia (somando todos os tipos)
  const dayTotals = (() => {
    if (!data) return [];
    const map = new Map<string, Record<string, number>>();
    for (const r of data.createdByDay) {
      if (!map.has(r.day)) map.set(r.day, {});
      map.get(r.day)![r.type] = r.count;
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, types]) => ({
      day,
      total: Object.values(types).reduce((a, b) => a + b, 0),
      types,
    }));
  })();

  const accessDayMap = data
    ? new Map(data.accessByDay.map(r => [r.day, r.count]))
    : new Map<string, number>();

  const maxDayTotal = Math.max(...dayTotals.map(d => d.total), 1);

  // Crescimento acumulado por semana
  const cumulativeGrowth = (() => {
    if (!data?.growthByWeek.length) return [];
    let sum = data.totals.atStart;
    return data.growthByWeek.map(w => {
      sum += w.count;
      return { week: w.week, cumulative: sum, added: w.count };
    });
  })();
  const maxCumulative = Math.max(...cumulativeGrowth.map(w => w.cumulative), 1);

  function formatDate(d: string) {
    return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Brain Timeline</h1>
          <p className="text-sm text-white/40 mt-0.5">Como o conhecimento do projeto cresceu ao longo do tempo</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl border border-white/10 overflow-hidden">
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setDays(p.days)}
                className="px-3 py-1.5 text-xs transition-all"
                style={{
                  background: days === p.days ? "rgba(99,102,241,0.25)" : "transparent",
                  color: days === p.days ? "#a5b4fc" : "rgba(255,255,255,0.35)",
                }}>
                {p.label}
              </button>
            ))}
          </div>
          <select value={project} onChange={e => setProject(e.target.value)}
            className="text-sm rounded-xl px-3 py-1.5 border outline-none bg-white/5 border-white/10 text-white/70">
            {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-white/30 py-20">Carregando timeline...</div>
      ) : !data ? null : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total atual", value: data.totals.now, color: "#6366f1" },
              { label: `Criadas (${days}d)`, value: data.totals.created, color: "#10b981" },
              { label: "Marcos (imp:5)", value: data.milestones.length, color: "#f59e0b" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-2xl border border-white/10 p-5"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-3xl font-bold" style={{ color }}>{value}</p>
                <p className="text-sm text-white/40 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Crescimento diário — barras */}
          <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
            <h3 className="text-sm font-semibold text-white/70 mb-4">
              Criações por dia — últimos {days} dias
            </h3>
            {dayTotals.length === 0 ? (
              <p className="text-sm text-white/30 text-center py-8">Nenhuma memória criada neste período.</p>
            ) : (
              <div className="flex items-end gap-0.5 h-32 overflow-x-auto">
                {dayTotals.map(d => {
                  const heightPct = (d.total / maxDayTotal) * 100;
                  const accessCount = accessDayMap.get(d.day) ?? 0;
                  const hasAccess = accessCount > 0;
                  const types = Object.entries(d.types).sort((a, b) => b[1] - a[1]);
                  return (
                    <div key={d.day} className="flex flex-col justify-end group relative flex-shrink-0"
                      style={{ width: Math.max(4, Math.floor(800 / dayTotals.length)), minWidth: 3 }}>
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                        <div className="bg-gray-900 border border-white/10 rounded-xl px-3 py-2 text-[11px] whitespace-nowrap">
                          <p className="text-white font-semibold">{formatDate(d.day)}</p>
                          <p className="text-white/60">{d.total} criada{d.total !== 1 ? "s" : ""}</p>
                          {types.map(([type, count]) => (
                            <p key={type} style={{ color: TYPE_COLORS[type] ?? "#94a3b8" }}>
                              {type}: {count}
                            </p>
                          ))}
                          {hasAccess && <p className="text-emerald-400">{accessCount} acessos</p>}
                        </div>
                      </div>
                      {/* Bar stack */}
                      <div className="flex flex-col justify-end" style={{ height: `${Math.max(heightPct, 2)}%` }}>
                        {types.map(([type, count], i) => (
                          <div key={type} style={{
                            background: TYPE_COLORS[type] ?? "#64748b",
                            height: `${(count / d.total) * 100}%`,
                            minHeight: i === 0 && d.total > 0 ? 2 : 0,
                            opacity: 0.85,
                          }} />
                        ))}
                      </div>
                      {/* Access dot */}
                      {hasAccess && (
                        <div className="w-1 h-1 rounded-full bg-emerald-400 mx-auto mt-0.5" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3">
              {Object.entries(TYPE_COLORS).map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-[10px] text-white/40">{type.replace(/_/g, " ")}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-white/40">dia com acessos</span>
              </div>
            </div>
          </div>

          {/* Crescimento acumulado — linha SVG */}
          {cumulativeGrowth.length > 1 && (
            <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <h3 className="text-sm font-semibold text-white/70 mb-4">Crescimento acumulado (por semana)</h3>
              <svg viewBox="0 0 800 120" className="w-full" style={{ height: 120 }}>
                <defs>
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {(() => {
                  const pts = cumulativeGrowth.map((w, i) => ({
                    x: (i / (cumulativeGrowth.length - 1)) * 780 + 10,
                    y: 110 - (w.cumulative / maxCumulative) * 100,
                    ...w,
                  }));
                  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                  const areaD = `${pathD} L ${pts[pts.length-1].x} 110 L ${pts[0].x} 110 Z`;
                  return (
                    <>
                      <path d={areaD} fill="url(#growthGrad)" />
                      <path d={pathD} stroke="#6366f1" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      {pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 8)) === 0).map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y} r="3" fill="#6366f1" />
                          <text x={p.x} y="118" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.2)">
                            {formatDate(p.week)}
                          </text>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>
            </div>
          )}

          {/* Milestones */}
          {data.milestones.length > 0 && (
            <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
              <h3 className="text-sm font-semibold text-white/70 mb-4">
                Marcos — memórias de alta importância criadas
              </h3>
              <div className="space-y-2">
                {data.milestones.map(m => (
                  <div key={m.id} className="flex items-center gap-3 text-sm">
                    <span className="text-white/20 font-mono text-xs w-20 shrink-0">{formatDate(m.date)}</span>
                    <span className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: TYPE_COLORS[m.type] ?? "#94a3b8" }} />
                    <span className="text-white/60 flex-1 truncate">[{m.type}] {m.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
