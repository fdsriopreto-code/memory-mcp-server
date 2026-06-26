import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { toast } from "sonner";

type UpdateInfo = {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseUrl: string;
  releaseNotes: string;
};

type ElectronAPI = {
  checkForUpdate: () => Promise<UpdateInfo>;
  installUpdate:  () => Promise<void>;
  getAppVersion:  () => Promise<string>;
};

declare global {
  interface Window { electronAPI?: ElectronAPI }
}

export default function LoginPage() {
  const { login }   = useAuth();
  const navigate    = useNavigate();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [update,   setUpdate]   = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.checkForUpdate().then(info => {
      if (info.hasUpdate) setUpdate(info);
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { toast.error("Credenciais inválidas"); return; }
      const { token } = await res.json() as { token: string };
      login(token);
      navigate("/");
    } catch {
      toast.error("Erro ao conectar");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate() {
    if (!window.electronAPI) return;
    setInstalling(true);
    try { await window.electronAPI.installUpdate(); }
    finally { setInstalling(false); }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">

      {/* Update banner */}
      {update && (
        <div className="w-full max-w-sm mb-4 rounded-2xl overflow-hidden"
          style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)" }}>
          <div className="px-4 py-3 flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5">🚀</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">
                Atualização disponível — v{update.latestVersion}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                Você está na v{update.currentVersion}
                {update.releaseNotes && ` · ${update.releaseNotes.split("\n")[0]}`}
              </p>
            </div>
            <button
              onClick={handleUpdate}
              disabled={installing}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{
                background: installing ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.9)",
                color: installing ? "rgba(165,180,252,0.5)" : "#fff",
              }}>
              {installing ? (
                <>
                  <span className="w-3 h-3 border-2 border-indigo-300/30 border-t-indigo-300 rounded-full animate-spin" />
                  Abrindo…
                </>
              ) : (
                <>⬇ Atualizar</>
              )}
            </button>
          </div>
          {/* Thin animated gradient line */}
          <div className="h-0.5 w-full"
            style={{ background: "linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#6366f1)", backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite" }}>
          </div>
        </div>
      )}

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-4">
            <svg className="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.3 24.3 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 1-6.23-.693L5 14.5m14.8.8 1.402 1.402c1 1 .03 2.798-1.415 2.798H4.213c-1.444 0-2.414-1.798-1.414-2.798L4.2 15.3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Memory MCP</h1>
          <p className="text-sm text-gray-400 mt-1">Painel de administração</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-600 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-600 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        {/* Desktop app indicator */}
        {window.electronAPI && (
          <p className="text-center text-[10px] mt-6" style={{ color: "rgba(255,255,255,0.18)" }}>
            Memory MCP Desktop · v{update?.currentVersion ?? "…"}
          </p>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
      `}</style>
    </div>
  );
}
