import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";

type Project = { id: string; name: string; slug: string; color: string };

type HeatmapDay = { date: string; level: number; created: number; accessed: number; modified: number };

type HeatmapData = {
  days: HeatmapDay[];
  weeks: number;
  maxActivity: number;
  totals: { created: number; accessed: number; modified: number };
};

type ConflictData = {
  explicit: { type: string; from: any; to: any }[];
  duplicates: { type: string; similarity: number; from: any; to: any }[];
  total: number;
};

const LEVEL_COLORS = ["#1e1e2e", "#312e81", "#4338ca", "#6366f1", "#a5b4fc"];

export default function BrainHealthPage() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [project, setProject]     = useState("");
  const [heatmap, setHeatmap]     = useState<HeatmapData | null>(null);
  const [conflicts, setConflicts] = useState<ConflictData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [tooltip, setTooltip]     = useState<{ day: HeatmapDay; x: number; y: number } | null>(null);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      api.get<HeatmapData>(`/api/projects/${project}/heatmap?weeks=52`),
      api.get<ConflictData>(`/api/projects/${project}/conflicts`),
    ]).then(([h, c]) => { setHeatmap(h); setConflicts(c); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { load(); }, [load]);

  // Agrupar dias por semana
  const weeks = heatmap ? (() => {
    const result: (HeatmapDay | null)[][] = [];
    let currentWeek: (HeatmapDay | null)[] = [];
    // Padding inicial com nulos (para alinhar com dia da semana)
    if (heatmap.days.length > 0) {
      const firstDow = new Date(heatmap.days[0].date + "T12:00:00").getDay();
      for (let i = 0; i < firstDow; i++) currentWeek.push(null);
    }
    heatmap.days.forEach(day => {
      currentWeek.push(day);
      if (currentWeek.length === 7) { result.push(currentWeek); currentWeek = []; }
    });
    if (currentWeek.length) { while (currentWeek.length < 7) currentWeek.push(null); result.push(currentWeek); }
    return result;
  })() : [];

  const DOW = ["D", "S", "T", "Q", "Q", "S", "S"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Brain Health</h1>
          <p className="text-sm text-white/40 mt-0.5">Atividade cognitiva, conflitos e saúde geral do conhecimento</p>
        </div>
        <select value={project} onChange={e => setProject(e.target.value)}
          className="text-sm rounded-xl px-3 py-1.5 border outline-none bg-white/5 border-white/10 text-white/70">
          {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center text-white/30 py-20">Analisando saúde do cérebro…</div>
      ) : (
        <>
          {/* Activity Totals */}
          {heatmap && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Memórias criadas (52 sem)", value: heatmap.totals.created, color: "#6366f1" },
                { label: "Acessos / buscas",          value: heatmap.totals.accessed, color: "#10b981" },
                { label: "Modificações",               value: heatmap.totals.modified, color: "#f59e0b" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-white/10 p-5"
                  style={{ background: "rgba(255,255,255,0.02)" }}>
                  <p className="text-3xl font-bold" style={{ color }}>{value.toLocaleString("pt-BR")}</p>
                  <p className="text-sm text-white/40 mt-1">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* GitHub-style heatmap */}
          {heatmap && (
            <div className="rounded-2xl border border-white/10 p-5 relative" style={{ background: "rgba(255,255,255,0.02)" }}>
              <h3 className="text-sm font-semibold text-white/70 mb-4">Atividade cognitiva — últimas 52 semanas</h3>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {/* Day-of-week labels */}
                <div className="flex flex-col gap-0.5 mr-1 shrink-0">
                  {DOW.map((d, i) => (
                    <div key={i} className="text-[9px] text-white/20 w-3 text-center leading-[13px]">{i % 2 === 0 ? d : ""}</div>
                  ))}
                </div>
                {weeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-0.5 shrink-0">
                    {week.map((day, di) => (
                      <div key={di}
                        className="w-3 h-3 rounded-sm cursor-pointer transition-all hover:ring-1 hover:ring-white/30"
                        style={{ background: day ? LEVEL_COLORS[day.level] : "transparent" }}
                        onMouseEnter={e => day && setTooltip({ day, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="flex items-center gap-1 mt-3">
                <span className="text-[10px] text-white/30 mr-1">Menos</span>
                {LEVEL_COLORS.map((c, i) => (
                  <div key={i} className="w-3 h-3 rounded-sm" style={{ background: c }} />
                ))}
                <span className="text-[10px] text-white/30 ml-1">Mais</span>
              </div>

              {/* Tooltip */}
              {tooltip && (
                <div className="fixed z-50 pointer-events-none"
                  style={{ left: tooltip.x + 12, top: tooltip.y - 60 }}>
                  <div className="bg-gray-900 border border-white/10 rounded-xl px-3 py-2 text-[11px] whitespace-nowrap shadow-xl">
                    <p className="text-white font-semibold">{new Date(tooltip.day.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</p>
                    {tooltip.day.created > 0 && <p className="text-indigo-400">+{tooltip.day.created} criada{tooltip.day.created !== 1 ? "s" : ""}</p>}
                    {tooltip.day.accessed > 0 && <p className="text-emerald-400">{tooltip.day.accessed} acesso{tooltip.day.accessed !== 1 ? "s" : ""}</p>}
                    {tooltip.day.modified > 0 && <p className="text-amber-400">{tooltip.day.modified} modificad{tooltip.day.modified !== 1 ? "as" : "a"}</p>}
                    {tooltip.day.level === 0 && <p className="text-white/40">Sem atividade</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Conflicts */}
          {conflicts && (
            <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
                <h3 className="text-sm font-semibold text-white flex-1">
                  Conflitos e Duplicatas
                  {conflicts.total > 0 && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                      {conflicts.total}
                    </span>
                  )}
                </h3>
              </div>

              {conflicts.total === 0 ? (
                <div className="px-5 py-8 text-center text-white/30 text-sm">
                  Nenhum conflito ou duplicata detectado
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {[...conflicts.explicit, ...conflicts.duplicates].map((c, i) => (
                    <div key={i} className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: c.type === "CONTRADICTS" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                            color: c.type === "CONTRADICTS" ? "#f87171" : "#fbbf24",
                          }}>
                          {c.type === "CONTRADICTS" ? "Contradição" : `Duplicata ${Math.round((c as any).similarity * 100)}%`}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {[c.from, c.to].map((m, j) => (
                          <div key={j} className="rounded-xl border border-white/[0.08] p-3"
                            style={{ background: "rgba(255,255,255,0.02)" }}>
                            <p className="text-[10px] text-white/30 mb-1">[{m.type}] imp:{m.importance ?? "?"}/5</p>
                            <p className="text-xs text-white/70 font-medium leading-tight">{m.title}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
