import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useWs } from "../contexts/WsContext";
import { useTheme } from "../contexts/ThemeContext";
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
  graph:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="5" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="15" cy="5" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="15" cy="15" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M7 10h1M13 5l-2 4M13 15l-2-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  tasks:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M4 6h12M4 10h8M4 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  write:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M14 3l3 3-9 9H5v-3L14 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  audit:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 7v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  logs:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  services:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.42 1.42M13.54 13.54l1.41 1.41M5.05 14.95l1.42-1.42M13.54 6.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  logout:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M8 3H5a2 2 0 00-2 2v10a2 2 0 002 2h3M12 7l4 3-4 3M15.5 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  sun:        <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  moon:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

const NAV = [
  { to: "/",               label: "Dashboard",   icon: Icon.dashboard, badge: null   },
  { to: "/agents",         label: "Agentes",     icon: Icon.agents,    badge: "live" },
  { to: "/brain",          label: "Brain",       icon: Icon.brain,     badge: "hot"  },
  { to: "/brain-graph",    label: "Brain Graph", icon: Icon.graph,     badge: "hot"  },
  { to: "/search",         label: "Busca",       icon: Icon.search,    badge: null   },
  { to: "/projects",       label: "Projetos",    icon: Icon.projects,  badge: null   },
  { to: "/memories",       label: "Memórias",    icon: Icon.memories,  badge: null   },
  { to: "/tasks",          label: "Tasks",       icon: Icon.tasks,     badge: null   },
  { to: "/write-requests", label: "Write Reqs",  icon: Icon.write,     badge: null   },
  { to: "/audit",          label: "Atividade",   icon: Icon.audit,     badge: "live" },
  { to: "/logs",           label: "Logs",        icon: Icon.logs,      badge: null   },
  { to: "/services",       label: "Serviços",    icon: Icon.services,  badge: null   },
];

const FULLSCREEN_ROUTES = ["/brain-graph"];

export default function AppLayout() {
  const { logout }   = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();
  const { connected, subscribe } = useWs();
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark       = theme === "dark";
  const isFullscreen = FULLSCREEN_ROUTES.includes(location.pathname);

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

  // ── Theme-aware style tokens ──
  const S = isDark ? {
    outerBg:       "linear-gradient(135deg, #020510 0%, #030712 100%)",
    sidebarBg:     "linear-gradient(180deg, #080c1e 0%, #050810 100%)",
    sidebarBorder: "rgba(255,255,255,0.06)",
    logo:          { color: "#fff", sub: "rgba(255,255,255,0.25)" },
    navInactive:   { color: "rgba(255,255,255,0.38)" },
    navHoverBg:    "rgba(255,255,255,0.04)",
    navActiveBg:   "linear-gradient(135deg,rgba(99,102,241,0.22),rgba(139,92,246,0.12))",
    navActiveBorder: "linear-gradient(180deg,#818cf8,#a78bfa)",
    navActiveColor: "#c7d2fe",
    navIconActive:  "#818cf8",
    footerBorder:  "rgba(255,255,255,0.05)",
    wsBubble:      "rgba(255,255,255,0.12)",
    wsText:        "rgba(255,255,255,0.22)",
    footerBtn:     "rgba(255,255,255,0.25)",
    footerBtnHov:  "rgba(255,255,255,0.7)",
    logoutHov:     "#f87171",
    mainBg:        "#030712",
    pingBorder:    "#080c1e",
  } : {
    outerBg:       "#eef0f8",
    sidebarBg:     "#ffffff",
    sidebarBorder: "rgba(0,0,0,0.07)",
    logo:          { color: "#0f172a", sub: "rgba(15,23,42,0.35)" },
    navInactive:   { color: "rgba(15,23,42,0.42)" },
    navHoverBg:    "rgba(99,102,241,0.05)",
    navActiveBg:   "linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.06))",
    navActiveBorder: "linear-gradient(180deg,#6366f1,#8b5cf6)",
    navActiveColor: "#3730a3",
    navIconActive:  "#4f46e5",
    footerBorder:  "rgba(0,0,0,0.06)",
    wsBubble:      "rgba(0,0,0,0.05)",
    wsText:        "rgba(15,23,42,0.3)",
    footerBtn:     "rgba(15,23,42,0.35)",
    footerBtnHov:  "rgba(15,23,42,0.8)",
    logoutHov:     "#dc2626",
    mainBg:        "#eef0f8",
    pingBorder:    "#ffffff",
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: S.outerBg }}>

      {/* ── Sidebar ── */}
      <aside className="w-[224px] flex-shrink-0 flex flex-col"
        style={{
          background: S.sidebarBg,
          borderRight: `1px solid ${S.sidebarBorder}`,
          boxShadow: isDark ? "none" : "4px 0 24px rgba(0,0,0,0.06)",
        }}>

        {/* Brand */}
        <div className="px-4 py-5" style={{ borderBottom: `1px solid ${S.sidebarBorder}` }}>
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="relative w-8 h-8 shrink-0">
              <div className="absolute inset-0 rounded-xl"
                style={{ background: "linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a78bfa 100%)" }} />
              <div className="absolute inset-0 rounded-xl flex items-center justify-center">
                <svg viewBox="0 0 20 20" className="w-4 h-4 text-white" fill="none">
                  <path d="M10 3c-1.5 0-2.8.7-3.5 1.8-.6-.3-1.3-.3-2 0C3.5 5.5 3 6.7 3 8c0 1 .4 2 1 2.6.2 1.4 1.1 2.5 2.3 3.1L7 17h6l.7-3.3c1.2-.6 2.1-1.7 2.3-3.1.6-.6 1-1.6 1-2.6 0-1.3-.5-2.5-1.5-3.2-.7-.3-1.4-.3-2 0C12.8 3.7 11.5 3 10 3z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </div>
              {claudeActive && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"
                    style={{ border: `2px solid ${S.pingBorder}` }} />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight tracking-tight" style={{ color: S.logo.color }}>
                Memory MCP
              </p>
              <p className="text-[10px] mt-0.5 truncate" style={{ color: S.logo.sub }}>
                {claudeActive && lastTool ? `⚡ ${lastTool}` : "Second Brain AI"}
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto scrollbar-hide">
          {NAV.map(({ to, label, icon, badge }) => (
            <NavLink key={to} to={to} end={to === "/"}
              style={{ textDecoration: "none" }}
              className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group outline-none"
            >
              {({ isActive }) => (
                <>
                  {/* Background */}
                  <span className="absolute inset-0 rounded-xl transition-all"
                    style={{
                      background: isActive ? S.navActiveBg : "transparent",
                    }} />
                  {/* Active left accent */}
                  {isActive && (
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full"
                      style={{ background: S.navActiveBorder }} />
                  )}
                  {/* Icon */}
                  <span className="relative z-10 transition-colors"
                    style={{ color: isActive ? S.navIconActive : S.navInactive.color }}>
                    {icon}
                  </span>
                  {/* Label */}
                  <span className="relative z-10 flex-1 text-[13px] font-medium transition-colors"
                    style={{ color: isActive ? S.navActiveColor : S.navInactive.color }}>
                    {label}
                  </span>
                  {/* Badges */}
                  {badge === "live" && claudeActive && (
                    <span className="relative z-10 flex h-1.5 w-1.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                    </span>
                  )}
                  {badge === "hot" && !isActive && (
                    <span className="relative z-10 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: "rgba(236,72,153,0.15)", color: "#ec4899" }}>
                      AI
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 space-y-0.5" style={{ borderTop: `1px solid ${S.footerBorder}` }}>
          {/* WS indicator */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl"
            style={{ background: connected ? S.wsBubble : "transparent" }}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-indigo-500" : "bg-gray-500"}`} />
            <span className="text-[11px]" style={{ color: S.wsText }}>
              {connected ? "Live" : "Offline"}
            </span>
          </div>

          {/* Theme toggle */}
          <button onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-colors"
            style={{ color: S.footerBtn }}
            onMouseEnter={e => (e.currentTarget.style.color = S.footerBtnHov)}
            onMouseLeave={e => (e.currentTarget.style.color = S.footerBtn)}>
            {isDark ? Icon.sun : Icon.moon}
            <span className="text-[13px]">{isDark ? "Tema claro" : "Tema escuro"}</span>
          </button>

          {/* Logout */}
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-colors"
            style={{ color: S.footerBtn }}
            onMouseEnter={e => { e.currentTarget.style.color = S.logoutHov; (e.currentTarget.style.background = isDark ? "rgba(239,68,68,0.08)" : "rgba(220,38,38,0.06)"); }}
            onMouseLeave={e => { e.currentTarget.style.color = S.footerBtn; e.currentTarget.style.background = "transparent"; }}>
            {Icon.logout}
            <span className="text-[13px]">Sair</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-hidden flex flex-col" style={{ background: S.mainBg }}>
        {isFullscreen ? (
          <Outlet />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto p-6">
              <Outlet />
            </div>
          </div>
        )}
      </main>

      <ClaudeWidget />
    </div>
  );
}
