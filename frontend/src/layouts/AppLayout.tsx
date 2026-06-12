import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const NAV = [
  { to: "/",               label: "Projetos",       icon: "⬡" },
  { to: "/memories",       label: "Memórias",       icon: "🧠" },
  { to: "/tasks",          label: "Tasks",          icon: "✓"  },
  { to: "/write-requests", label: "Write Requests", icon: "✎"  },
  { to: "/audit",          label: "Audit Log",      icon: "📋" },
];

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  function handleLogout() { logout(); navigate("/login"); }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-800">
          <p className="font-bold text-white text-sm">Memory MCP</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Painel de administração</p>
        </div>

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
              <span className="text-base w-5 text-center">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-red-950/50 hover:text-red-400 transition-colors w-full"
          >
            <span className="text-base w-5 text-center">↩</span>
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
