import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../services/api";

type Project = { id: string; name: string; slug: string; color: string };
type Source = { id: string; title: string; type: string; similarity: number };
type ToolCall = { name: string; args: Record<string, unknown>; result: unknown };

type Message = {
  id: string;
  role: "user" | "brain";
  text: string;
  mode?: "semantic" | "agentic" | "web" | "inferred";
  confidence?: number;
  sources?: Source[];
  path?: string[];
  toolCalls?: ToolCall[];
  conversationType?: "project" | "brainstorm" | "research" | "action";
};

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  DECISION:     { bg: "rgba(99,102,241,0.12)",  text: "#818cf8", dot: "#6366f1" },
  CONTEXT:      { bg: "rgba(59,130,246,0.12)",  text: "#93c5fd", dot: "#3b82f6" },
  PATTERN:      { bg: "rgba(16,185,129,0.12)",  text: "#6ee7b7", dot: "#10b981" },
  NOTE:         { bg: "rgba(245,158,11,0.12)",  text: "#fcd34d", dot: "#f59e0b" },
  BUG_FIX:      { bg: "rgba(239,68,68,0.12)",   text: "#fca5a5", dot: "#ef4444" },
  ARCHITECTURE: { bg: "rgba(139,92,246,0.12)",  text: "#c4b5fd", dot: "#8b5cf6" },
  BRAIN:        { bg: "rgba(236,72,153,0.12)",  text: "#f9a8d4", dot: "#ec4899" },
};

const CONV_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  project:    { label: "Projeto",    color: "#818cf8", icon: "📁" },
  brainstorm: { label: "Brainstorm", color: "#a78bfa", icon: "💡" },
  research:   { label: "Pesquisa",   color: "#38bdf8", icon: "🌐" },
  action:     { label: "Ação",       color: "#34d399", icon: "⚡" },
};

const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  web_search:        { icon: "🌐", label: "Pesquisa Web",     color: "#38bdf8" },
  create_task:       { icon: "✅", label: "Tarefa criada",    color: "#34d399" },
  create_memory:     { icon: "🧠", label: "Memória salva",    color: "#a78bfa" },
  list_projects:     { icon: "📁", label: "Listou projetos",  color: "#818cf8" },
  get_project_stats: { icon: "📊", label: "Stats do projeto", color: "#fbbf24" },
};

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_COLORS[type] ?? { bg: "rgba(107,114,128,0.15)", text: "#9ca3af", dot: "#6b7280" };
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
      style={{ background: s.bg, color: s.text }}>
      <span className="w-1 h-1 rounded-full shrink-0" style={{ background: s.dot }} />
      {type.replace(/_/g, " ")}
    </span>
  );
}

function confidenceColor(c: number) {
  if (c >= 0.8) return "#10b981";
  if (c >= 0.5) return "#f59e0b";
  return "#ef4444";
}

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[tc.name] ?? { icon: "🔧", label: tc.name, color: "#9ca3af" };
  const res = tc.result as Record<string, unknown>;
  const isError = typeof res?.error === "string";

  return (
    <div className="rounded-xl overflow-hidden" style={{
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${isError ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.07)"}`,
    }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-sm">{meta.icon}</span>
        <span className="text-[11px] font-semibold flex-1" style={{ color: isError ? "#fca5a5" : meta.color }}>
          {isError ? `Erro: ${res.error}` : meta.label}
        </span>
        {tc.name === "web_search" && !isError && (
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            {((res?.results as unknown[]) ?? []).length} resultados
          </span>
        )}
        <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {tc.name === "web_search" && !isError && (
            <>
              {res.answer && (
                <p className="text-[11px] leading-relaxed p-2 rounded-lg"
                  style={{ background: "rgba(56,189,248,0.08)", color: "#bae6fd" }}>
                  {String(res.answer)}
                </p>
              )}
              {((res.results ?? []) as { title: string; url: string; snippet: string }[]).map((r, i) => (
                <div key={i} className="rounded-lg p-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="text-[11px] font-medium hover:underline" style={{ color: "#38bdf8" }}>
                    {r.title}
                  </a>
                  <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "rgba(255,255,255,0.4)" }}>{r.snippet}</p>
                </div>
              ))}
            </>
          )}
          {tc.name === "create_task" && !isError && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>
                {String(res.priority ?? "MEDIUM")}
              </span>
              <span>{String(res.title)}</span>
            </div>
          )}
          {tc.name === "create_memory" && !isError && (
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              Salvo: <span style={{ color: "#a78bfa" }}>{String(res.title)}</span>
            </p>
          )}
          {tc.name === "list_projects" && !isError && (
            <div className="space-y-1">
              {((res as unknown) as { name: string; slug: string; memories: number; tasks: number }[]).map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
                  <span className="font-medium" style={{ color: "#818cf8" }}>{p.name}</span>
                  <span>{p.memories} mem · {p.tasks} tasks</span>
                </div>
              ))}
            </div>
          )}
          {tc.name === "get_project_stats" && !isError && (
            <div className="text-[11px] space-y-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
              <p>Memórias: <span style={{ color: "#fbbf24" }}>{String(res.memories)}</span> (validadas: {String(res.validated)})</p>
              <p>Tarefas abertas: <span style={{ color: "#fbbf24" }}>{String(res.openTasks)}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BrainMessage({ msg, onSpeak }: { msg: Message; onSpeak: (text: string) => void }) {
  const [showSources, setShowSources] = useState(false);
  const [showPath,    setShowPath]    = useState(false);
  const conf = msg.confidence ?? 0;
  const color = confidenceColor(conf);
  const convInfo = CONV_LABELS[msg.conversationType ?? "project"];

  const modeLabel = {
    semantic: { label: "Semântico", bg: "rgba(59,130,246,0.15)",  text: "#93c5fd", icon: "🔍" },
    inferred: { label: "Inferido",  bg: "rgba(139,92,246,0.15)",  text: "#c4b5fd", icon: "🕸" },
    agentic:  { label: "Agêntico",  bg: "rgba(16,185,129,0.15)",  text: "#6ee7b7", icon: "🤖" },
    web:      { label: "Web",       bg: "rgba(56,189,248,0.15)",  text: "#7dd3fc", icon: "🌐" },
  }[msg.mode ?? "semantic"];

  return (
    <div className="flex items-start gap-3 max-w-[90%]">
      <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs mt-0.5"
        style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
        🧠
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
          style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {msg.text}
        </div>

        {(msg.toolCalls ?? []).length > 0 && (
          <div className="space-y-1.5">
            {msg.toolCalls!.map((tc, i) => <ToolCallCard key={i} tc={tc} />)}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap px-1">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: modeLabel.bg, color: modeLabel.text }}>
            {modeLabel.icon} {modeLabel.label}
          </span>

          {msg.conversationType && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(255,255,255,0.06)", color: convInfo.color }}>
              {convInfo.icon} {convInfo.label}
            </span>
          )}

          {conf > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(conf * 100)}%`, background: color }} />
              </div>
              <span className="text-[10px] font-mono" style={{ color }}>{Math.round(conf * 100)}%</span>
            </div>
          )}

          {(msg.sources ?? []).length > 0 && (
            <button onClick={() => setShowSources(v => !v)}
              className="text-[10px] font-medium"
              style={{ color: showSources ? "#818cf8" : "rgba(255,255,255,0.3)" }}>
              Fontes ({msg.sources!.length}) {showSources ? "▲" : "▼"}
            </button>
          )}

          {(msg.path ?? []).length > 0 && (
            <button onClick={() => setShowPath(v => !v)}
              className="text-[10px] font-medium"
              style={{ color: showPath ? "#c4b5fd" : "rgba(255,255,255,0.3)" }}>
              Caminho ({msg.path!.length}) {showPath ? "▲" : "▼"}
            </button>
          )}

          <button onClick={() => onSpeak(msg.text)} title="Ouvir resposta"
            className="text-[11px] px-2 py-0.5 rounded-full hover:opacity-80 transition-opacity"
            style={{ background: "rgba(139,92,246,0.12)", color: "#c4b5fd" }}>
            🔊
          </button>
        </div>

        {showSources && (
          <div className="mx-1 rounded-xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {msg.sources!.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] last:border-0">
                <TypeBadge type={s.type} />
                <span className="flex-1 text-[11px] text-white/60 truncate">{s.title}</span>
                <span className="text-[10px] font-mono shrink-0" style={{ color: confidenceColor(s.similarity) }}>
                  {Math.round(s.similarity * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}

        {showPath && (
          <div className="mx-1 rounded-xl p-3 space-y-1.5"
            style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)" }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "rgba(139,92,246,0.7)" }}>
              Caminho de Raciocínio
            </p>
            {msg.path!.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[10px] font-mono w-4 shrink-0 mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>{i + 1}</span>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>{step}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Voice Hook ────────────────────────────────────────────────────────────────
function useVoice(onTranscript: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [speaking,  setSpeaking]  = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  const startListen = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { alert("Voz não suportada neste navegador. Use Chrome ou Edge."); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      onTranscript(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [onTranscript]);

  const stopListen = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "pt-BR";
    utt.rate = 1.05;
    utt.onstart  = () => setSpeaking(true);
    utt.onend    = () => setSpeaking(false);
    utt.onerror  = () => setSpeaking(false);
    window.speechSynthesis.speak(utt);
  }, []);

  const stopSpeak = useCallback(() => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { listening, speaking, startListen, stopListen, speak, stopSpeak };
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { listening, speaking, startListen, stopListen, speak, stopSpeak } = useVoice(
    useCallback((t: string) => setInput(prev => prev ? prev + " " + t : t), [])
  );

  useEffect(() => {
    api.get<Project[]>("/api/projects")
      .then(p => { setProjects(p); if (p.length > 0) setProject(p[0].slug); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const q = input.trim();
    if (!q || !project || loading) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text: q };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await api.post<{
        answer: string;
        mode: "semantic" | "agentic" | "web" | "inferred";
        confidence: number;
        path: string[];
        sources: Source[];
        toolCalls: ToolCall[];
        conversationType: "project" | "brainstorm" | "research" | "action";
      }>(`/api/projects/${project}/brain/chat`, { query: q });
      setMessages(prev => [...prev, {
        id: `b-${Date.now()}`, role: "brain",
        text: res.answer, mode: res.mode, confidence: res.confidence,
        sources: res.sources, path: res.path,
        toolCalls: res.toolCalls, conversationType: res.conversationType,
      }]);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : "Erro desconhecido";
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`, role: "brain",
        text: `Erro: ${err}`, mode: "semantic", confidence: 0,
        sources: [], path: [], toolCalls: [],
      }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  }

  const selStyle = {
    background: "rgba(8,12,30,0.8)",
    borderColor: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.75)",
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "calc(100vh - 6rem)" }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 mb-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
            <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4 text-white">
              <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H6l-4 3V5z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white tracking-tight">Chat Agêntico</h1>
            <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.28)" }}>
              IA com ferramentas · voz · web · cria tarefas e memórias
            </p>
          </div>
        </div>
        <select value={project} onChange={e => { setProject(e.target.value); setMessages([]); }}
          className="text-sm rounded-xl px-3 py-2 border outline-none shrink-0"
          style={selStyle}>
          <option value="">Projeto…</option>
          {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-5 pb-4" style={{ minHeight: "300px" }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px dashed rgba(99,102,241,0.2)" }}>
              🧠
            </div>
            <p className="text-sm font-medium mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>
              Segundo cérebro agêntico
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-xs">
              {["🌐 Pesquisa na web", "✅ Cria tarefas", "🧠 Salva memórias", "🔊 Fala a resposta", "💡 Brainstorm"].map(h => (
                <span key={h} className="text-[11px] px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[75%] px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.35),rgba(139,92,246,0.3))",
                  color: "#e0e7ff", border: "1px solid rgba(99,102,241,0.3)" }}>
                {msg.text}
              </div>
            ) : (
              <BrainMessage msg={msg} onSpeak={speak} />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs"
              style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
              🧠
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm space-y-1.5"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>Agente processando com ferramentas…</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {!project && (
          <p className="text-center text-sm mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
            Selecione um projeto para começar
          </p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={!project || loading}
            rows={3}
            placeholder={!project
              ? "Selecione um projeto acima"
              : listening
                ? "🎤 Ouvindo… fale agora"
                : "Digite ou clique no microfone… (Ctrl+Enter para enviar)"}
            className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none resize-none transition-all"
            style={{
              background: listening ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.04)",
              border: listening ? "1px solid rgba(99,102,241,0.45)" : "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)",
              lineHeight: "1.5",
            }}
          />
          <div className="flex flex-col gap-2 shrink-0">
            {/* Mic */}
            <button onClick={listening ? stopListen : startListen}
              disabled={!project || loading}
              title={listening ? "Parar gravação" : "Falar"}
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: listening ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)",
                border: listening ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.08)",
              }}>
              <span className="text-base">{listening ? "⏹" : "🎤"}</span>
            </button>

            {/* Stop speech */}
            {speaking && (
              <button onClick={stopSpeak} title="Parar voz"
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)" }}>
                <span className="text-base">🔇</span>
              </button>
            )}

            {/* Send */}
            <button onClick={send}
              disabled={!input.trim() || !project || loading}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold transition-all"
              style={{
                background: (!input.trim() || !project || loading)
                  ? "rgba(99,102,241,0.15)"
                  : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color: (!input.trim() || !project || loading) ? "rgba(165,180,252,0.4)" : "#fff",
                cursor: (!input.trim() || !project || loading) ? "not-allowed" : "pointer",
              }}>
              {loading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : "↑"}
            </button>
          </div>
        </div>
        <p className="text-[10px] mt-1.5 text-center" style={{ color: "rgba(255,255,255,0.18)" }}>
          Ctrl+Enter · 🎤 voz · 🌐 pesquisa web · ✅ tarefas · 🧠 memórias
        </p>
      </div>
    </div>
  );
}
