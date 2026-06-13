import { useEffect, useRef, useState } from "react";
import { useWs } from "../contexts/WsContext";
import type { AuditLog } from "../hooks/useLiveAudit";

// ── Tool label translations ───────────────────────────────────────────────────
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
  db_write_status:  "Verificando status",
  redis_get:        "Cache lookup",
};

function toolLabel(t: string) { return TOOL_LABEL[t] ?? t.replace(/_/g, " "); }

function toolColor(tool: string): string {
  if (tool.startsWith("memory_"))  return "#10b981";
  if (tool.startsWith("task_"))    return "#8b5cf6";
  if (tool.startsWith("db_"))      return "#f97316";
  if (tool === "project_context")  return "#6366f1";
  if (tool === "redis_get")        return "#f59e0b";
  return "#6366f1";
}

function relTime(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5)   return "agora";
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}

// ── Agent slot — tracks a single "concurrent agent" ────────────────────────
type AgentSlot = {
  id: number;
  log: AuditLog;
  ts: number;          // last activity timestamp
};

// ── Robot SVG ─────────────────────────────────────────────────────────────────
function Robot({ active, size = 52, accent = "#6366f1" }: { active: boolean; size?: number; accent?: string }) {
  const C  = active ? accent : "#374151";
  const BG = "#0f172a";
  const W  = active ? "white" : "#111827";
  const h  = Math.round(size * 1.38);

  return (
    <svg viewBox="0 0 60 82" width={size} height={h} style={{ overflow: "visible", flexShrink: 0 }}>
      <style>{`
        .ra${size} { transform-origin: 30px 10px;
          animation: ${active ? `rAnt${size} 0.55s ease-in-out infinite alternate` : "none"}; }
        .rb${size} { animation: ${active ? `rAball${size} 0.55s ease-in-out infinite alternate` : "none"}; }
        .re-l${size} { transform-origin: 21px 24px;
          animation: ${active ? `rEye${size} 1.8s ease-in-out infinite` : `rEyeI${size} 3s ease-in-out infinite`}; }
        .re-r${size} { transform-origin: 39px 24px;
          animation: ${active ? `rEye${size} 1.8s ease-in-out infinite .4s` : `rEyeI${size} 3s ease-in-out infinite 1.5s`}; }
        .ral${size} { transform-origin: 4px 44px;
          animation: ${active ? `rAL${size} 0.7s ease-in-out infinite alternate` : "none"}; }
        .rar${size} { transform-origin: 56px 44px;
          animation: ${active ? `rAR${size} 0.7s ease-in-out infinite alternate` : "none"}; }
        .rs${size}  { animation: ${active ? `rScr${size} 1.1s ease-in-out infinite` : "none"}; }
        .rbod${size}{ transform-origin: 30px 50px;
          animation: ${active ? `rBr${size} 1.8s ease-in-out infinite` : "none"}; }
        .rping${size}{ animation: rPing${size} 1.2s ease-out infinite; }
        @keyframes rAnt${size}  { 0%{transform:rotate(-8deg) translateY(0)} 100%{transform:rotate(8deg) translateY(-4px)} }
        @keyframes rAball${size}{ 0%{transform:scale(1)} 100%{transform:scale(1.3)} }
        @keyframes rEye${size}  { 0%,100%{opacity:.7} 45%,55%{opacity:1} }
        @keyframes rEyeI${size} { 0%,85%,100%{transform:scaleY(1)} 90%{transform:scaleY(.15)} }
        @keyframes rAL${size}   { 0%{transform:rotate(-12deg)} 100%{transform:rotate(6deg)} }
        @keyframes rAR${size}   { 0%{transform:rotate(12deg)} 100%{transform:rotate(-6deg)} }
        @keyframes rScr${size}  { 0%,100%{opacity:.2} 50%{opacity:.9} }
        @keyframes rBr${size}   { 0%,100%{transform:scaleY(1)} 50%{transform:scaleY(1.02)} }
        @keyframes rPing${size} { 0%{transform:scale(1);opacity:.9} 100%{transform:scale(2.2);opacity:0} }
      `}</style>

      {/* Antenna */}
      <g className={`ra${size}`}>
        <line x1="30" y1="8" x2="30" y2="13" stroke={C} strokeWidth="2" strokeLinecap="round"/>
        <g className={`rb${size}`}>
          <circle cx="30" cy="5" r="4" fill={C}/>
          {active && <circle className={`rping${size}`} cx="30" cy="5" r="4" fill={C} opacity="0.5"/>}
        </g>
      </g>

      {/* Head */}
      <rect x="11" y="12" width="38" height="24" rx="6" fill={BG} stroke={C} strokeWidth="1.5"/>
      <rect x="6"  y="17" width="5"  height="10" rx="2.5" fill={BG} stroke={C} strokeWidth="1.2"/>
      <rect x="49" y="17" width="5"  height="10" rx="2.5" fill={BG} stroke={C} strokeWidth="1.2"/>

      {/* Eyes */}
      <g className={`re-l${size}`}>
        {active && <circle cx="21" cy="24" r="7" fill={C} opacity="0.15"/>}
        <circle cx="21" cy="24" r="5" fill={active ? `${C}55` : "#111827"}/>
        <circle cx="21" cy="24" r="3.5" fill={C}/>
        <circle cx="20" cy="23" r="1.5" fill={W} opacity={active ? 0.9 : 0}/>
      </g>
      <g className={`re-r${size}`}>
        {active && <circle cx="39" cy="24" r="7" fill={C} opacity="0.15"/>}
        <circle cx="39" cy="24" r="5" fill={active ? `${C}55` : "#111827"}/>
        <circle cx="39" cy="24" r="3.5" fill={C}/>
        <circle cx="38" cy="23" r="1.5" fill={W} opacity={active ? 0.9 : 0}/>
      </g>

      {/* Mouth */}
      {active
        ? <rect x="22" y="31" width="16" height="2" rx="1" fill={C} opacity="0.7"/>
        : <path d="M22 32 Q30 30 38 32" stroke={C} strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      }

      {/* Body */}
      <g className={`rbod${size}`}>
        <rect x="9" y="38" width="42" height="26" rx="6" fill={BG} stroke={C} strokeWidth="1.5"/>
        <g className={`rs${size}`}>
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

      {/* Arms */}
      <g className={`ral${size}`}>
        <rect x="1"  y="38" width="7" height="18" rx="3.5" fill={BG} stroke={C} strokeWidth="1.5"/>
        <circle cx="4.5" cy="57" r="3" fill={BG} stroke={C} strokeWidth="1.2"/>
      </g>
      <g className={`rar${size}`}>
        <rect x="52" y="38" width="7" height="18" rx="3.5" fill={BG} stroke={C} strokeWidth="1.5"/>
        <circle cx="55.5" cy="57" r="3" fill={BG} stroke={C} strokeWidth="1.2"/>
      </g>

      {/* Legs */}
      <rect x="15" y="65" width="12" height="15" rx="4" fill={BG} stroke={C} strokeWidth="1.5"/>
      <rect x="33" y="65" width="12" height="15" rx="4" fill={BG} stroke={C} strokeWidth="1.5"/>
    </svg>
  );
}

// ── Typing dots ───────────────────────────────────────────────────────────────
function Dots({ color = "#6366f1" }: { color?: string }) {
  return (
    <span className="inline-flex gap-1 items-center">
      <style>{`@keyframes td{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-4px);opacity:1}}`}</style>
      {[0, 0.18, 0.36].map((d, i) => (
        <span key={i} style={{
          display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: color,
          animation: "td 0.85s ease-in-out infinite", animationDelay: `${d}s`,
        }}/>
      ))}
    </span>
  );
}

// ── Agent card (multi-agent row) ──────────────────────────────────────────────
const AGENT_ACCENTS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899"];

function AgentCard({ slot, index }: { slot: AgentSlot; index: number }) {
  const accent = AGENT_ACCENTS[index % AGENT_ACCENTS.length];
  const active = Date.now() - slot.ts < 30_000;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-900 last:border-0">
      <Robot active={active} size={36} accent={accent}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: toolColor(slot.log.tool) }}/>
          <p className="text-[11px] font-semibold text-white truncate">{toolLabel(slot.log.tool)}</p>
        </div>
        {slot.log.project && (
          <p className="text-[10px] truncate mt-0.5" style={{ color: accent }}>{slot.log.project.name}</p>
        )}
        {active && <div className="mt-1"><Dots color={accent}/></div>}
      </div>
      <span className="text-[10px] text-gray-700 tabular-nums shrink-0">{relTime(slot.log.createdAt)}</span>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────
let _agentIdCounter = 0;

export default function ClaudeWidget() {
  const [logs,     setLogs]     = useState<AuditLog[]>([]);
  const [agents,   setAgents]   = useState<AgentSlot[]>([]);  // concurrent agents
  const [isActive, setIsActive] = useState(false);
  const [visible,  setVisible]  = useState(false);
  const [minimized,setMinimized]= useState(false);
  const lastActivity = useRef(0);
  const { subscribe } = useWs();

  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as AuditLog;
      const now = Date.now();
      lastActivity.current = now;
      setIsActive(true);
      setVisible(true);
      setMinimized(false);

      // Update activity log
      setLogs(prev => [log, ...prev].slice(0, 6));

      // Multi-agent: find an "open slot" (agent that was active < 800ms ago = parallel call)
      // or create a new slot if enough time has passed
      setAgents(prev => {
        const PARALLEL_WINDOW = 1200; // ms — calls within this window = same agent wave
        // Check if there's a slot that received a call very recently
        const recentSlot = prev.find(s => now - s.ts < PARALLEL_WINDOW);
        if (recentSlot) {
          // Could be another agent — check if it's a DIFFERENT tool call type
          const isDifferentAgent = prev.some(s => now - s.ts < PARALLEL_WINDOW && s.log.id !== log.id);
          if (isDifferentAgent && prev.length < 3) {
            // Add a new agent slot
            return [...prev, { id: ++_agentIdCounter, log, ts: now }].slice(-3);
          }
          // Same agent (sequential calls) — update the most recent slot
          return prev.map(s => s.id === recentSlot.id ? { ...s, log, ts: now } : s);
        }
        // No recent slot — replace oldest/inactive slot or add new
        const inactive = prev.find(s => now - s.ts >= PARALLEL_WINDOW);
        if (inactive) {
          return prev.map(s => s.id === inactive.id ? { ...s, log, ts: now } : s);
        }
        return [{ id: ++_agentIdCounter, log, ts: now }];
      });
    });
  }, [subscribe]);

  // Decay isActive + prune stale agents
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setIsActive(now - lastActivity.current < 30_000);
      setAgents(prev => prev.filter(s => now - s.ts < 35_000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (!visible) return null;

  const current      = logs[0];
  const multiAgent   = agents.length > 1;
  const primaryAgent = agents[0];

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, width: 300, zIndex: 100,
      animation: "wSlide .35s cubic-bezier(.34,1.56,.64,1) both",
    }}>
      <style>{`
        @keyframes wSlide { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
      `}</style>

      <div className={`
        rounded-2xl border shadow-2xl overflow-hidden backdrop-blur-sm
        transition-colors duration-500
        ${isActive ? "bg-gray-950/96 border-indigo-500/40 shadow-indigo-500/15" : "bg-gray-950/90 border-gray-800"}
      `}>

        {/* ── Single agent header (or multi collapsed) ── */}
        {!multiAgent && (
          <div className="flex items-center gap-3 px-4 py-3">
            <Robot active={isActive} size={52} accent="#6366f1"/>

            <div className="flex-1 min-w-0">
              {isActive && current ? (
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: toolColor(current.tool) }}/>
                    <p className="text-xs font-semibold text-white leading-tight truncate">
                      {toolLabel(current.tool)}
                    </p>
                  </div>
                  {current.project && (
                    <p className="text-[10px] text-indigo-400 truncate">{current.project.name}</p>
                  )}
                  <div className="mt-1.5"><Dots/></div>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-gray-500">Claude</p>
                  <p className="text-[10px] text-gray-700 mt-0.5">em standby</p>
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              <button onClick={() => setVisible(false)}
                className="text-gray-700 hover:text-gray-500 text-xs leading-none transition-colors"
                title="Fechar">✕</button>
              <button onClick={() => setMinimized(v => !v)}
                className="text-gray-700 hover:text-gray-500 text-[10px] leading-none transition-colors">
                {minimized ? "▲" : "▼"}
              </button>
            </div>
          </div>
        )}

        {/* ── Multi-agent header ── */}
        {multiAgent && (
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {agents.map((s, i) => (
                  <div key={s.id} style={{ zIndex: agents.length - i }}>
                    <Robot active={Date.now() - s.ts < 30_000} size={28}
                      accent={AGENT_ACCENTS[i % AGENT_ACCENTS.length]}/>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-bold text-white">{agents.length} agentes</p>
                <p className="text-[10px] text-indigo-400">trabalhando em paralelo</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button onClick={() => setVisible(false)}
                className="text-gray-700 hover:text-gray-500 text-xs leading-none transition-colors">✕</button>
              <button onClick={() => setMinimized(v => !v)}
                className="text-gray-700 hover:text-gray-500 text-[10px] leading-none transition-colors">
                {minimized ? "▲" : "▼"}
              </button>
            </div>
          </div>
        )}

        {/* ── Multi-agent cards ── */}
        {!minimized && multiAgent && (
          <div>
            {agents.map((s, i) => (
              <AgentCard key={s.id} slot={s} index={i}/>
            ))}
          </div>
        )}

        {/* ── Single agent activity feed ── */}
        {!minimized && !multiAgent && logs.length > 0 && (
          <div className="border-t border-gray-800 divide-y divide-gray-900">
            {logs.map((l, i) => (
              <div key={l.id} className="flex items-start gap-2.5 px-4 py-2"
                style={{ opacity: Math.max(0.18, 1 - i * 0.18) }}>
                <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ background: toolColor(l.tool) }}/>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-gray-300 truncate">{toolLabel(l.tool)}</p>
                  {l.outputSummary && (
                    <p className="text-[10px] text-gray-600 truncate leading-tight mt-0.5">{l.outputSummary}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-700 shrink-0 tabular-nums pt-0.5">
                  {relTime(l.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Status bar ── */}
        <div className={`px-4 py-1.5 flex items-center justify-between border-t border-gray-900 ${
          isActive ? "bg-indigo-950/30" : "bg-gray-900/30"
        }`}>
          <span className={`text-[10px] font-medium ${isActive ? "text-indigo-400" : "text-gray-700"}`}>
            {multiAgent
              ? `${agents.length} agentes simultâneos`
              : isActive
                ? `${logs.length} ação${logs.length !== 1 ? "s" : ""} recente${logs.length !== 1 ? "s" : ""}`
                : "Sem atividade recente"
            }
          </span>
          {isActive && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"/>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500"/>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
