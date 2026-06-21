import { useEffect, useState } from "react";
import { api } from "../services/api";

type JobEntry = {
  id: string;
  type: string;
  data: { project_slug?: string; [key: string]: unknown };
  state: string;
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: string;
};

const STATE_META: Record<string, { label: string; color: string; bg: string; animated?: boolean }> = {
  waiting:   { label: "Aguardando", color: "#9ca3af", bg: "rgba(107,114,128,0.12)" },
  active:    { label: "Ativo",      color: "#6366f1", bg: "rgba(99,102,241,0.12)", animated: true },
  completed: { label: "Concluído",  color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  failed:    { label: "Falhou",     color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  synthesize: { label: "Synthesize", color: "#ec4899", icon: "⟡" },
  dream:      { label: "Dream",      color: "#6366f1", icon: "◈" },
  consensus:  { label: "Consensus",  color: "#10b981", icon: "⚖" },
};

function fmtTime(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "agora";
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

function JobCard({ job }: { job: JobEntry }) {
  const [expanded, setExpanded] = useState(false);
  const state = STATE_META[job.state] ?? { label: job.state, color: "#9ca3af", bg: "rgba(107,114,128,0.12)" };
  const type  = TYPE_META[job.type]  ?? { label: job.type, color: "#6b7280", icon: "◉" };

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${expanded ? type.color + "55" : "var(--border)"}`,
        boxShadow: "var(--shadow-card)",
      }}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Type accent bar */}
      <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${type.color}, ${type.color}44)` }} />

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0"
            style={{ background: `${type.color}15`, color: type.color }}>
            {type.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${type.color}15`, color: type.color }}>
                {type.label}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${state.animated ? "animate-pulse" : ""}`}
                style={{ background: state.bg, color: state.color }}>
                {state.label}
              </span>
              {job.data?.project_slug && (
                <span className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-3)", border: "1px solid var(--border)" }}>
                  {job.data.project_slug as string}
                </span>
              )}
            </div>
            <p className="text-xs font-mono mt-1.5" style={{ color: "var(--text-3)" }}>
              #{typeof job.id === "string" ? job.id.slice(-12) : job.id}
            </p>
          </div>
          <span className="text-[10px] shrink-0" style={{ color: "var(--text-3)" }}>
            {fmtTime(job.createdAt)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: "var(--text-3)" }}>Progresso</span>
            <span className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>{job.progress}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
            <div
              className={`h-full rounded-full transition-all duration-500 ${state.animated ? "animate-pulse" : ""}`}
              style={{
                width: `${job.state === "completed" ? 100 : job.progress}%`,
                background: `linear-gradient(90deg, ${type.color}, ${type.color}aa)`,
              }}
            />
          </div>
        </div>

        {/* Error */}
        {job.error && (
          <div className="mt-3 p-2 rounded-lg text-[11px] font-mono break-all"
            style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
            {job.error}
          </div>
        )}

        {/* Expanded result */}
        {expanded && job.result !== undefined && job.result !== null && (
          <div className="mt-3 p-3 rounded-xl text-[11px] font-mono break-all leading-relaxed"
            style={{ background: "var(--bg-elevated)", color: "var(--text-2)", border: "1px solid var(--border)" }}>
            <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--text-3)" }}>RESULTADO</p>
            {typeof job.result === "string"
              ? job.result
              : JSON.stringify(job.result, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get<JobEntry[]>("/api/jobs")
      .then(setJobs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const activeCount = jobs.filter(j => j.state === "active").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-1)" }}>
              Jobs Assíncronos
            </h1>
            {activeCount > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold animate-pulse"
                style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                {activeCount} ativo{activeCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            {jobs.length} jobs · polling 3s
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm border transition-all"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
          <svg fill="none" viewBox="0 0 16 16" className="w-3.5 h-3.5">
            <path d="M13.5 8A5.5 5.5 0 012.5 8a5.5 5.5 0 019.18-4.09M13.5 2.5V6h-3.5"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Atualizar
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="text-center py-20 space-y-4">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-2xl"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            ⟡
          </div>
          <p className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Nenhum job enfileirado</p>
          <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--text-3)" }}>
            Use <code className="font-mono text-pink-400">brain_synthesize()</code> ou{" "}
            <code className="font-mono text-indigo-400">brain_dream()</code> para criar jobs.
          </p>

          {/* How to use */}
          <div className="max-w-lg mx-auto mt-6 rounded-2xl p-5 text-left space-y-3"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Como usar</p>
            {[
              { tool: "brain_synthesize", desc: "Roda ciclo CRE completo: OBSERVE → ASSOCIATE → CRYSTALLIZE → PRUNE → EVOLVE", color: "#ec4899" },
              { tool: "brain_dream",      desc: "Modo SONHO — conecta memórias dormentes com sinapses criativas inesperadas", color: "#6366f1" },
              { tool: "brain_consensus",  desc: "Debate multi-agente: 2 GPTs debatem memórias conflitantes e um árbitro sintetiza", color: "#10b981" },
            ].map(t => (
              <div key={t.tool} className="flex items-start gap-3 p-3 rounded-xl"
                style={{ background: `${t.color}08`, border: `1px solid ${t.color}22` }}>
                <code className="text-[11px] font-mono font-bold shrink-0" style={{ color: t.color }}>{t.tool}()</code>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {jobs.map(j => <JobCard key={j.id} job={j} />)}
        </div>
      )}
    </div>
  );
}
