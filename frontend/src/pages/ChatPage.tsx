import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

type Project = { id: string; name: string; slug: string; color: string };

type Source = { id: string; title: string; type: string; similarity: number };

type Message = {
  id: string;
  role: "user" | "brain";
  text: string;
  mode?: "semantic" | "inferred";
  confidence?: number;
  sources?: Source[];
  path?: string[];
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

function BrainMessage({ msg }: { msg: Message }) {
  const [showSources, setShowSources] = useState(false);
  const [showPath,    setShowPath]    = useState(false);
  const conf = msg.confidence ?? 0;
  const color = confidenceColor(conf);

  return (
    <div className="flex items-start gap-3 max-w-[85%]">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs mt-0.5"
        style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
        🧠
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Bubble */}
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
          style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {msg.text}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 flex-wrap px-1">
          {/* Mode badge */}
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={msg.mode === "inferred"
              ? { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" }
              : { background: "rgba(59,130,246,0.15)", color: "#93c5fd" }}>
            {msg.mode === "inferred" ? "🕸 Inferido" : "🔍 Semântico"}
          </span>

          {/* Confidence bar */}
          {conf > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(conf * 100)}%`, background: color }} />
              </div>
              <span className="text-[10px] font-mono" style={{ color }}>
                {Math.round(conf * 100)}%
              </span>
            </div>
          )}

          {/* Sources toggle */}
          {(msg.sources ?? []).length > 0 && (
            <button onClick={() => setShowSources(v => !v)}
              className="text-[10px] font-medium transition-colors"
              style={{ color: showSources ? "#818cf8" : "rgba(255,255,255,0.3)" }}>
              Fontes ({msg.sources!.length}) {showSources ? "▲" : "▼"}
            </button>
          )}

          {/* Path toggle */}
          {(msg.path ?? []).length > 0 && (
            <button onClick={() => setShowPath(v => !v)}
              className="text-[10px] font-medium transition-colors"
              style={{ color: showPath ? "#c4b5fd" : "rgba(255,255,255,0.3)" }}>
              Raciocínio ({msg.path!.length}) {showPath ? "▲" : "▼"}
            </button>
          )}
        </div>

        {/* Sources list */}
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

        {/* Path reasoning */}
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

export default function ChatPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        mode: "semantic" | "inferred";
        confidence: number;
        path: string[];
        sources: Source[];
      }>(`/api/projects/${project}/brain/chat`, { query: q });

      const brainMsg: Message = {
        id: `b-${Date.now()}`,
        role: "brain",
        text: res.answer,
        mode: res.mode,
        confidence: res.confidence,
        sources: res.sources,
        path: res.path,
      };
      setMessages(prev => [...prev, brainMsg]);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : "Erro desconhecido";
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`, role: "brain",
        text: `Erro: ${err}`,
        mode: "semantic", confidence: 0, sources: [], path: [],
      }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  }

  const selStyle = {
    background: "rgba(8,12,30,0.8)",
    borderColor: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.75)",
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "calc(100vh - 6rem)" }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4 mb-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
            <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4 text-white">
              <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H6l-4 3V5z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Chat com o Brain</h1>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.28)" }}>
              Busca semântica + raciocínio pelo grafo de conhecimento
            </p>
          </div>
        </div>
        <select value={project} onChange={e => { setProject(e.target.value); setMessages([]); }}
          className="text-sm rounded-xl px-3 py-2 border outline-none"
          style={selStyle}>
          <option value="">Selecionar projeto…</option>
          {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-5 pb-4" style={{ minHeight: "400px" }}>

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px dashed rgba(99,102,241,0.2)" }}>
              🧠
            </div>
            <p className="text-sm font-medium mb-2" style={{ color: "rgba(255,255,255,0.5)" }}>
              Faça uma pergunta ao seu segundo cérebro
            </p>
            <p className="text-xs max-w-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
              Ele vai buscar nas memórias e raciocinar pelo grafo de conhecimento.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[75%] px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.35),rgba(139,92,246,0.3))",
                  color: "#e0e7ff", border: "1px solid rgba(99,102,241,0.3)" }}>
                {msg.text}
              </div>
            ) : (
              <BrainMessage msg={msg} />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs"
              style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
              🧠
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: "300ms" }} />
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
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={!project || loading}
            rows={3}
            placeholder={project ? "Digite sua pergunta… (Ctrl+Enter para enviar)" : "Selecione um projeto acima"}
            className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none resize-none transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)",
              lineHeight: "1.5",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || !project || loading}
            className="px-5 py-3 rounded-2xl text-sm font-semibold transition-all shrink-0"
            style={{
              background: (!input.trim() || !project || loading)
                ? "rgba(99,102,241,0.15)"
                : "linear-gradient(135deg,#6366f1,#8b5cf6)",
              color: (!input.trim() || !project || loading) ? "rgba(165,180,252,0.4)" : "#fff",
              cursor: (!input.trim() || !project || loading) ? "not-allowed" : "pointer",
            }}>
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
            ) : "Enviar"}
          </button>
        </div>
        <p className="text-[10px] mt-1.5 text-center" style={{ color: "rgba(255,255,255,0.18)" }}>
          Ctrl+Enter para enviar rapidamente
        </p>
      </div>
    </div>
  );
}
