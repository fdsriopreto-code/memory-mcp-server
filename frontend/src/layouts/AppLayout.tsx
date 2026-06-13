import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

const NAV = [
  { to: "/",               label: "Dashboard",   icon: "◈"  },
  { to: "/projects",       label: "Projetos",    icon: "⬡"  },
  { to: "/memories",       label: "Memórias",    icon: "🧠" },
  { to: "/tasks",          label: "Tasks",       icon: "✓"  },
  { to: "/write-requests", label: "Write Reqs",  icon: "✎"  },
  { to: "/audit",          label: "Atividade",   icon: "📡" },
];

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate   = useNavigate();
  const [claudeActive, setClaudeActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const logs = await api.get<{ createdAt: string }[]>("/api/audit-logs");
        if (!cancelled && logs.length > 0) {
          setClaudeActive(Date.now() - new Date(logs[0].createdAt).getTime() < 30_000);
        }
      } catch { /* silently ignore */ }
    }

    check();
    const id = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  function handleLogout() { logout(); navigate("/login"); }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col">
        {/* Brand */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-start justify-between">
          <div>
            <p className="font-bold text-white text-sm leading-tight">Memory MCP</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Painel de administração</p>
          </div>

          {claudeActive && (
            <div className="mt-0.5 flex items-center gap-1.5 shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            </div>
          )}
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

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
