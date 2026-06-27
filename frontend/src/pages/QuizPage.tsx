import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../services/api";

type Project = { slug: string; name: string; color: string };
type QuizMemory = {
  id: string; title: string; content: string; type: string;
  importance: number; epistemicStatus: string;
  accessedAt: string | null;
  project: { name: string; slug: string; color: string };
};

const TYPE_COLOR: Record<string,string> = {
  DECISION:"#f59e0b",CONTEXT:"#3b82f6",PATTERN:"#8b5cf6",NOTE:"#6b7280",
  ARCHITECTURE:"#10b981",BRAIN:"#ec4899",SYNTHESIS:"#06b6d4",BUG_FIX:"#ef4444",
};

function timeAgo(ts: string | null) {
  if (!ts) return "nunca acessada";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
  if (d === 0) return "hoje"; if (d === 1) return "ontem";
  return `${d} dias atrás`;
}

export default function QuizPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [slug, setSlug]         = useState<string>("");
  const [queue, setQueue]       = useState<QuizMemory[]>([]);
  const [idx, setIdx]           = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [done, setDone]         = useState(false);
  const [stats, setStats]       = useState({ easy:0, hard:0, forgot:0 });

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => { setProjects(p); if (p.length) setSlug(p[0].slug); }).catch(() => {});
  }, []);

  const loadQueue = useCallback(async (s: string) => {
    setLoading(true); setDone(false); setIdx(0); setRevealed(false); setStats({ easy:0,hard:0,forgot:0 });
    try {
      const data = await api.get<QuizMemory[]>(`/api/quiz?projectSlug=${s}&limit=10`);
      setQueue(data);
      if (data.length === 0) setDone(true);
    } catch { setQueue([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (slug) loadQueue(slug); }, [slug, loadQueue]);

  async function answer(result: "easy"|"hard"|"forgot") {
    const current = queue[idx];
    if (!current) return;
    await api.post(`/api/quiz/${current.id}/answer`, { result }).catch(() => {});
    setStats(s => ({ ...s, [result]: s[result] + 1 }));
    setRevealed(false);
    if (idx + 1 >= queue.length) { setDone(true); }
    else { setIdx(i => i + 1); }
  }

  const current = queue[idx];
  const progress = queue.length > 0 ? (idx / queue.length) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">🧠 Revisão de Memórias</h1>
          <p className="text-[12px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
            Memorias não acessadas há 30+ dias. Revise para manter o conhecimento ativo.
          </p>
        </div>
        <select value={slug} onChange={e => setSlug(e.target.value)}
          className="text-[12px] rounded-xl px-3 py-2 outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}>
          {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {/* Progress bar */}
      {!done && queue.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            <span>{idx}/{queue.length} revisadas</span>
            <span className="flex items-center gap-3">
              <span style={{ color: "#10b981" }}>✓ {stats.easy}</span>
              <span style={{ color: "#f59e0b" }}>~ {stats.hard}</span>
              <span style={{ color: "#ef4444" }}>✗ {stats.forgot}</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
            <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg,#6366f1,#8b5cf6)" }}
              animate={{ width: `${progress}%` }} transition={{ type: "spring", damping: 20 }}/>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
        </div>
      )}

      {/* Done */}
      {done && !loading && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="text-center py-16 space-y-4">
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold text-white">Revisão concluída!</p>
          <div className="flex items-center justify-center gap-6 text-[13px]">
            <span style={{ color: "#10b981" }}>✓ {stats.easy} fáceis</span>
            <span style={{ color: "#f59e0b" }}>~ {stats.hard} difíceis</span>
            <span style={{ color: "#ef4444" }}>✗ {stats.forgot} esquecidas</span>
          </div>
          <button onClick={() => loadQueue(slug)}
            className="mt-4 px-6 py-2.5 rounded-xl text-[13px] font-semibold"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }}>
            Revisar novamente
          </button>
        </motion.div>
      )}

      {/* Card */}
      <AnimatePresence mode="wait">
        {!loading && !done && current && (
          <motion.div key={current.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }} transition={{ type: "spring", damping: 25, stiffness: 250 }}>

            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
              {/* Card header */}
              <div className="px-5 pt-5 pb-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${TYPE_COLOR[current.type] ?? "#6b7280"}20`, color: TYPE_COLOR[current.type] ?? "#6b7280" }}>{current.type}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)" }}>{current.project.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full ml-auto" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.25)" }}>
                    ⏱ {timeAgo(current.accessedAt)}
                  </span>
                </div>
                <h2 className="text-base font-bold leading-snug" style={{ color: "rgba(255,255,255,0.9)" }}>{current.title}</h2>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="w-2 h-2 rounded-full" style={{ background: i < current.importance ? "#f59e0b" : "rgba(255,255,255,0.1)" }}/>
                  ))}
                  <span className="text-[10px] ml-1.5" style={{ color: "rgba(255,255,255,0.2)" }}>importância {current.importance}/5</span>
                </div>
              </div>

              {/* Reveal button */}
              {!revealed ? (
                <div className="px-5 pb-5">
                  <button onClick={() => setRevealed(true)}
                    className="w-full py-3 rounded-xl text-[12px] font-semibold transition-all"
                    style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px dashed rgba(99,102,241,0.3)" }}>
                    👁 Revelar conteúdo
                  </button>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                  <div className="px-5 pb-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="pt-4 max-h-48 overflow-y-auto">
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "rgba(255,255,255,0.7)" }}>
                        {current.content.slice(0, 1200)}{current.content.length > 1200 ? "…" : ""}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Answer buttons */}
              {revealed && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex gap-2 px-5 pb-5">
                  <button onClick={() => answer("forgot")} className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:opacity-80"
                    style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                    ✗ Esqueci
                  </button>
                  <button onClick={() => answer("hard")} className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:opacity-80"
                    style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.2)" }}>
                    ~ Difícil
                  </button>
                  <button onClick={() => answer("easy")} className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:opacity-80"
                    style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                    ✓ Fácil
                  </button>
                </motion.div>
              )}
            </div>

            {/* Skip */}
            <div className="text-center mt-2">
              <button onClick={() => { setRevealed(false); if (idx+1>=queue.length) setDone(true); else setIdx(i=>i+1); }}
                className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                Pular →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!loading && !done && queue.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <p className="text-3xl">🌟</p>
          <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.5)" }}>Tudo em dia!</p>
          <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.25)" }}>Nenhuma memória precisa de revisão agora.</p>
        </div>
      )}
    </div>
  );
}
