import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../services/api";
import { useWs } from "../contexts/WsContext";

type ComputerAgent = { agentId: string; hostname: string; platform: string; connectedAt: string };
type HistoryEntry  = { command: string; output: string; exitCode: number; ts: number };

export default function ComputerPage() {
  const { subscribe, connected } = useWs();
  const [computers, setComputers]   = useState<ComputerAgent[]>([]);
  const [selected, setSelected]     = useState<string>("");
  const [command, setCommand]       = useState("");
  const [workdir, setWorkdir]       = useState("");
  const [history, setHistory]       = useState<HistoryEntry[]>([]);
  const [running, setRunning]       = useState(false);
  const [liveOutput, setLiveOutput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx]       = useState(-1);
  const bottomRef                   = useRef<HTMLDivElement>(null);
  const inputRef                    = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ agents: ComputerAgent[] }>("/api/computer-agents")
      .then(d => { setComputers(d.agents); if (d.agents.length) setSelected(d.agents[0].agentId); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe("computer_connected", (d: any) => {
        setComputers(prev => [...prev.filter(c => c.agentId !== d.agentId), d]);
        if (!selected) setSelected(d.agentId);
        toast.success(`💻 ${d.agentId} conectado`);
      }),
      subscribe("computer_disconnected", (d: any) => {
        setComputers(prev => prev.filter(c => c.agentId !== d.agentId));
        toast.warning(`💻 ${d.agentId} desconectou`);
      }),
      subscribe("computer_output", (d: any) => {
        setLiveOutput(prev => (prev + d.chunk).slice(-8000));
        setTimeout(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, 50);
      }),
      subscribe("computer_done", (_d: any) => {
        setRunning(false);
      }),
      subscribe("computer_error", (d: any) => {
        setLiveOutput(prev => prev + `\n❌ ERRO: ${d.error}`);
        setRunning(false);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe, selected]);

  async function runCommand() {
    if (!command.trim() || !selected || running) return;
    const cmd = command.trim();
    setCommand("");
    setLiveOutput("");
    setRunning(true);
    setCmdHistory(prev => [cmd, ...prev.slice(0, 49)]);
    setHistIdx(-1);

    try {
      const result = await api.post<{ output: string; exitCode: number }>("/api/computer-exec", {
        command: cmd,
        workdir: workdir || undefined,
        agent_id: selected,
      });
      setHistory(prev => [...prev.slice(-99), {
        command: cmd, output: result.output, exitCode: result.exitCode, ts: Date.now()
      }]);
    } catch (e: any) {
      toast.error(e.message || "Erro");
    } finally {
      setRunning(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { runCommand(); return; }
    if (e.key === "ArrowUp") {
      const idx = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(idx);
      setCommand(cmdHistory[idx] ?? "");
      e.preventDefault();
    }
    if (e.key === "ArrowDown") {
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setCommand(idx === -1 ? "" : (cmdHistory[idx] ?? ""));
      e.preventDefault();
    }
  }

  const QUICK_CMDS = [
    "git status",
    "git log --oneline -10",
    "git diff --stat",
    "npm run build",
    "git add -A && git commit -m \"update\"",
  ];

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">💻 Terminal Remoto</h1>
          <p className="text-sm text-white/40 mt-0.5">Execute comandos no seu computador de qualquer lugar</p>
        </div>
        {computers.length === 0 ? (
          <div className="text-xs px-4 py-2 rounded-xl border border-dashed border-white/20 text-white/30">
            Rode o <code className="text-indigo-400">computer-agent</code> no seu PC para conectar
          </div>
        ) : (
          <select value={selected} onChange={e => setSelected(e.target.value)}
            className="text-sm rounded-xl px-3 py-2 border outline-none"
            style={{ background: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.2)", color: "#10b981" }}>
            {computers.map(c => <option key={c.agentId} value={c.agentId}>{c.agentId} ({c.hostname})</option>)}
          </select>
        )}
      </div>

      {/* Terminal window */}
      <div className="flex-1 rounded-2xl overflow-hidden flex flex-col min-h-0"
        style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
          <div className="w-3 h-3 rounded-full bg-red-500/60" />
          <div className="w-3 h-3 rounded-full bg-amber-500/60" />
          <div className="w-3 h-3 rounded-full bg-green-500/60" />
          <span className="ml-2 text-xs text-white/30 font-mono">{selected || "sem agente"} — terminal</span>
          <div className="ml-auto flex items-center gap-2">
            <input value={workdir} onChange={e => setWorkdir(e.target.value)}
              placeholder="workdir (opcional)"
              className="text-[10px] font-mono px-2 py-1 rounded bg-white/5 border border-white/5 text-white/40 outline-none w-52" />
          </div>
        </div>

        {/* Output area */}
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs" style={{ minHeight: 0 }}>
          {history.map((h, i) => (
            <div key={i} className="mb-4">
              <div className="text-emerald-400">$ {h.command}</div>
              <div className={`whitespace-pre-wrap mt-1 ${h.exitCode === 0 ? "text-white/70" : "text-red-400/80"}`}>
                {h.output || "(sem output)"}
              </div>
              {h.exitCode !== 0 && <div className="text-red-400/60 text-[10px] mt-0.5">exit {h.exitCode}</div>}
            </div>
          ))}

          {/* Live output */}
          {running && (
            <div>
              <div className="text-emerald-400">$ {command || cmdHistory[0]}</div>
              <div className="text-white/60 whitespace-pre-wrap mt-1">{liveOutput}</div>
              <span className="animate-pulse text-emerald-400">▋</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick commands */}
        <div className="flex gap-1.5 px-4 py-2 border-t border-white/5 overflow-x-auto">
          {QUICK_CMDS.map(cmd => (
            <button key={cmd} onClick={() => setCommand(cmd)}
              className="text-[10px] px-2 py-1 rounded-lg border border-white/10 text-white/30 hover:text-white/60 whitespace-nowrap transition-colors shrink-0">
              {cmd}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/5">
          <span className="text-emerald-400 font-mono text-sm shrink-0">$</span>
          <input
            ref={inputRef}
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={computers.length === 0 ? "conecte o computer-agent para usar o terminal" : "comando..."}
            disabled={computers.length === 0 || running}
            className="flex-1 bg-transparent font-mono text-sm text-white outline-none placeholder-white/20 disabled:opacity-40"
            autoFocus
          />
          {running && <span className="text-xs text-amber-400 animate-pulse shrink-0">executando…</span>}
          <button onClick={runCommand} disabled={!command.trim() || !selected || running}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-30"
            style={{ background: "rgba(99,102,241,0.25)", color: "#a5b4fc" }}>
            ↵
          </button>
        </div>
      </div>
    </div>
  );
}
