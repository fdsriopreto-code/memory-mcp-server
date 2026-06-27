import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../services/api";

type Notif = { id: string; type: string; title: string; body: string; isRead: boolean; isDismissed: boolean; metadata: Record<string,unknown>; createdAt: string; memoryId?: string };

const TYPE_ICON: Record<string,string> = {
  hypothesis_review: "🧪",
  idle_memory:       "💤",
  synthesis_ready:   "🧬",
  custom:            "💡",
};

function timeAgo(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (d < 60) return "agora"; if (d < 3600) return `${Math.floor(d/60)}min`;
  if (d < 86400) return `${Math.floor(d/3600)}h`; return `${Math.floor(d/86400)}d`;
}

export default function NotificationBell({ isDark }: { isDark: boolean }) {
  const [notifs, setNotifs]   = useState<Notif[]>([]);
  const [open, setOpen]       = useState(false);
  const [generating, setGen]  = useState(false);
  const ref                   = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<Notif[]>("/api/notifications?unread=true");
      setNotifs(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function dismiss(id: string) {
    await api.delete(`/api/notifications/${id}`).catch(() => {});
    setNotifs(prev => prev.filter(n => n.id !== id));
  }

  async function markRead(id: string) {
    await api.patch(`/api/notifications/${id}/read`, {}).catch(() => {});
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }

  async function clearAll() {
    await api.delete("/api/notifications").catch(() => {});
    setNotifs([]);
  }

  async function generate() {
    setGen(true);
    try {
      await api.post("/api/notifications/generate", {});
      await load();
    } finally { setGen(false); }
  }

  const unread = notifs.filter(n => !n.isRead).length;

  const btnColor = isDark ? "rgba(255,255,255,0.35)" : "rgba(15,23,42,0.4)";

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-xl transition-colors"
        style={{ color: open ? "#818cf8" : btnColor, background: open ? "rgba(99,102,241,0.12)" : "transparent" }}>
        <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 2a6 6 0 00-6 6v3l-2 3h16l-2-3V8a6 6 0 00-6-6z" strokeLinejoin="round"/>
          <path d="M8 15a2 2 0 004 0" strokeLinecap="round"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
            style={{ background: "#ef4444", color: "#fff" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="absolute right-0 top-full mt-2 z-50 rounded-2xl overflow-hidden"
            style={{ width: 340, background: isDark ? "rgba(8,12,30,0.98)" : "#fff", border: `1px solid ${isDark?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.08)"}`, boxShadow: "0 16px 48px rgba(0,0,0,0.35)" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${isDark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.06)"}` }}>
              <div>
                <p className="text-sm font-bold" style={{ color: isDark?"#fff":"#0f172a" }}>Notificações</p>
                <p className="text-[10px]" style={{ color: isDark?"rgba(255,255,255,0.25)":"rgba(15,23,42,0.35)" }}>{unread} não lida{unread!==1?"s":""}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={generate} disabled={generating} title="Gerar notificações"
                  className="p-1.5 rounded-lg text-[11px] font-medium transition-colors"
                  style={{ color: isDark?"rgba(255,255,255,0.35)":"rgba(15,23,42,0.35)", background: "transparent" }}>
                  {generating ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin inline-block"/> : "⚡"}
                </button>
                {notifs.length > 0 && (
                  <button onClick={clearAll} className="px-2 py-1 rounded-lg text-[10px] font-medium"
                    style={{ color: isDark?"rgba(255,255,255,0.25)":"rgba(15,23,42,0.3)" }}>
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <span className="text-2xl opacity-30">🔔</span>
                  <p className="text-[12px]" style={{ color: isDark?"rgba(255,255,255,0.25)":"rgba(15,23,42,0.3)" }}>Nenhuma notificação</p>
                  <button onClick={generate} disabled={generating}
                    className="text-[11px] px-3 py-1.5 rounded-lg mt-1"
                    style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
                    {generating ? "Gerando..." : "Verificar agora"}
                  </button>
                </div>
              ) : notifs.map(n => (
                <div key={n.id} onClick={() => markRead(n.id)}
                  className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors"
                  style={{
                    background: n.isRead ? "transparent" : isDark?"rgba(99,102,241,0.06)":"rgba(99,102,241,0.04)",
                    borderBottom: `1px solid ${isDark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.04)"}`,
                  }}>
                  <span className="text-lg shrink-0 mt-0.5">{TYPE_ICON[n.type] ?? "💡"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold leading-tight" style={{ color: isDark?"rgba(255,255,255,0.85)":"#0f172a" }}>{n.title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: isDark?"rgba(255,255,255,0.45)":"rgba(15,23,42,0.5)" }}>{n.body}</p>
                    <p className="text-[9px] mt-1" style={{ color: isDark?"rgba(255,255,255,0.2)":"rgba(15,23,42,0.25)" }}>{timeAgo(n.createdAt)}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); dismiss(n.id); }}
                    className="shrink-0 p-1 rounded opacity-40 hover:opacity-80"
                    style={{ color: isDark?"#fff":"#0f172a" }}>
                    <svg fill="none" viewBox="0 0 12 12" className="w-3 h-3" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 2l8 8M10 2L2 10" strokeLinecap="round"/>
                    </svg>
                  </button>
                  {!n.isRead && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5" />}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
