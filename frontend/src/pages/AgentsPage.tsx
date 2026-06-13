import { useEffect, useRef, useState } from "react";
import { useWs } from "../contexts/WsContext";
import { api } from "../services/api";
import type { AuditLog } from "../hooks/useLiveAudit";

// ── Tool metadata ─────────────────────────────────────────────────────────────
const TOOL_LABEL: Record<string, string> = {
  memory_add:       "Salvando memória",
  memory_search:    "Buscando memórias",
  memory_list:      "Listando memórias",
  memory_update:    "Atualizando memória",
  project_context:  "Carregando contexto",
  task_create:      "Criando task",
  task_update:      "Atualizando task",
  task_list:        "Verificando tasks",
  db_query:         "Consultando banco",
  db_write_request: "Solicitando escrita",
  db_write_status:  "Verificando escrita",
  redis_get:        "Cache lookup",
};
function tLabel(t: string) { return TOOL_LABEL[t] ?? t.replace(/_/g, " "); }

function tColor(tool: string): string {
  if (tool.startsWith("memory_"))  return "#10b981";
  if (tool.startsWith("task_"))    return "#8b5cf6";
  if (tool.startsWith("db_"))      return "#f97316";
  if (tool === "project_context")  return "#6366f1";
  if (tool === "redis_get")        return "#f59e0b";
  return "#6366f1";
}

function relTime(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5) return "agora";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}min`;
  return `${Math.floor(s/3600)}h`;
}

// ── Agent "burst" — group of tool calls from the same session ────────────────
type Burst = {
  id: string;
  logs: AuditLog[];
  lastTs: number;
  sessionId: string | null;   // real MCP session ID when available
  projectSlug: string | null; // fallback grouping key
  accent: string;
};

const ACCENTS = ["#6366f1","#10b981","#f59e0b","#ec4899","#3b82f6","#f97316"];
let burstCounter = 0;

function shortSession(sid: string) {
  return sid.slice(0, 8).toUpperCase();
}

// ── Robot SVG ─────────────────────────────────────────────────────────────────
function Robot({ active, size, accent }: { active: boolean; size: number; accent: string }) {
  const C  = active ? accent : "#374151";
  const BG = "#0f172a";
  const W  = active ? "white" : "#111827";
  const uid = `r${size}${accent.replace("#","")}`;

  return (
    <svg viewBox="0 0 60 82" width={size} height={Math.round(size * 1.38)} style={{ overflow: "visible" }}>
      <style>{`
        .${uid}ant { transform-origin:30px 10px; animation:${active?`${uid}a .55s ease-in-out infinite alternate`:"none"} }
        .${uid}ab  { animation:${active?`${uid}ab .55s ease-in-out infinite alternate`:"none"} }
        .${uid}el  { transform-origin:21px 24px; animation:${active?`${uid}e 1.8s ease-in-out infinite`:`${uid}ei 3s ease-in-out infinite`} }
        .${uid}er  { transform-origin:39px 24px; animation:${active?`${uid}e 1.8s ease-in-out infinite .4s`:`${uid}ei 3s ease-in-out infinite 1.5s`} }
        .${uid}al  { transform-origin:4px 44px;  animation:${active?`${uid}al .7s ease-in-out infinite alternate`:"none"} }
        .${uid}ar  { transform-origin:56px 44px; animation:${active?`${uid}ar .7s ease-in-out infinite alternate`:"none"} }
        .${uid}sc  { animation:${active?`${uid}sc 1.1s ease-in-out infinite`:"none"} }
        .${uid}bd  { transform-origin:30px 50px; animation:${active?`${uid}bd 1.8s ease-in-out infinite`:"none"} }
        .${uid}pg  { animation:${uid}pg 1.2s ease-out infinite }
        @keyframes ${uid}a  { 0%{transform:rotate(-8deg) translateY(0)} 100%{transform:rotate(8deg) translateY(-4px)} }
        @keyframes ${uid}ab { 0%{transform:scale(1)} 100%{transform:scale(1.3)} }
        @keyframes ${uid}e  { 0%,100%{opacity:.7} 45%,55%{opacity:1} }
        @keyframes ${uid}ei { 0%,85%,100%{transform:scaleY(1)} 90%{transform:scaleY(.15)} }
        @keyframes ${uid}al { 0%{transform:rotate(-12deg)} 100%{transform:rotate(6deg)} }
        @keyframes ${uid}ar { 0%{transform:rotate(12deg)} 100%{transform:rotate(-6deg)} }
        @keyframes ${uid}sc { 0%,100%{opacity:.2} 50%{opacity:.9} }
        @keyframes ${uid}bd { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.02)} }
        @keyframes ${uid}pg { 0%{transform:scale(1);opacity:.9} 100%{transform:scale(2.2);opacity:0} }
      `}</style>

      <g className={`${uid}ant`}>
        <line x1="30" y1="8" x2="30" y2="13" stroke={C} strokeWidth="2" strokeLinecap="round"/>
        <g className={`${uid}ab`}>
          <circle cx="30" cy="5" r="4" fill={C}/>
          {active && <circle className={`${uid}pg`} cx="30" cy="5" r="4" fill={C} opacity="0.5"/>}
        </g>
      </g>

      <rect x="11" y="12" width="38" height="24" rx="6" fill={BG} stroke={C} strokeWidth="1.5"/>
      <rect x="6" y="17" width="5" height="10" rx="2.5" fill={BG} stroke={C} strokeWidth="1.2"/>
      <rect x="49" y="17" width="5" height="10" rx="2.5" fill={BG} stroke={C} strokeWidth="1.2"/>

      <g className={`${uid}el`}>
        {active && <circle cx="21" cy="24" r="7" fill={C} opacity="0.15"/>}
        <circle cx="21" cy="24" r="5" fill={active ? `${C}55` : "#111827"}/>
        <circle cx="21" cy="24" r="3.5" fill={C}/>
        <circle cx="20" cy="23" r="1.5" fill={W} opacity={active ? 0.9 : 0}/>
      </g>
      <g className={`${uid}er`}>
        {active && <circle cx="39" cy="24" r="7" fill={C} opacity="0.15"/>}
        <circle cx="39" cy="24" r="5" fill={active ? `${C}55` : "#111827"}/>
        <circle cx="39" cy="24" r="3.5" fill={C}/>
        <circle cx="38" cy="23" r="1.5" fill={W} opacity={active ? 0.9 : 0}/>
      </g>

      {active
        ? <rect x="22" y="31" width="16" height="2" rx="1" fill={C} opacity="0.7"/>
        : <path d="M22 32 Q30 30 38 32" stroke={C} strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      }

      <g className={`${uid}bd`}>
        <rect x="9" y="38" width="42" height="26" rx="6" fill={BG} stroke={C} strokeWidth="1.5"/>
        <g className={`${uid}sc`}>
          <rect x="17" y="42" width="26" height="14" rx="3"
            fill={active ? `${C}44` : "#111827"} stroke={C} strokeWidth="0.8" opacity="0.7"/>
          {active && <>
            <rect x="20" y="45" width="9"  height="1.5" rx=".75" fill={C} opacity=".9"/>
            <rect x="20" y="48" width="18" height="1.5" rx=".75" fill={C} opacity=".6"/>
            <rect x="20" y="51" width="14" height="1.5" rx=".75" fill={C} opacity=".35"/>
          </>}
        </g>
        <circle cx="15" cy="42" r="2" fill={BG} stroke={C} strokeWidth="1"/>
        <circle cx="45" cy="42" r="2" fill={BG} stroke={C} strokeWidth="1"/>
      </g>

      <g className={`${uid}al`}>
        <rect x="1" y="38" width="7" height="18" rx="3.5" fill={BG} stroke={C} strokeWidth="1.5"/>
        <circle cx="4.5" cy="57" r="3" fill={BG} stroke={C} strokeWidth="1.2"/>
      </g>
      <g className={`${uid}ar`}>
        <rect x="52" y="38" width="7" height="18" rx="3.5" fill={BG} stroke={C} strokeWidth="1.5"/>
        <circle cx="55.5" cy="57" r="3" fill={BG} stroke={C} strokeWidth="1.2"/>
      </g>

      <rect x="15" y="65" width="12" height="15" rx="4" fill={BG} stroke={C} strokeWidth="1.5"/>
      <rect x="33" y="65" width="12" height="15" rx="4" fill={BG} stroke={C} strokeWidth="1.5"/>
    </svg>
  );
}

function Dots({ color }: { color: string }) {
  return (
    <span className="inline-flex gap-1 items-center">
      <style>{`@keyframes td2{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}`}</style>
      {[0, 0.18, 0.36].map((d, i) => (
        <span key={i} style={{
          display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: color,
          animation: "td2 .85s ease-in-out infinite", animationDelay: `${d}s`,
        }}/>
      ))}
    </span>
  );
}

// ── Burst card ────────────────────────────────────────────────────────────────
function BurstCard({ burst, index }: { burst: Burst; index: number }) {
  const active = Date.now() - burst.lastTs < 30_000;
  const current = burst.logs[0];

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all duration-500 ${
      active
        ? "border-opacity-40 shadow-lg"
        : "border-gray-800 opacity-60"
    }`}
      style={active ? { borderColor: `${burst.accent}44`, boxShadow: `0 0 20px ${burst.accent}15` } : {}}>

      {/* Top color bar */}
      <div className="h-0.5 w-full" style={{ background: active ? burst.accent : "#374151" }}/>

      <div className="bg-gray-900 p-4">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Robot active={active} size={56} accent={burst.accent}/>

          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                Agente {index + 1}
              </span>
              {burst.sessionId && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                  style={{ color: burst.accent, borderColor: `${burst.accent}44`, background: `${burst.accent}11` }}>
                  {shortSession(burst.sessionId)}
                </span>
              )}
              {active && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ background: burst.accent }}/>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5"
                    style={{ background: burst.accent }}/>
                </span>
              )}
            </div>

            {active && current ? (
              <>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tColor(current.tool) }}/>
                  <p className="text-sm font-bold text-white truncate">{tLabel(current.tool)}</p>
                </div>
                {current.project && (
                  <p className="text-xs truncate mb-1.5" style={{ color: burst.accent }}>
                    {current.project.name}
                  </p>
                )}
                {current.outputSummary && (
                  <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-1.5">
                    {current.outputSummary}
                  </p>
                )}
                <Dots color={burst.accent}/>
              </>
            ) : (
              <p className="text-xs text-gray-600">Standby · {relTime(current.createdAt)}</p>
            )}
          </div>
        </div>

        {/* Mini tool history */}
        {burst.logs.length > 1 && (
          <div className="mt-3 border-t border-gray-800 pt-2.5 space-y-1.5">
            {burst.logs.slice(1, 4).map(l => (
              <div key={l.id} className="flex items-center gap-2 opacity-50">
                <span className="w-1 h-1 rounded-full shrink-0" style={{ background: tColor(l.tool) }}/>
                <span className="text-[10px] text-gray-500 flex-1 truncate">{tLabel(l.tool)}</span>
                <span className="text-[10px] text-gray-700 tabular-nums">{relTime(l.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const [bursts,   setBursts]   = useState<Burst[]>([]);
  const [feed,     setFeed]     = useState<AuditLog[]>([]);
  const [total,    setTotal]    = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const { subscribe, connected } = useWs();
  const lastTs   = useRef<Record<string, number>>({});   // burstId → lastTs
  const [tick,   setTick]       = useState(0);           // force re-render for relTime

  // Carrega histórico recente ao montar (últimos 30 min)
  useEffect(() => {
    api.get<AuditLog[]>("/api/audit-logs?limit=80").then(logs => {
      const recent = logs.filter(l => Date.now() - new Date(l.createdAt).getTime() < 30 * 60_000);
      if (recent.length === 0) return;

      setFeed(recent);
      setTotal(recent.length);
      setTodayCount(recent.filter(l => Date.now() - new Date(l.createdAt).getTime() < 86_400_000).length);

      // Reconstrói bursts a partir do histórico
      const burstMap = new Map<string, Burst>();
      [...recent].reverse().forEach(log => {
        const now = new Date(log.createdAt).getTime();
        const pSlug = log.project?.slug ?? "__global";
        const key = log.sessionId ?? `${pSlug}`;
        if (!burstMap.has(key)) {
          const id = `burst-${++burstCounter}`;
          const accent = ACCENTS[(burstCounter - 1) % ACCENTS.length];
          burstMap.set(key, { id, logs: [], lastTs: now, sessionId: log.sessionId ?? null, projectSlug: pSlug, accent });
        }
        const b = burstMap.get(key)!;
        b.logs = [log, ...b.logs].slice(0, 10);
        b.lastTs = Math.max(b.lastTs, now);
      });

      setBursts([...burstMap.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, 6));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setTick(v => v + 1);
      setBursts(prev => prev.filter(b => Date.now() - b.lastTs < 120_000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as AuditLog;
      const now  = Date.now();
      const BURST_WINDOW = 8_000; // ms — calls within 8s merge into same burst per project

      setTotal(v => v + 1);
      const isToday = now - new Date(log.createdAt).getTime() < 86_400_000;
      if (isToday) setTodayCount(v => v + 1);

      setFeed(prev => [log, ...prev].slice(0, 80));

      const pSlug = log.project?.slug ?? "__global";

      setBursts(prev => {
        // Prefer matching by sessionId (precise); fall back to project+time window
        const existing = log.sessionId
          ? prev.find(b => b.sessionId === log.sessionId)
          : prev.find(b => !b.sessionId && b.projectSlug === pSlug && now - b.lastTs < BURST_WINDOW);

        if (existing) {
          lastTs.current[existing.id] = now;
          return prev.map(b => b.id === existing.id
            ? { ...b, logs: [log, ...b.logs].slice(0, 10), lastTs: now }
            : b
          );
        }

        // Create new burst
        const id     = `burst-${++burstCounter}`;
        const accent = ACCENTS[(burstCounter - 1) % ACCENTS.length];
        lastTs.current[id] = now;
        const newBurst: Burst = {
          id, logs: [log], lastTs: now,
          sessionId: log.sessionId ?? null,
          projectSlug: pSlug,
          accent,
        };
        return [newBurst, ...prev].slice(0, 6);
      });
    });
  }, [subscribe]);

  const activeBursts   = bursts.filter(b => Date.now() - b.lastTs < 30_000);
  const inactiveBursts = bursts.filter(b => Date.now() - b.lastTs >= 30_000);

  // Force render refresh for time-based values
  void tick;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Centro de Controle</h1>
          <p className="text-xs text-gray-500 mt-0.5">Agentes em atividade — tempo real</p>
        </div>
        <div className="flex items-center gap-3">
          {activeBursts.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"/>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"/>
              </span>
              <span className="text-xs font-medium text-indigo-300">
                {activeBursts.length} agente{activeBursts.length > 1 ? "s ativos" : " ativo"}
              </span>
            </div>
          )}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${
            connected
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-gray-800 border-gray-700 text-gray-600"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-gray-600"}`}/>
            {connected ? "WebSocket ativo" : "Reconectando..."}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Ações hoje", value: todayCount },
          { label: "Agentes ativos", value: activeBursts.length },
          { label: "Agentes vistos", value: bursts.length },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
            <p className="text-2xl font-bold text-white tabular-nums mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Active agents */}
      {activeBursts.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">
            Trabalhando agora
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeBursts.map((b, i) => (
              <BurstCard key={b.id} burst={b} index={i}/>
            ))}
          </div>
        </div>
      )}

      {/* Inactive agents */}
      {inactiveBursts.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider mb-3">
            Recentes (inativos)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {inactiveBursts.map((b, i) => (
              <BurstCard key={b.id} burst={b} index={activeBursts.length + i}/>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {bursts.length === 0 && (
        <div className="text-center py-20">
          <div className="flex justify-center mb-4">
            <Robot active={false} size={80} accent="#374151"/>
          </div>
          <p className="text-gray-500 text-sm mt-2">Nenhum agente ativo no momento.</p>
          <p className="text-gray-700 text-xs mt-1">
            {connected
              ? "Aguardando atividade do Claude via WebSocket..."
              : "Reconectando ao WebSocket..."}
          </p>
        </div>
      )}

      {/* ── Live feed ── */}
      {feed.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">
            Feed de atividade — todas as ações
          </p>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="divide-y divide-gray-800 max-h-96 overflow-y-auto">
              {feed.map((l, i) => (
                <div key={l.id} className={`flex items-start gap-3 px-4 py-2.5 transition-colors ${
                  i === 0 ? "bg-indigo-900/15" : ""
                }`}>
                  <span className="text-gray-700 font-mono text-[10px] w-16 text-right shrink-0 pt-0.5 tabular-nums">
                    {relTime(l.createdAt)}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                    style={{ background: tColor(l.tool) }}/>
                  <span className={`text-[11px] font-semibold shrink-0 px-1.5 py-0.5 rounded`}
                    style={{ background: `${tColor(l.tool)}22`, color: tColor(l.tool) }}>
                    {l.tool}
                  </span>
                  {l.sessionId && (
                    <span className="text-[9px] font-mono text-gray-700 shrink-0">
                      {l.sessionId.slice(0, 6).toUpperCase()}
                    </span>
                  )}
                  {l.project && (
                    <span className="text-[10px] text-gray-600 shrink-0 truncate max-w-[6rem]">
                      {l.project.name}
                    </span>
                  )}
                  <span className="text-[11px] text-gray-500 flex-1 truncate">
                    {l.outputSummary ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
