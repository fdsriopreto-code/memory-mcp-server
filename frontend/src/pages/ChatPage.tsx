import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../services/api";

// ── Types ─────────────────────────────────────────────────────────────────────
type Project = { id: string; name: string; slug: string; color: string };
type Source  = { id: string; title: string; type: string; similarity: number };
type ToolCall = { name: string; args: Record<string, unknown>; result: unknown };
type HistMsg = { role: "user" | "assistant"; content: string };

type Message = {
  id: string;
  role: "user" | "brain";
  text: string;
  mode?: "semantic" | "agentic" | "web" | "inferred";
  confidence?: number;
  sources?: Source[];
  toolCalls?: ToolCall[];
  conversationType?: "project" | "brainstorm" | "research" | "action";
};

// ── Markdown renderer ─────────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"]+/g;

function extractLinks(text: string): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  // [label](url)
  text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
    links.push({ text: label, url }); return "";
  });
  // bare urls
  text.replace(URL_RE, (url) => {
    if (!links.find(l => l.url === url)) links.push({ text: new URL(url).hostname, url });
    return "";
  });
  return links;
}

function renderInline(line: string): React.ReactNode[] {
  // Process in order: [label](url), bare url, **bold**, `code`
  const parts: React.ReactNode[] = [];
  let rest = line;
  let i = 0;

  while (rest.length > 0) {
    // [label](url)
    const mdLink = rest.match(/^(.*?)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/s);
    if (mdLink) {
      if (mdLink[1]) parts.push(renderBasicInline(mdLink[1], i++));
      parts.push(
        <a key={`ml${i++}`} href={mdLink[3]} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80"
          style={{ background: "rgba(56,189,248,0.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.2)", textDecoration: "none" }}>
          🔗 {mdLink[2]}
        </a>
      );
      rest = rest.slice(mdLink[0].length);
      continue;
    }
    // bare url
    const bUrl = rest.match(/^(.*?)(https?:\/\/[^\s<>"]+)/s);
    if (bUrl) {
      if (bUrl[1]) parts.push(renderBasicInline(bUrl[1], i++));
      const hostname = (() => { try { return new URL(bUrl[2]).hostname; } catch { return bUrl[2].slice(0,30); } })();
      parts.push(
        <a key={`bu${i++}`} href={bUrl[2]} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-all hover:opacity-80"
          style={{ background: "rgba(56,189,248,0.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.2)", textDecoration: "none" }}>
          🌐 {hostname}
        </a>
      );
      rest = rest.slice(bUrl[0].length);
      continue;
    }
    parts.push(renderBasicInline(rest, i++));
    rest = "";
  }
  return parts;
}

function renderBasicInline(text: string, key: number): React.ReactNode {
  // **bold** and `code`
  const segments: React.ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length > 0) {
    const bold = rest.match(/^(.*?)\*\*(.+?)\*\*/s);
    if (bold) {
      if (bold[1]) segments.push(<span key={`t${key}${i++}`}>{bold[1]}</span>);
      segments.push(<strong key={`b${key}${i++}`} className="font-semibold text-white">{bold[2]}</strong>);
      rest = rest.slice(bold[0].length); continue;
    }
    const code = rest.match(/^(.*?)`([^`]+)`/s);
    if (code) {
      if (code[1]) segments.push(<span key={`t${key}${i++}`}>{code[1]}</span>);
      segments.push(
        <code key={`c${key}${i++}`} className="px-1.5 py-0.5 rounded text-[11px] font-mono"
          style={{ background: "rgba(255,255,255,0.08)", color: "#e2e8f0" }}>
          {code[2]}
        </code>
      );
      rest = rest.slice(code[0].length); continue;
    }
    segments.push(<span key={`t${key}${i++}`}>{rest}</span>);
    rest = "";
  }
  return <>{segments}</>;
}

function MarkdownMessage({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.replace(/```/, "").trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]); i++;
      }
      blocks.push(
        <div key={`code${i}`} className="rounded-xl overflow-hidden my-2"
          style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {lang && (
            <div className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wide"
              style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {lang}
            </div>
          )}
          <pre className="px-4 py-3 text-[12px] overflow-x-auto leading-relaxed"
            style={{ color: "#e2e8f0", margin: 0 }}>
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      i++; continue;
    }

    // Heading
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h1 || h2 || h3) {
      const txt = (h1 || h2 || h3)![1];
      const size = h1 ? "text-base" : h2 ? "text-[14px]" : "text-[13px]";
      blocks.push(
        <p key={`h${i}`} className={`${size} font-bold text-white mt-3 mb-1`}>
          {renderInline(txt)}
        </p>
      );
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr${i}`} className="my-3" style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)" }} />);
      i++; continue;
    }

    // Bullet list — collect consecutive items
    if (/^[-*•]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(
          <li key={`li${i}`} className="flex items-start gap-2 text-[13px] leading-relaxed"
            style={{ color: "rgba(255,255,255,0.75)" }}>
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#6366f1" }} />
            <span className="flex-1">{renderInline(lines[i].replace(/^[-*•]\s/, ""))}</span>
          </li>
        );
        i++;
      }
      blocks.push(<ul key={`ul${i}`} className="space-y-1 my-2 ml-1 list-none">{items}</ul>);
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(
          <li key={`li${i}`} className="flex items-start gap-2.5 text-[13px] leading-relaxed"
            style={{ color: "rgba(255,255,255,0.75)" }}>
            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
              style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>{num++}</span>
            <span className="flex-1">{renderInline(lines[i].replace(/^\d+\.\s/, ""))}</span>
          </li>
        );
        i++;
      }
      blocks.push(<ol key={`ol${i}`} className="space-y-1.5 my-2 ml-1 list-none">{items}</ol>);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      blocks.push(
        <div key={`bq${i}`} className="flex gap-2 my-2">
          <div className="w-0.5 rounded-full shrink-0" style={{ background: "rgba(99,102,241,0.5)" }} />
          <p className="text-[13px] leading-relaxed italic" style={{ color: "rgba(255,255,255,0.55)" }}>
            {renderInline(line.slice(2))}
          </p>
        </div>
      );
      i++; continue;
    }

    // Empty line → spacing
    if (!line.trim()) {
      if (blocks.length > 0) blocks.push(<div key={`sp${i}`} className="h-1" />);
      i++; continue;
    }

    // Normal paragraph
    blocks.push(
      <p key={`p${i}`} className="text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

// ── Tool card colors ──────────────────────────────────────────────────────────
const TOOL_META: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  web_search:        { icon: "🌐", label: "Pesquisa Web",     color: "#38bdf8", bg: "rgba(56,189,248,0.08)" },
  create_task:       { icon: "✅", label: "Tarefa criada",    color: "#34d399", bg: "rgba(52,211,153,0.08)" },
  create_memory:     { icon: "🧠", label: "Memória salva",    color: "#a78bfa", bg: "rgba(167,139,250,0.08)" },
  list_projects:     { icon: "📁", label: "Listou projetos",  color: "#818cf8", bg: "rgba(129,140,248,0.08)" },
  get_project_stats: { icon: "📊", label: "Stats do projeto", color: "#fbbf24", bg: "rgba(251,191,36,0.08)" },
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
  if (c >= 0.8) return "#10b981"; if (c >= 0.5) return "#f59e0b"; return "#ef4444";
}

// ── Tool Call Card ─────────────────────────────────────────────────────────────
function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[tc.name] ?? { icon: "🔧", label: tc.name, color: "#9ca3af", bg: "rgba(255,255,255,0.04)" };
  const res  = tc.result as Record<string, unknown>;
  const isError = typeof res?.error === "string";

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{ background: isError ? "rgba(239,68,68,0.06)" : meta.bg, border: `1px solid ${isError ? "rgba(239,68,68,0.2)" : `${meta.color}25`}` }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
        <span className="text-base shrink-0">{meta.icon}</span>
        <span className="text-[12px] font-semibold flex-1 min-w-0 truncate"
          style={{ color: isError ? "#fca5a5" : meta.color }}>
          {isError ? `Erro: ${res.error}` : meta.label}
        </span>
        {tc.name === "web_search" && !isError && (
          <span className="text-[10px] shrink-0 px-2 py-0.5 rounded-full"
            style={{ background: "rgba(56,189,248,0.1)", color: "#38bdf8" }}>
            {((res?.results as unknown[]) ?? []).length} resultados
          </span>
        )}
        {tc.name === "create_task" && !isError && (
          <span className="text-[10px] shrink-0 font-mono px-2 py-0.5 rounded-full"
            style={{ background: "rgba(52,211,153,0.1)", color: "#34d399" }}>
            {String(res.priority ?? "MEDIUM")}
          </span>
        )}
        <span className="text-[10px] shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t" style={{ borderColor: `${meta.color}15` }}>
          {/* Web search results */}
          {tc.name === "web_search" && !isError && (
            <div className="space-y-2 pt-2">
              {!!res.answer && (
                <div className="rounded-lg px-3 py-2 text-[12px] leading-relaxed"
                  style={{ background: "rgba(56,189,248,0.07)", color: "#bae6fd", border: "1px solid rgba(56,189,248,0.15)" }}>
                  <span className="font-semibold text-sky-300 block mb-1 text-[10px] uppercase tracking-widest">Síntese</span>
                  {String(res.answer)}
                </div>
              )}
              {((res.results ?? []) as { title: string; url: string; snippet: string }[]).map((r, i) => (
                <div key={i} className="rounded-lg p-2.5 space-y-1"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] shrink-0 mt-0.5 opacity-50">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium leading-tight mb-1" style={{ color: "rgba(255,255,255,0.8)" }}>
                        {r.title}
                      </p>
                      <p className="text-[11px] leading-relaxed" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {r.snippet}
                      </p>
                    </div>
                  </div>
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all hover:opacity-80"
                    style={{ background: "rgba(56,189,248,0.1)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.2)", textDecoration: "none" }}>
                    🔗 {(() => { try { return new URL(r.url).hostname; } catch { return r.url.slice(0, 30); } })()}
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* Task created */}
          {tc.name === "create_task" && !isError && (
            <div className="pt-2 flex items-center gap-2">
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Criado:</span>
              <span className="text-[12px] font-medium" style={{ color: "#34d399" }}>{String(res.title)}</span>
            </div>
          )}

          {/* Memory */}
          {tc.name === "create_memory" && !isError && (
            <div className="pt-2 flex items-center gap-2">
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>Salvo:</span>
              <span className="text-[12px] font-medium" style={{ color: "#a78bfa" }}>{String(res.title)}</span>
            </div>
          )}

          {/* Projects */}
          {tc.name === "list_projects" && !isError && (
            <div className="pt-2 grid grid-cols-1 gap-1.5">
              {((res as unknown) as { name: string; memories: number; tasks: number }[]).map((p, i) => (
                <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[12px] font-medium" style={{ color: "#818cf8" }}>{p.name}</span>
                  <div className="flex gap-2 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    <span>🧠 {p.memories}</span>
                    <span>✅ {p.tasks}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stats */}
          {tc.name === "get_project_stats" && !isError && (
            <div className="pt-2 grid grid-cols-3 gap-2">
              {[
                { label: "Memórias", value: String(res.memories), color: "#a78bfa" },
                { label: "Validadas", value: String(res.validated), color: "#34d399" },
                { label: "Tasks abertas", value: String(res.openTasks), color: "#fbbf24" },
              ].map(s => (
                <div key={s.label} className="rounded-lg p-2 text-center"
                  style={{ background: "rgba(255,255,255,0.03)" }}>
                  <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TTS Hook ──────────────────────────────────────────────────────────────────
function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("mcp_token") : null;

  const speak = useCallback(async (text: string, voice = "nova") => {
    if (!text.trim()) return;
    stopSpeak();

    // Try OpenAI TTS via backend
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text, voice }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        setSpeaking(true);
        audio.onended  = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        audio.onerror  = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch { /* fallback */ }

    // Fallback: Web Speech API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    if (!synth) return;
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang  = "pt-BR";
    utt.rate  = 1.05;
    utt.pitch = 1.1;
    utt.onstart = () => setSpeaking(true);
    utt.onend   = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    // Try to find a better voice
    const voices = synth.getVoices();
    const ptVoice = voices.find(v => v.lang.startsWith("pt")) ?? voices.find(v => v.lang.startsWith("en-US"));
    if (ptVoice) utt.voice = ptVoice;
    synth.speak(utt);
  }, [token]);

  const stopSpeak = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const synth = (window as any).speechSynthesis as SpeechSynthesis | undefined;
    synth?.cancel();
    setSpeaking(false);
  }, []);

  return { speaking, speak, stopSpeak };
}

// ── Voice Input Hook ──────────────────────────────────────────────────────────
function useVoiceInput(onTranscript: (t: string) => void) {
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  const startListen = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { alert("Microfone não suportado neste navegador. Use Chrome ou Edge."); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR();
    rec.lang = "pt-BR"; rec.continuous = false; rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => onTranscript(e.results[0][0].transcript as string);
    rec.onend    = () => setListening(false);
    rec.onerror  = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  }, [onTranscript]);

  const stopListen = useCallback(() => { recRef.current?.stop(); setListening(false); }, []);
  return { listening, startListen, stopListen };
}

// ── Brain Message ──────────────────────────────────────────────────────────────
const MODE_INFO = {
  semantic: { label: "Memória",   bg: "rgba(59,130,246,0.12)",  color: "#93c5fd", icon: "🔍" },
  inferred: { label: "Inferido",  bg: "rgba(139,92,246,0.12)",  color: "#c4b5fd", icon: "🕸" },
  agentic:  { label: "Agente",    bg: "rgba(16,185,129,0.12)",  color: "#6ee7b7", icon: "🤖" },
  web:      { label: "Web",       bg: "rgba(56,189,248,0.12)",  color: "#7dd3fc", icon: "🌐" },
};

const CONV_INFO = {
  project:    { icon: "📁", color: "#818cf8" },
  brainstorm: { icon: "💡", color: "#a78bfa" },
  research:   { icon: "🌐", color: "#38bdf8" },
  action:     { icon: "⚡", color: "#34d399" },
};

function BrainMessage({ msg, onSpeak }: { msg: Message; onSpeak: (t: string) => void }) {
  const [showSources, setShowSources] = useState(false);
  const conf = msg.confidence ?? 0;
  const confColor = confidenceColor(conf);
  const modeI = MODE_INFO[msg.mode ?? "semantic"];
  const convI = CONV_INFO[msg.conversationType ?? "project"];

  return (
    <div className="flex items-start gap-2.5 max-w-full">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs mt-0.5"
        style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
        🧠
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Bubble */}
        <div className="rounded-2xl rounded-tl-sm px-4 py-3"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <MarkdownMessage text={msg.text} />
        </div>

        {/* Tool calls */}
        {(msg.toolCalls ?? []).length > 0 && (
          <div className="space-y-1.5">
            {msg.toolCalls!.map((tc, i) => <ToolCallCard key={i} tc={tc} />)}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-1.5 flex-wrap px-1">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: modeI.bg, color: modeI.color }}>
            {modeI.icon} {modeI.label}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.05)", color: convI.color }}>
            {convI.icon}
          </span>

          {conf > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(conf * 100)}%`, background: confColor }} />
              </div>
              <span className="text-[9px] font-mono" style={{ color: confColor }}>{Math.round(conf * 100)}%</span>
            </div>
          )}

          {(msg.sources ?? []).length > 0 && (
            <button onClick={() => setShowSources(v => !v)}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-all"
              style={{ background: showSources ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)", color: showSources ? "#818cf8" : "rgba(255,255,255,0.3)" }}>
              📚 {msg.sources!.length}
            </button>
          )}

          <button onClick={() => onSpeak(msg.text)} title="Ouvir"
            className="text-[10px] px-1.5 py-0.5 rounded-full transition-all hover:opacity-80"
            style={{ background: "rgba(139,92,246,0.1)", color: "#c4b5fd" }}>
            🔊
          </button>
        </div>

        {/* Sources */}
        {showSources && (
          <div className="mx-1 rounded-xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {msg.sources!.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] last:border-0">
                <TypeBadge type={s.type} />
                <span className="flex-1 text-[11px] truncate" style={{ color: "rgba(255,255,255,0.55)" }}>{s.title}</span>
                <span className="text-[10px] font-mono shrink-0" style={{ color: confidenceColor(s.similarity) }}>
                  {Math.round(s.similarity * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Voice selector ─────────────────────────────────────────────────────────────
const VOICES = [
  { id: "nova",    label: "Nova",    desc: "Feminina, calorosa"   },
  { id: "shimmer", label: "Shimmer", desc: "Feminina, suave"      },
  { id: "alloy",   label: "Alloy",   desc: "Neutra, clara"        },
  { id: "echo",    label: "Echo",    desc: "Masculina, grave"     },
  { id: "onyx",    label: "Onyx",    desc: "Masculina, profunda"  },
  { id: "fable",   label: "Fable",   desc: "Britânica, expressiva" },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project,  setProject]  = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [voice,    setVoice]    = useState("nova");
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { speaking, speak, stopSpeak } = useTTS();
  const { listening, startListen, stopListen } = useVoiceInput(
    useCallback((t: string) => setInput(prev => prev ? `${prev} ${t}` : t), [])
  );

  useEffect(() => {
    api.get<Project[]>("/api/projects")
      .then(p => { setProjects(p); if (p.length > 0) setProject(p[0].slug); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Build session history for API
  function buildHistory(): HistMsg[] {
    return messages
      .filter(m => m.role !== "brain" || m.text)
      .slice(-20)
      .map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
  }

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
        sources: Source[];
        toolCalls: ToolCall[];
        conversationType: "project" | "brainstorm" | "research" | "action";
      }>(`/api/projects/${project}/brain/chat`, { query: q, history: buildHistory() });

      setMessages(prev => [...prev, {
        id: `b-${Date.now()}`, role: "brain",
        text: res.answer, mode: res.mode,
        confidence: res.confidence, sources: res.sources,
        toolCalls: res.toolCalls, conversationType: res.conversationType,
      }]);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : "Erro desconhecido";
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`, role: "brain",
        text: `Erro: ${err}`, mode: "semantic", confidence: 0, sources: [], toolCalls: [],
      }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  }

  const selStyle: React.CSSProperties = {
    background: "rgba(8,12,30,0.8)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.75)",
    borderRadius: "0.75rem",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    outline: "none",
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 8rem)" }}>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
            <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4 text-white">
              <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H6l-4 3V5z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-white tracking-tight leading-tight">Chat Agêntico</h1>
            <p className="text-[10px] hidden sm:block" style={{ color: "rgba(255,255,255,0.28)" }}>
              IA com memória · voz HD · web · cria tarefas
            </p>
          </div>
        </div>

        {/* Voice picker */}
        <div className="relative">
          <button onClick={() => setShowVoicePicker(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all"
            style={{ background: speaking ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.05)", color: speaking ? "#c4b5fd" : "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {speaking ? "🔊" : "🎙"} {voice}
          </button>
          {showVoicePicker && (
            <div className="absolute right-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-xl"
              style={{ background: "#0d1224", border: "1px solid rgba(255,255,255,0.1)", width: "180px" }}>
              {VOICES.map(v => (
                <button key={v.id}
                  onClick={() => { setVoice(v.id); setShowVoicePicker(false); }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 text-left transition-all hover:bg-white/5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold" style={{ color: v.id === voice ? "#818cf8" : "rgba(255,255,255,0.75)" }}>
                      {v.label} {v.id === voice && "✓"}
                    </p>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{v.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {speaking && (
          <button onClick={stopSpeak}
            className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium"
            style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }}>
            🔇 Parar
          </button>
        )}

        <select value={project} onChange={e => { setProject(e.target.value); setMessages([]); }} style={selStyle}>
          <option value="">Projeto…</option>
          {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>

        {messages.length > 0 && (
          <button onClick={() => setMessages([])}
            className="px-2.5 py-1.5 rounded-xl text-[11px]"
            style={{ background: "rgba(239,68,68,0.08)", color: "rgba(239,68,68,0.6)", border: "1px solid rgba(239,68,68,0.15)" }}>
            Limpar
          </button>
        )}
      </div>

      {/* Click outside voice picker */}
      {showVoicePicker && <div className="fixed inset-0 z-40" onClick={() => setShowVoicePicker(false)} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2 pr-1" style={{ overscrollBehavior: "contain" }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px dashed rgba(99,102,241,0.2)" }}>
              🧠
            </div>
            <p className="text-sm font-semibold mb-3 text-white/60">Segundo cérebro agêntico</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-xs">
              {["🌐 Pesquisa web", "✅ Cria tarefas", "🧠 Salva memórias", "🔊 Voz HD", "💡 Brainstorm", "📊 Analisa projetos"].map(h => (
                <button key={h} onClick={() => setInput(h.replace(/^[^\s]+ /, ""))}
                  className="text-[11px] px-2.5 py-1 rounded-full transition-all hover:opacity-80"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[80%] sm:max-w-[70%] px-4 py-3 rounded-2xl rounded-tr-sm text-[13px] leading-relaxed"
                style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.35),rgba(139,92,246,0.28))",
                  color: "#e0e7ff", border: "1px solid rgba(99,102,241,0.3)" }}>
                {msg.text}
              </div>
            ) : (
              <div className="max-w-full sm:max-w-[90%] w-full">
                <BrainMessage msg={msg} onSpeak={(t) => speak(t, voice)} />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs"
              style={{ background: "linear-gradient(135deg,#ec4899,#8b5cf6)" }}>
              🧠
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-1.5 mb-1">
                {[0, 150, 300].map(d => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: ["#6366f1", "#8b5cf6", "#ec4899"][d / 150], animationDelay: `${d}ms` }} />
                ))}
              </div>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>Agente processando…</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {!project && (
          <p className="text-center text-sm mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
            Selecione um projeto acima
          </p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={!project || loading}
            rows={2}
            placeholder={!project ? "Selecione um projeto" : listening ? "🎤 Ouvindo…" : "Pergunte, peça pesquisa, crie tarefas… (Ctrl+Enter)"}
            className="flex-1 px-3.5 py-2.5 rounded-2xl text-[13px] outline-none resize-none transition-all"
            style={{
              background: listening ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.04)",
              border: listening ? "1px solid rgba(99,102,241,0.45)" : "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)", lineHeight: "1.5",
            }}
          />
          <div className="flex flex-col gap-1.5 shrink-0">
            {/* Mic */}
            <button onClick={listening ? stopListen : startListen}
              disabled={!project || loading} title={listening ? "Parar" : "Falar"}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: listening ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                border: listening ? "1px solid rgba(239,68,68,0.35)" : "1px solid rgba(255,255,255,0.08)",
              }}>
              <span className="text-base">{listening ? "⏹" : "🎤"}</span>
            </button>
            {/* Send */}
            <button onClick={send}
              disabled={!input.trim() || !project || loading}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold transition-all"
              style={{
                background: !input.trim() || !project || loading ? "rgba(99,102,241,0.12)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color: !input.trim() || !project || loading ? "rgba(165,180,252,0.35)" : "#fff",
                cursor: !input.trim() || !project || loading ? "not-allowed" : "pointer",
              }}>
              {loading
                ? <span className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                : "↑"}
            </button>
          </div>
        </div>
        <p className="text-[9px] mt-1.5 text-center" style={{ color: "rgba(255,255,255,0.15)" }}>
          Ctrl+Enter · 🎤 voz · memória de sessão · voz HD via OpenAI
        </p>
      </div>
    </div>
  );
}
