import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../services/api";
import { useWs } from "../contexts/WsContext";

type Project = { id: string; name: string; slug: string };

type AgentStep = {
  id:          number;
  tool:        string;
  description: string;
  result?:     string;
  success?:    boolean;
  running?:    boolean;
};

type AgentRun = {
  goal:        string;
  project:     string;
  steps:       AgentStep[];
  status:      "idle" | "planning" | "running" | "done" | "error";
  computerOutput: string;
  successCount?: number;
  totalSteps?:   number;
};

const TOOL_ICONS: Record<string, string> = {
  computer_exec: "⌨️",
  web_search:    "🔍",
  web_fetch:     "🌐",
  memory_add:    "🧠",
  memory_search: "💭",
  git:           "🌿",
};

const STATUS_COLORS: Record<string, string> = {
  idle:     "rgba(100,116,139,0.2)",
  planning: "rgba(245,158,11,0.15)",
  running:  "rgba(99,102,241,0.15)",
  done:     "rgba(16,185,129,0.15)",
  error:    "rgba(239,68,68,0.15)",
};

const AI_MODEL_OPTIONS = [
  { id: "",                    label: "🤖 Auto (melhor disponível)" },
  { id: "claude-sonnet-4-6",  label: "🟣 Claude Sonnet 4.6"       },
  { id: "claude-haiku-4-5",   label: "🟣 Claude Haiku 4.5"        },
  { id: "gpt-4o",             label: "🟢 GPT-4o"                   },
  { id: "gpt-4o-mini",        label: "🟢 GPT-4o Mini"              },
  { id: "deepseek-chat",      label: "🔵 DeepSeek Chat"            },
];

export default function AgentRunPage() {
  const { subscribe } = useWs();
  const [projects, setProjects]     = useState<Project[]>([]);
  const [project, setProject]       = useState("");
  const [goal, setGoal]             = useState("");
  const [maxSteps, setMaxSteps]     = useState(8);
  const [workdir, setWorkdir]       = useState("");
  const [aiModel, setAiModel]       = useState("");
  const [run, setRun]               = useState<AgentRun | null>(null);
  const [loading, setLoading]       = useState(false);
  const [computers, setComputers]   = useState<{ agentId: string; hostname: string }[]>([]);
  const outputRef                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
    api.get<{ agents: { agentId: string; hostname: string }[] }>("/api/computer-agents")
      .then(d => setComputers(d.agents))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe("computer_connected", (d: any) => {
        setComputers(prev => [...prev.filter(c => c.agentId !== d.agentId), d]);
        toast.success(`💻 ${d.agentId} conectado`);
      }),
      subscribe("computer_disconnected", (d: any) => {
        setComputers(prev => prev.filter(c => c.agentId !== d.agentId));
        toast.error(`💻 ${d.agentId} desconectou`);
      }),
      subscribe("agent_run_start", (d: any) => {
        setRun({ goal: d.goal, project: d.project, steps: [], status: "planning", computerOutput: "" });
      }),
      subscribe("agent_run_plan", (d: any) => {
        setRun(prev => prev ? { ...prev, steps: d.steps, status: "running" } : prev);
      }),
      subscribe("agent_run_step", (d: any) => {
        setRun(prev => {
          if (!prev) return prev;
          const steps = prev.steps.map(s =>
            s.id === d.step ? { ...s, running: true } : { ...s, running: false }
          );
          if (!steps.find(s => s.id === d.step)) {
            steps.push({ id: d.step, tool: d.tool, description: d.description, running: true });
          }
          return { ...prev, steps };
        });
      }),
      subscribe("agent_run_step_done", (d: any) => {
        setRun(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            steps: prev.steps.map(s =>
              s.id === d.step ? { ...s, running: false, result: d.result, success: d.success } : s
            ),
          };
        });
      }),
      subscribe("agent_run_done", (d: any) => {
        setRun(prev => prev ? { ...prev, status: "done", successCount: d.successCount, totalSteps: d.totalSteps } : prev);
        setLoading(false);
        toast.success(`✅ Agente concluiu: ${d.successCount}/${d.totalSteps} steps`);
      }),
      subscribe("computer_output", (d: any) => {
        setRun(prev => prev ? { ...prev, computerOutput: (prev.computerOutput + d.chunk).slice(-3000) } : prev);
        setTimeout(() => { outputRef.current?.scrollTo(0, outputRef.current.scrollHeight); }, 50);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe]);

  async function startAgent() {
    if (!project || !goal.trim()) { toast.error("Projeto e objetivo são obrigatórios"); return; }
    setLoading(true);
    setRun({ goal, project, steps: [], status: "planning", computerOutput: "" });
    try {
      const result = await api.post<{ content: [{ text: string }] }>("/api/agent-run", {
        project, goal, max_steps: maxSteps, workdir: workdir || undefined,
        ai_model: aiModel || undefined,
      });
      // Se não veio via WS, mostrar resultado
      if (result?.content?.[0]?.text) {
        setRun(prev => prev ? { ...prev, status: "done" } : prev);
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao iniciar agente");
      setRun(prev => prev ? { ...prev, status: "error" } : prev);
    } finally {
      setLoading(false);
    }
  }

  const QUICK_GOALS = [
    "git status e mostre o que está modificado",
    "git add -A, commit com mensagem descritiva e push",
    "npm run build e mostre se há erros de TypeScript",
    "Mostre os últimos 10 commits do git",
    "Pesquise a documentação mais recente de React 19",
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">🤖 Agent Run</h1>
          <p className="text-sm text-white/40 mt-0.5">Loop autônomo — planeja e executa no seu computador</p>
        </div>
        {/* Computer status */}
        <div className="flex items-center gap-2">
          {computers.length === 0 ? (
            <span className="text-xs px-3 py-1.5 rounded-xl border border-white/10 text-white/30">
              💻 Nenhum computador
            </span>
          ) : (
            computers.map(c => (
              <span key={c.agentId} className="text-xs px-3 py-1.5 rounded-xl border"
                style={{ background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981" }}>
                💻 {c.agentId}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Config */}
      <div className="rounded-2xl border border-white/10 p-5 space-y-4"
        style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Projeto</label>
            <select value={project} onChange={e => setProject(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none">
              {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Diretório de trabalho (opcional)</label>
            <input value={workdir} onChange={e => setWorkdir(e.target.value)}
              placeholder="C:\Users\user\meu-projeto"
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Modelo de IA</label>
            <select value={aiModel} onChange={e => setAiModel(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none">
              {AI_MODEL_OPTIONS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Máximo de steps</label>
            <input type="number" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))}
              min={1} max={20}
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none" />
          </div>
        </div>

        <div>
          <label className="text-xs text-white/40 mb-1 block">Objetivo</label>
          <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3}
            placeholder="Ex: Analise o código em src/, encontre problemas e crie um relatório de qualidade"
            className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50 resize-none" />
        </div>

        {/* Quick goals */}
        <div className="flex flex-wrap gap-2">
          {QUICK_GOALS.map(g => (
            <button key={g} onClick={() => setGoal(g)}
              className="text-xs px-3 py-1.5 rounded-xl border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-all">
              {g.slice(0, 40)}…
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <button onClick={startAgent} disabled={loading || !goal.trim()}
            className="ml-auto px-6 py-2.5 rounded-xl font-medium text-sm transition-all disabled:opacity-40 flex items-center gap-2"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }}>
            {loading ? (
              <><span className="animate-spin">⟳</span> Executando…</>
            ) : "▶ Iniciar Agente"}
          </button>
        </div>
      </div>

      {/* Run visualization */}
      {run && (
        <div className="rounded-2xl border border-white/10 overflow-hidden"
          style={{ background: STATUS_COLORS[run.status] ?? "rgba(255,255,255,0.02)" }}>
          <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
            <div className="flex-1">
              <span className="text-xs font-semibold" style={{
                color: run.status === "done" ? "#10b981" : run.status === "error" ? "#ef4444" : "#a5b4fc"
              }}>
                {run.status === "planning" ? "🤔 Planejando…" :
                 run.status === "running"  ? "⚡ Executando…" :
                 run.status === "done"     ? `✅ Concluído (${run.successCount}/${run.totalSteps})` :
                 run.status === "error"    ? "❌ Erro" : ""}
              </span>
              <p className="text-sm text-white/70 mt-0.5 font-medium">{run.goal}</p>
            </div>
          </div>

          {/* Steps */}
          {run.steps.length > 0 && (
            <div className="divide-y divide-white/5">
              {run.steps.map(step => (
                <div key={step.id} className="px-5 py-3 flex items-start gap-3">
                  <span className="text-lg shrink-0 mt-0.5">
                    {step.running ? <span className="animate-spin inline-block">⟳</span> :
                     step.success === true ? "✅" : step.success === false ? "❌" :
                     TOOL_ICONS[step.tool] ?? "🔧"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-indigo-400">{step.tool}</span>
                      <span className="text-xs text-white/50 flex-1 truncate">{step.description}</span>
                    </div>
                    {step.result && (
                      <pre className="text-[10px] text-white/40 mt-1 truncate">{step.result.slice(0, 120)}</pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Computer output stream */}
          {run.computerOutput && (
            <div ref={outputRef}
              className="mx-5 mb-4 rounded-xl bg-black/30 p-3 text-[10px] font-mono text-green-400/70 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {run.computerOutput}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
