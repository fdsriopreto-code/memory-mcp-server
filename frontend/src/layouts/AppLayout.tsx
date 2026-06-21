import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useWs } from "../contexts/WsContext";
import type { AuditLog } from "../hooks/useLiveAudit";
import ClaudeWidget from "../components/ClaudeWidget";

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Icon = {
  dashboard:  <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>,
  agents:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  search:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M16.5 16.5l-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  projects:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M3 6h14M3 6v9a2 2 0 002 2h10a2 2 0 002-2V6M3 6l2-3h10l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  memories:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M10 3C6.686 3 4 5.686 4 9c0 2.21 1.197 4.14 2.985 5.18L7.5 17h5l.515-2.82A6.002 6.002 0 0010 3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  brain:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M10 3c-1.5 0-2.8.7-3.5 1.8-.6-.3-1.3-.3-2 0C3.5 5.5 3 6.7 3 8c0 1 .4 2 1 2.6.2 1.4 1.1 2.5 2.3 3.1L7 17h6l.7-3.3c1.2-.6 2.1-1.7 2.3-3.1.6-.6 1-1.6 1-2.6 0-1.3-.5-2.5-1.5-3.2-.7-.3-1.4-.3-2 0C12.8 3.7 11.5 3 10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  tasks:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M4 6h12M4 10h8M4 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  write:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M14 3l3 3-9 9H5v-3L14 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  audit:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 7v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  logs:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  services:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.42 1.42M13.54 13.54l1.41 1.41M5.05 14.95l1.42-1.42M13.54 6.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  logout:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M8 3H5a2 2 0 00-2 2v10a2 2 0 002 2h3M12 7l4 3-4 3M15.5 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

const NAV = [
  { to: "/",               label: "Dashboard",   icon: Icon.dashboard,  badge: null     },
  { to: "/agents",         label: "Agentes",     icon: Icon.agents,     badge: "live"   },
  { to: "/brain",          label: "Brain",       icon: Icon.brain,      badge: "new"    },
  { to: "/search",         label: "Busca",       icon: Icon.search,     badge: null     },
  { to: "/projects",       label: "Projetos",    icon: Icon.projects,   badge: null     },
  { to: "/memories",       label: "Memórias",    icon: Icon.memories,   badge: null     },
  { to: "/tasks",          label: "Tasks",       icon: Icon.tasks,      badge: null     },
  { to: "/write-requests", label: "Write Reqs",  icon: Icon.write,      badge: null     },
  { to: "/audit",          label: "Atividade",   icon: Icon.audit,      badge: "live"   },
  { to: "/logs",           label: "Logs",        icon: Icon.logs,       badge: null     },
  { to: "/services",       label: "Serviços",    icon: Icon.services,   badge: null     },
];

export default function AppLayout() {
  const { logout }   = useAuth();
  const navigate     = useNavigate();
  const { connected, subscribe } = useWs();
  const [claudeActive, setClaudeActive] = useState(false);
  const [lastTool, setLastTool] = useState<string | null>(null);
  const lastActivity = useRef<number>(0);

  useEffect(() => {
    return subscribe("audit_log", (_data) => {
      const log = _data as AuditLog;
      if (log) {
        lastActivity.current = Date.now();
        setClaudeActive(true);
        setLastTool(log.tool ?? null);
      }
    });
  }, [subscribe]);

  useEffect(() => {
    const ticker = setInterval(() => {
      const active = Date.now() - lastActivity.current < 30_000;
      setClaudeActive(active);
      if (!active) setLastTool(null);
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  function handleLogout() { logout(); navigate("/login"); }

  return (
    <div className="flex h-screen bg-[#030712] text-white overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-white/[0.06]"
        style={{ background: "linear-gradient(180deg, #0a0d1a 0%, #060810 100%)" }}>

        {/* Brand */}
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="relative w-8 h-8 shrink-0">
              <div className="absolute inset-0 rounded-xl"
                style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)" }} />
              <div className="absolute inset-0 rounded-xl flex items-center justify-center">
                <svg viewBox="0 0 20 20" className="w-4 h-4 text-white" fill="none">
                  <path d="M10 3c-1.5 0-2.8.7-3.5 1.8-.6-.3-1.3-.3-2 0C3.5 5.5 3 6.7 3 8c0 1 .4 2 1 2.6.2 1.4 1.1 2.5 2.3 3.1L7 17h6l.7-3.3c1.2-.6 2.1-1.7 2.3-3.1.6-.6 1-1.6 1-2.6 0-1.3-.5-2.5-1.5-3.2-.7-.3-1.4-.3-2 0C12.8 3.7 11.5 3 10 3z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </div>
              {claudeActive && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-[#0a0d1a]" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight tracking-tight">Memory MCP</p>
              <p className="text-[10px] text-white/30 mt-0.5 truncate">
                {claudeActive && lastTool ? `⚡ ${lastTool.replace(/_/g, "_")}` : "Second Brain AI"}
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          {NAV.map(({ to, label, icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group ${
                  isActive
                    ? "text-white font-medium"
                    : "text-white/40 hover:text-white/80 hover:bg-white/[0.04]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active gradient background */}
                  {isActive && (
                    <span className="absolute inset-0 rounded-xl opacity-100"
                      style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.1) 100%)" }} />
                  )}
                  {/* Active left border */}
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
                      style={{ background: "linear-gradient(180deg, #818cf8, #a78bfa)" }} />
                  )}
                  <span className={`relative z-10 transition-colors duration-150 ${isActive ? "text-indigo-300" : ""}`}>
                    {icon}
                  </span>
                  <span className="relative z-10 flex-1 text-[13px]">{label}</span>
                  {/* Badges */}
                  {badge === "live" && claudeActive && (
                    <span className="relative z-10 flex h-1.5 w-1.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                  )}
                  {badge === "new" && !isActive && (
                    <span className="relative z-10 text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>
                      NEW
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-white/[0.05] space-y-1">
          {/* WS status */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className={`inline-flex h-1.5 w-1.5 rounded-full shrink-0 ${connected ? "bg-indigo-500" : "bg-gray-600"}`} />
            <span className={`text-[11px] ${connected ? "text-white/25" : "text-white/15"}`}>
              {connected ? "WebSocket ativo" : "Reconectando…"}
            </span>
          </div>
          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/30 hover:text-red-400 hover:bg-red-500/[0.08] transition-all w-full"
          >
            {Icon.logout}
            <span className="text-[13px]">Sair</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>

      <ClaudeWidget />
    </div>
  );
}
