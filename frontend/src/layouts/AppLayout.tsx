import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useWs } from "../contexts/WsContext";
import { useTheme } from "../contexts/ThemeContext";
import type { AuditLog } from "../hooks/useLiveAudit";
import ClaudeWidget from "../components/ClaudeWidget";
import { api } from "../services/api";

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
  chat:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H6l-4 3V5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  jobs:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  pulse:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M2 10h3l2-5 3 10 2-7 2 4 2-2h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  anchor:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M10 3v2M10 15v2M3 10h2M15 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M5.5 5.5l1.5 1.5M13 13l1.5 1.5M5.5 14.5l1.5-1.5M13 7l1.5-1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  monitor:    <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="3" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 17h6M10 14v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="7" cy="8.5" r="1" fill="currentColor"/><path d="M9 8.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="7" cy="11" r="1" fill="currentColor"/><path d="M9 11h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  timeline:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M3 16V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M3 14h3l2-4 3 6 2-5 2 3h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  atlas:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="10" r="2" fill="currentColor"/><path d="M10 3v4M10 13v4M3 10h4M13 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  debt:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M4 16V8l6-5 6 5v8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><rect x="7.5" y="11" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M10 11v5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  health:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M3 10h2l2-5 3 9 2-7 1 3h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  robot:      <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><rect x="5" y="7" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 4v3M7.5 11h.01M12.5 11h.01M8 14h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M3 11h2M15 11h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  terminal:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M6 9l3 3-3 3M11 15h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  help:       <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 14v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M10 11c0-1.5 2.5-1.5 2.5-3.5A2.5 2.5 0 007.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  menu:       <svg fill="none" viewBox="0 0 20 20" className="w-5 h-5"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  close:      <svg fill="none" viewBox="0 0 20 20" className="w-5 h-5"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  digest:     <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><path d="M10 3c-1.5 0-2.8.7-3.5 1.8-.6-.3-1.3-.3-2 0C3.5 5.5 3 6.7 3 8c0 1 .4 2 1 2.6.2 1.4 1.1 2.5 2.3 3.1L7 17h6l.7-3.3c1.2-.6 2.1-1.7 2.3-3.1.6-.6 1-1.6 1-2.6 0-1.3-.5-2.5-1.5-3.2-.7-.3-1.4-.3-2 0C12.8 3.7 11.5 3 10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 10h4M9 12h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  aiconfig:   <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4"><circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.42 1.42M13.54 13.54l1.41 1.41M5.05 14.95l1.42-1.42M13.54 6.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="10" cy="10" r="5" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"/></svg>,
};

const NAV = [
  { to: "/",                label: "Dashboard",   icon: Icon.dashboard, badge: null   },
  { to: "/agent-run",       label: "Agent Run",   icon: Icon.robot,     badge: "new"  },
  { to: "/computer",        label: "Terminal",    icon: Icon.terminal,  badge: null   },
  { to: "/agents",          label: "Agentes",     icon: Icon.agents,    badge: "live" },
  { to: "/brain",           label: "Brain",       icon: Icon.brain,     badge: "hot"  },
  { to: "/brain-graph",     label: "Brain Graph", icon: Icon.graph,     badge: "hot"  },
  { to: "/chat",            label: "Chat Brain",  icon: Icon.chat,      badge: "new"  },
  { to: "/anchors",         label: "Anchors",     icon: Icon.anchor,    badge: "new"  },
  { to: "/session-monitor", label: "Monitor",     icon: Icon.monitor,   badge: "live" },
  { to: "/timeline",        label: "Timeline",    icon: Icon.timeline,  badge: null   },
  { to: "/atlas",           label: "Atlas",       icon: Icon.atlas,     badge: "new"  },
  { to: "/knowledge-debt",  label: "Debt",        icon: Icon.debt,      badge: null   },
  { to: "/brain-health",    label: "Health",      icon: Icon.health,    badge: null   },
  { to: "/jobs",            label: "Jobs",        icon: Icon.jobs,      badge: null   },
  { to: "/search",          label: "Busca",       icon: Icon.search,    badge: null   },
  { to: "/projects",        label: "Projetos",    icon: Icon.projects,  badge: null   },
  { to: "/memories",        label: "Memórias",    icon: Icon.memories,  badge: null   },
  { to: "/tasks",           label: "Tasks",       icon: Icon.tasks,     badge: null   },
  { to: "/write-requests",  label: "Write Reqs",  icon: Icon.write,     badge: null   },
  { to: "/audit",           label: "Atividade",   icon: Icon.audit,     badge: "live" },
  { to: "/logs",            label: "Logs",        icon: Icon.logs,      badge: null   },
  { to: "/services",        label: "Serviços",    icon: Icon.services,  badge: null   },
  { to: "/digest",          label: "Brain Digest", icon: Icon.digest,   badge: "new"  },
  { to: "/ai-config",      label: "Config IA",    icon: Icon.aiconfig, badge: null   },
  { to: "/help",            label: "Ajuda",       icon: Icon.help,      badge: null   },
];

const FULLSCREEN_ROUTES = ["/brain-graph"];

// ── BrainPulse ────────────────────────────────────────────────────────────────
type BrainStats = { healthScore?: number; total?: number };
type Project    = { slug: string; name: string };

function BrainPulse({ footerBtnColor }: { footerBtnColor: string }) {
  const { subscribe } = useWs();
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const cacheTs = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const projects = await api.get<Project[]>("/api/projects");
      if (!projects.length) return;
      const stats = await api.get<BrainStats>(`/api/projects/${projects[0].slug}/brain-stats`);
      const score = stats.healthScore ?? (
        stats.total !== undefined
          ? Math.min(100, Math.round((stats.total ?? 0) * 2))
          : null
      );
      setHealthScore(score);
      cacheTs.current = Date.now();
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - cacheTs.current > 60_000) load();
    }, 10_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    return subscribe("refresh", () => {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
      if (Date.now() - cacheTs.current > 10_000) load();
    });
  }, [subscribe, load]);

  if (healthScore === null) return null;

  const color = healthScore >= 80 ? "#10b981" : healthScore >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${flash ? "opacity-100" : "opacity-80"}`}
      style={{ background: flash ? `${color}15` : "transparent" }}>
      <span className="relative shrink-0 flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
          style={{ background: color }} />
        <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: color }} />
      </span>
      <span className="text-[11px] font-medium" style={{ color: footerBtnColor }}>
        Brain: {healthScore}/100
      </span>
    </div>
  );
}

// ── AppLayout ─────────────────────────────────────────────────────────────────
export default function AppLayout() {
  const { logout }   = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();
  const { connected, subscribe } = useWs();
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark       = theme === "dark";
  const isFullscreen = FULLSCREEN_ROUTES.includes(location.pathname);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [claudeActive, setClaudeActive] = useState(false);
  const [lastTool, setLastTool] = useState<string | null>(null);
  const lastActivity = useRef<number>(0);

  // Fecha sidebar ao navegar no mobile
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Bloqueia scroll do body quando sidebar aberta no mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

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

  // ── Theme tokens ──
  const S = isDark ? {
    outerBg:         "linear-gradient(135deg, #020510 0%, #030712 100%)",
    sidebarBg:       "linear-gradient(180deg, #080c1e 0%, #050810 100%)",
    sidebarBorder:   "rgba(255,255,255,0.06)",
    logo:            { color: "#fff", sub: "rgba(255,255,255,0.25)" },
    navInactive:     { color: "rgba(255,255,255,0.38)" },
    navActiveBg:     "linear-gradient(135deg,rgba(99,102,241,0.22),rgba(139,92,246,0.12))",
    navActiveBorder: "linear-gradient(180deg,#818cf8,#a78bfa)",
    navActiveColor:  "#c7d2fe",
    navIconActive:   "#818cf8",
    footerBorder:    "rgba(255,255,255,0.05)",
    wsBubble:        "rgba(255,255,255,0.12)",
    wsText:          "rgba(255,255,255,0.22)",
    footerBtn:       "rgba(255,255,255,0.25)",
    footerBtnHov:    "rgba(255,255,255,0.7)",
    logoutHov:       "#f87171",
    mainBg:          "#030712",
    pingBorder:      "#080c1e",
    topBarBg:        "#080c1e",
    topBarBorder:    "rgba(255,255,255,0.06)",
    topBarColor:     "rgba(255,255,255,0.7)",
    overlayBg:       "rgba(0,0,0,0.6)",
  } : {
    outerBg:         "#eef0f8",
    sidebarBg:       "#ffffff",
    sidebarBorder:   "rgba(0,0,0,0.07)",
    logo:            { color: "#0f172a", sub: "rgba(15,23,42,0.35)" },
    navInactive:     { color: "rgba(15,23,42,0.42)" },
    navActiveBg:     "linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.06))",
    navActiveBorder: "linear-gradient(180deg,#6366f1,#8b5cf6)",
    navActiveColor:  "#3730a3",
    navIconActive:   "#4f46e5",
    footerBorder:    "rgba(0,0,0,0.06)",
    wsBubble:        "rgba(0,0,0,0.05)",
    wsText:          "rgba(15,23,42,0.3)",
    footerBtn:       "rgba(15,23,42,0.35)",
    footerBtnHov:    "rgba(15,23,42,0.8)",
    logoutHov:       "#dc2626",
    mainBg:          "#eef0f8",
    pingBorder:      "#ffffff",
    topBarBg:        "#ffffff",
    topBarBorder:    "rgba(0,0,0,0.07)",
    topBarColor:     "rgba(15,23,42,0.6)",
    overlayBg:       "rgba(0,0,0,0.4)",
  };

  // ── Sidebar content (compartilhado desktop/mobile) ──
  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-4 py-5 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${S.sidebarBorder}` }}>
        <div className="flex items-center gap-3">
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
        {/* Botão fechar — só aparece no mobile */}
        <button
          className="md:hidden p-1.5 rounded-lg"
          style={{ color: S.topBarColor }}
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
        >
          {Icon.close}
        </button>
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
                <span className="absolute inset-0 rounded-xl transition-all"
                  style={{ background: isActive ? S.navActiveBg : "transparent" }} />
                {isActive && (
                  <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full"
                    style={{ background: S.navActiveBorder }} />
                )}
                <span className="relative z-10 transition-colors"
                  style={{ color: isActive ? S.navIconActive : S.navInactive.color }}>
                  {icon}
                </span>
                <span className="relative z-10 flex-1 text-[13px] font-medium transition-colors"
                  style={{ color: isActive ? S.navActiveColor : S.navInactive.color }}>
                  {label}
                </span>
                {badge === "live" && claudeActive && (
                  <span className="relative z-10 flex h-1.5 w-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                  </span>
                )}
                {badge === "hot" && !isActive && (
                  <span className="relative z-10 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(236,72,153,0.15)", color: "#ec4899" }}>AI</span>
                )}
                {badge === "new" && !isActive && (
                  <span className="relative z-10 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(6,182,212,0.15)", color: "#22d3ee" }}>NEW</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 space-y-0.5" style={{ borderTop: `1px solid ${S.footerBorder}` }}>
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl"
          style={{ background: connected ? S.wsBubble : "transparent" }}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-indigo-500" : "bg-gray-500"}`} />
          <span className="text-[11px]" style={{ color: S.wsText }}>
            {connected ? "Live" : "Offline"}
          </span>
        </div>
        <button onClick={toggleTheme}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-colors"
          style={{ color: S.footerBtn }}
          onMouseEnter={e => (e.currentTarget.style.color = S.footerBtnHov)}
          onMouseLeave={e => (e.currentTarget.style.color = S.footerBtn)}>
          {isDark ? Icon.sun : Icon.moon}
          <span className="text-[13px]">{isDark ? "Tema claro" : "Tema escuro"}</span>
        </button>
        <BrainPulse footerBtnColor={S.footerBtn as string} />
        <button onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-colors"
          style={{ color: S.footerBtn }}
          onMouseEnter={e => { e.currentTarget.style.color = S.logoutHov; e.currentTarget.style.background = isDark ? "rgba(239,68,68,0.08)" : "rgba(220,38,38,0.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = S.footerBtn; e.currentTarget.style.background = "transparent"; }}>
          {Icon.logout}
          <span className="text-[13px]">Sair</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: S.outerBg }}>

      {/* ── Sidebar Desktop (≥768px, sempre visível) ── */}
      <aside
        className="hidden md:flex w-[224px] flex-shrink-0 flex-col"
        style={{
          background: S.sidebarBg,
          borderRight: `1px solid ${S.sidebarBorder}`,
          boxShadow: isDark ? "none" : "4px 0 24px rgba(0,0,0,0.06)",
        }}
      >
        {sidebarContent}
      </aside>

      {/* ── Sidebar Mobile (drawer) ── */}
      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40"
          style={{ background: S.overlayBg, backdropFilter: "blur(2px)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Drawer */}
      <aside
        className="md:hidden fixed inset-y-0 left-0 z-50 flex flex-col w-[280px] transition-transform duration-300"
        style={{
          background: S.sidebarBg,
          borderRight: `1px solid ${S.sidebarBorder}`,
          boxShadow: "8px 0 32px rgba(0,0,0,0.2)",
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {sidebarContent}
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0" style={{ background: S.mainBg }}>

        {/* Top bar mobile */}
        <header
          className="md:hidden flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{
            background: S.topBarBg,
            borderBottom: `1px solid ${S.topBarBorder}`,
          }}
        >
          <button
            className="p-1.5 rounded-lg -ml-1"
            style={{ color: S.topBarColor }}
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            {Icon.menu}
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="relative w-6 h-6 shrink-0">
              <div className="absolute inset-0 rounded-lg"
                style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }} />
              <div className="absolute inset-0 rounded-lg flex items-center justify-center">
                <svg viewBox="0 0 20 20" className="w-3 h-3 text-white" fill="none">
                  <path d="M10 3c-1.5 0-2.8.7-3.5 1.8-.6-.3-1.3-.3-2 0C3.5 5.5 3 6.7 3 8c0 1 .4 2 1 2.6.2 1.4 1.1 2.5 2.3 3.1L7 17h6l.7-3.3c1.2-.6 2.1-1.7 2.3-3.1.6-.6 1-1.6 1-2.6 0-1.3-.5-2.5-1.5-3.2-.7-.3-1.4-.3-2 0C12.8 3.7 11.5 3 10 3z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </div>
              {claudeActive && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
            </div>
            <span className="text-sm font-bold truncate" style={{ color: S.logo.color }}>
              Memory MCP
            </span>
            {claudeActive && lastTool && (
              <span className="text-[11px] truncate" style={{ color: S.logo.sub }}>
                ⚡ {lastTool}
              </span>
            )}
          </div>
          {/* WS indicator no top bar mobile */}
          <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? "bg-indigo-500" : "bg-gray-400"}`} />
        </header>

        {/* Content */}
        {isFullscreen ? (
          <Outlet />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto p-4 md:p-6">
              <Outlet />
            </div>
          </div>
        )}
      </main>

      <ClaudeWidget />
    </div>
  );
}
