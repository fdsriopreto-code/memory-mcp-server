import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useWs } from "../contexts/WsContext";
import type { AuditLog } from "../hooks/useLiveAudit";

const NAV = [
  { to: "/",               label: "Dashboard",   icon: "◈"  },
  { to: "/projects",       label: "Projetos",    icon: "⬡"  },
  { to: "/memories",       label: "Memórias",    icon: "◉"  },
  { to: "/tasks",          label: "Tasks",       icon: "✓"  },
  { to: "/write-requests", label: "Write Reqs",  icon: "✎"  },
  { to: "/audit",          label: "Atividade",   icon: "◎"  },
];

export default function AppLayout() {
  const { logout }   = useAuth();
  const navigate     = useNavigate();
  const { connected, subscribe } = useWs();
  const [claudeActive, setClaudeActive] = useState(false);
  const lastActivity = useRef<number>(0);

  useEffect(() => {
    return subscribe("audit_log", (_data) => {
      const log = _data as AuditLog;
      if (log) {
        lastActivity.current = Date.now();
        setClaudeActive(true);
      }
    });
  }, [subscribe]);

  useEffect(() => {
    const ticker = setInterval(() => {
      setClaudeActive(Date.now() - lastActivity.current < 30_000);
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  function handleLogout() { logout(); navigate("/login"); }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <aside className="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col">
        {/* Brand */}
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-bold text-white text-sm leading-tight">Memory MCP</p>
              <p className="text-[11px] text-gray-500 mt-0.5">Painel de administração</p>
            </div>

            {/* WS status + claude active */}
            <div className="flex flex-col items-end gap-1 mt-0.5">
              {claudeActive && (
                <div className="flex items-center gap-1">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1" title={connected ? "WebSocket conectado" : "Reconectando..."}>
                <span className={`inline-flex h-1.5 w-1.5 rounded-full ${connected ? "bg-indigo-500" : "bg-gray-600"}`} />
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 font-medium"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                }`
              }
            >
              <span className="text-base w-5 text-center shrink-0">{icon}</span>
              <span className="flex-1">{label}</span>
              {to === "/audit" && claudeActive && (
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
            </NavLink>
          ))}
        </nav>

        {/* Connection status footer */}
        <div className="px-5 py-2 border-t border-gray-800/50">
          <p className={`text-[10px] ${connected ? "text-indigo-400/60" : "text-gray-600"}`}>
            {connected ? "● WebSocket ativo" : "○ Reconectando..."}
          </p>
        </div>

        {/* Logout */}
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-red-950/50 hover:text-red-400 transition-colors w-full"
          >
            <span className="text-base w-5 text-center shrink-0">↩</span>
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
