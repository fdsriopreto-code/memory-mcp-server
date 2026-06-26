import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";

// ── Types ─────────────────────────────────────────────────────────────────────
type Project  = { id: string; name: string; slug: string; color: string };
type Source   = { id: string; title: string; type: string; similarity: number };
type ToolCall = { name: string; args: Record<string, unknown>; result: unknown };
type HistMsg  = { role: "user" | "assistant"; content: string };
type OracleState = "idle" | "listening" | "thinking" | "speaking" | "error";

type AttachFile = {
  id: string; name: string; mimeType: string;
  data: string; preview?: string;
  kind: "image" | "text" | "doc";
};

type Message = {
  id: string; role: "user" | "brain"; text: string;
  mode?: "semantic"|"agentic"|"web"|"inferred";
  confidence?: number; sources?: Source[]; toolCalls?: ToolCall[];
  conversationType?: "project"|"brainstorm"|"research"|"action";
  attachments?: { name: string; kind: string; preview?: string }[];
};

// ── Oracle config ─────────────────────────────────────────────────────────────
const ORACLE_CFG: Record<OracleState, { c1:string; c2:string; ring:string; glow:string; label:string; s1:number; s2:number; s3:number }> = {
  idle:      { c1:"#6366f1", c2:"#4338ca", ring:"rgba(99,102,241,0.4)",  glow:"rgba(99,102,241,0.3)",   label:"Toque para conversar",         s1:6,   s2:9,   s3:12  },
  listening: { c1:"#06b6d4", c2:"#0284c7", ring:"rgba(6,182,212,0.5)",   glow:"rgba(6,182,212,0.45)",   label:"Ouvindo...",                   s1:2.5, s2:3.5, s3:2   },
  thinking:  { c1:"#f59e0b", c2:"#b45309", ring:"rgba(245,158,11,0.45)", glow:"rgba(245,158,11,0.4)",   label:"Pensando...",                  s1:1.5, s2:2,   s3:2.5 },
  speaking:  { c1:"#10b981", c2:"#047857", ring:"rgba(16,185,129,0.45)", glow:"rgba(16,185,129,0.4)",   label:"Falando...",                   s1:3,   s2:4,   s3:2.5 },
  error:     { c1:"#ef4444", c2:"#b91c1c", ring:"rgba(239,68,68,0.4)",   glow:"rgba(239,68,68,0.3)",    label:"Toque para tentar novamente",  s1:5,   s2:7,   s3:9   },
};

const CORE_ANIM: Record<OracleState, string> = {
  idle:      "oracle-core-pulse 3.5s ease-in-out infinite",
  listening: "oracle-listen-wave 1.2s ease-in-out infinite",
  thinking:  "oracle-core-think 0.9s ease-in-out infinite",
  speaking:  "oracle-core-speak 0.7s ease-in-out infinite",
  error:     "oracle-core-pulse 2s ease-in-out infinite",
};

// ── Oracle Ball component ──────────────────────────────────────────────────────
function OracleBall({ state, size = 180, onClick }: {
  state: OracleState; size?: number; onClick?: () => void;
}) {
  const cfg = ORACLE_CFG[state];
  const ringInset = size * 0.08;
  const coreInset = size * 0.22;

  const ringBase = (inset: number, rotX: number, rotY: number, speed: number, rev = false): React.CSSProperties => ({
    position: "absolute", inset,
    borderRadius: "50%",
    border: `1.5px solid ${cfg.ring}`,
    transform: `rotateX(${rotX}deg) rotateY(${rotY}deg)`,
    animation: `oracle-spin-${rev ? 3 : 1} ${speed}s linear infinite${rev ? " reverse" : ""}`,
    transition: "border-color 0.8s ease",
  });

  const dotBase = (color: string, sz = 7): React.CSSProperties => ({
    position: "absolute", top: -4, left: "50%",
    transform: "translateX(-50%)",
    width: sz, height: sz, borderRadius: "50%",
    background: color,
    boxShadow: `0 0 10px 3px ${color}99`,
    transition: "background 0.8s ease, box-shadow 0.8s ease",
  });

  return (
    <button onClick={onClick}
      className="relative focus:outline-none select-none"
      style={{ width: size, height: size, cursor: onClick ? "pointer" : "default" }}>

      {/* Outer aura glow */}
      <div style={{
        position:"absolute", inset: -size*0.12, borderRadius:"50%",
        background: cfg.glow, filter:`blur(${size*0.22}px)`,
        animation:"oracle-glow-pulse 2.5s ease-in-out infinite",
        transition:"background 0.8s ease",
      }}/>

      {/* 3D rings */}
      <div style={{ position:"absolute", inset:0, perspective:`${size*5}px`, perspectiveOrigin:"center" }}>
        <div style={ringBase(ringInset, 72, 0, cfg.s1)}>
          <div style={dotBase(cfg.c1)}/>
        </div>
        <div style={ringBase(ringInset+2, 25, 65, cfg.s2, true)}>
          <div style={dotBase(cfg.c2)}/>
        </div>
        <div style={{ ...ringBase(ringInset+size*0.06, -68, 0, cfg.s3), opacity:0.55 }}>
          <div style={dotBase(cfg.c1, 5)}/>
        </div>
      </div>

      {/* Core sphere */}
      <div style={{
        position:"absolute", inset:coreInset, borderRadius:"50%", zIndex:10,
        background:`radial-gradient(circle at 35% 28%, rgba(255,255,255,0.45) 0%, ${cfg.c1} 35%, ${cfg.c2} 100%)`,
        boxShadow:`0 0 ${size*0.15}px ${cfg.glow}, 0 0 ${size*0.3}px ${cfg.glow}55, inset 0 0 ${size*0.1}px rgba(255,255,255,0.12)`,
        animation: CORE_ANIM[state],
        transition:"background 0.8s ease, box-shadow 0.8s ease",
      }}/>

      {/* Glass highlight */}
      <div style={{
        position:"absolute", borderRadius:"50%", zIndex:11,
        width:size*0.14, height:size*0.09,
        top:"31%", left:"35%",
        background:"rgba(255,255,255,0.5)",
        filter:"blur(4px)",
        transform:"rotate(-20deg)",
      }}/>
    </button>
  );
}

// ── Oracle Mode overlay ────────────────────────────────────────────────────────
function OracleMode({ project, voice, messages, onClose, onAddMessages }: {
  project: string; voice: string; messages: Message[];
  onClose: () => void;
  onAddMessages: (msgs: Message[]) => void;
}) {
  const [oState, setOState] = useState<OracleState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [lastResp, setLastResp] = useState("");
  const [isActive, setIsActive] = useState(false);

  const recRef      = useRef<unknown>(null);
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const accRef      = useRef("");
  const silRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActRef    = useRef(false);
  const token       = localStorage.getItem("mcp_token");

  function clearSil() { if (silRef.current) { clearTimeout(silRef.current); silRef.current = null; } }

  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).speechSynthesis?.cancel();
  }

  async function speakTTS(text: string): Promise<void> {
    stopAudio(); setOState("speaking"); setLastResp(text);
    return new Promise(resolve => {
      fetch("/api/tts", {
        method:"POST",
        headers:{ "Content-Type":"application/json", ...(token?{ Authorization:`Bearer ${token}` }:{}) },
        body: JSON.stringify({ text: text.slice(0, 1500), voice }),
      }).then(r => { if (!r.ok) throw new Error(); return r.blob(); })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url); audioRef.current = audio;
          audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(resolve);
        }).catch(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = (window as any).speechSynthesis as SpeechSynthesis | undefined;
          if (!s) { resolve(); return; }
          s.cancel(); const u = new SpeechSynthesisUtterance(text.slice(0,500));
          u.lang = "pt-BR"; u.onend = () => resolve(); u.onerror = () => resolve(); s.speak(u);
        });
    });
  }

  async function sendQuery(text: string) {
    if (!text.trim() || !project) return;
    setOState("thinking");
    const userMsg: Message = { id:`u-${Date.now()}`, role:"user", text };
    const history = messages.slice(-10).map(m => ({ role:(m.role==="user"?"user":"assistant") as "user"|"assistant", content:m.text }));
    try {
      const res = await api.post<{ answer:string; mode:string; confidence:number; sources:Source[]; toolCalls:ToolCall[]; conversationType:string }>(
        `/api/projects/${project}/brain/chat`, { query:text, history }
      );
      const brainMsg: Message = {
        id:`b-${Date.now()}`, role:"brain", text:res.answer,
        mode:res.mode as Message["mode"], confidence:res.confidence,
        sources:res.sources, toolCalls:res.toolCalls,
        conversationType:res.conversationType as Message["conversationType"],
      };
      onAddMessages([userMsg, brainMsg]);
      await speakTTS(res.answer);
    } catch { setOState("error"); onAddMessages([userMsg, { id:`e-${Date.now()}`, role:"brain", text:"Não consegui responder. Tente novamente." }]); return; }
    if (isActRef.current) { setOState("listening"); startListening(); }
  }

  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any; const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { setOState("error"); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR(); rec.lang="pt-BR"; rec.continuous=true; rec.interimResults=true;
    accRef.current = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      if (audioRef.current) stopAudio(); // interrupt TTS
      setOState("listening"); clearSil();
      let fin=""; let int="";
      for (let i=e.resultIndex; i<e.results.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = e.results[i];
        if (r.isFinal) fin += r[0].transcript as string;
        else int += r[0].transcript as string;
      }
      if (fin) { accRef.current += fin+" "; setTranscript(accRef.current.trim()); }
      setInterim(int);
      silRef.current = setTimeout(async () => {
        const txt = accRef.current.trim();
        if (!txt) return;
        accRef.current = ""; setTranscript(""); setInterim("");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rec as any).stop?.();
        await sendQuery(txt);
      }, 1600);
    };
    rec.onerror = () => { if (isActRef.current) { setOState("listening"); startListening(); } };
    rec.onend   = () => { /* auto restart handled by sendQuery */ };
    recRef.current = rec;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rec as any).start?.(); setOState("listening");
  }

  function toggleOracle() {
    if (!isActive) {
      isActRef.current = true; setIsActive(true); startListening();
    } else {
      isActRef.current = false; setIsActive(false);
      clearSil(); stopAudio();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recRef.current as any)?.stop?.();
      setOState("idle"); setTranscript(""); setInterim(""); setLastResp("");
    }
  }

  useEffect(() => () => {
    isActRef.current = false; clearSil(); stopAudio();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recRef.current as any)?.stop?.();
  }, []);

  const displayText = transcript || interim || (oState==="speaking" ? lastResp.slice(0,140)+(lastResp.length>140?"…":"") : "");

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background:"radial-gradient(ellipse at center, rgba(18,20,45,0.98) 0%, rgba(4,5,12,0.99) 100%)" }}>

      <button onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-sm"
        style={{ background:"rgba(255,255,255,0.06)", color:"rgba(255,255,255,0.4)", border:"1px solid rgba(255,255,255,0.1)" }}>✕</button>

      <p className="absolute top-5 left-0 right-0 text-center text-[11px] tracking-[0.25em] uppercase font-light"
        style={{ color:"rgba(255,255,255,0.18)" }}>Oráculo Agêntico</p>

      <div className="flex flex-col items-center gap-6">
        <OracleBall state={oState} size={200} onClick={toggleOracle}/>

        <div className="text-center space-y-1" style={{ animation:"float-up 0.3s ease" }}>
          <p className="text-[13px] font-medium" style={{ color:ORACLE_CFG[oState].c1, transition:"color 0.6s ease" }}>
            {ORACLE_CFG[oState].label}
          </p>
          {!isActive && <p className="text-[11px]" style={{ color:"rgba(255,255,255,0.2)" }}>Microfone · Voz HD · Memória de sessão</p>}
        </div>

        {displayText && (
          <div className="max-w-xs text-center px-4 py-2.5 rounded-2xl"
            style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", animation:"transcript-fade 0.2s ease" }}>
            <p className="text-[12px] leading-relaxed" style={{ color:oState==="listening"?"rgba(255,255,255,0.75)":"rgba(255,255,255,0.4)" }}>
              {displayText}
            </p>
          </div>
        )}

        {isActive && (
          <button onClick={toggleOracle} className="px-4 py-2 rounded-xl text-[11px] font-medium transition-all"
            style={{ background:"rgba(239,68,68,0.1)", color:"#fca5a5", border:"1px solid rgba(239,68,68,0.25)" }}>
            Parar oráculo
          </button>
        )}
      </div>

      {messages.length>0 && (
        <div className="absolute bottom-4 left-4 right-4 max-h-20 overflow-y-auto space-y-1 opacity-35">
          {messages.slice(-3).map(m => (
            <div key={m.id} className="flex items-start gap-1.5">
              <span className="text-[9px] shrink-0 mt-0.5" style={{ color:m.role==="user"?"#818cf8":"#34d399" }}>{m.role==="user"?"Você":"IA"}</span>
              <p className="text-[10px] truncate" style={{ color:"rgba(255,255,255,0.4)" }}>{m.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Markdown ──────────────────────────────────────────────────────────────────
function renderInline(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []; let rest=line; let i=0;
  while (rest.length>0) {
    const mdL = rest.match(/^(.*?)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/s);
    if (mdL) {
      if (mdL[1]) parts.push(renderB(mdL[1],i++));
      parts.push(<a key={`ml${i++}`} href={mdL[3]} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium"
        style={{ background:"rgba(56,189,248,0.1)", color:"#38bdf8", border:"1px solid rgba(56,189,248,0.2)", textDecoration:"none" }}>🔗 {mdL[2]}</a>);
      rest=rest.slice(mdL[0].length); continue;
    }
    const bU = rest.match(/^(.*?)(https?:\/\/[^\s<>"]+)/s);
    if (bU) {
      if (bU[1]) parts.push(renderB(bU[1],i++));
      const h=(() => { try { return new URL(bU[2]).hostname; } catch { return bU[2].slice(0,28); } })();
      parts.push(<a key={`bu${i++}`} href={bU[2]} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium"
        style={{ background:"rgba(56,189,248,0.1)", color:"#38bdf8", border:"1px solid rgba(56,189,248,0.2)", textDecoration:"none" }}>🌐 {h}</a>);
      rest=rest.slice(bU[0].length); continue;
    }
    parts.push(renderB(rest,i++)); rest="";
  }
  return parts;
}
function renderB(text: string, key: number): React.ReactNode {
  const s: React.ReactNode[]=[]; let r=text; let i=0;
  while (r.length>0) {
    const b=r.match(/^(.*?)\*\*(.+?)\*\*/s);
    if (b) { if (b[1]) s.push(<span key={`t${key}${i++}`}>{b[1]}</span>); s.push(<strong key={`b${key}${i++}`} className="font-semibold text-white">{b[2]}</strong>); r=r.slice(b[0].length); continue; }
    const c=r.match(/^(.*?)`([^`]+)`/s);
    if (c) { if (c[1]) s.push(<span key={`t${key}${i++}`}>{c[1]}</span>); s.push(<code key={`c${key}${i++}`} className="px-1.5 py-0.5 rounded text-[11px] font-mono" style={{ background:"rgba(255,255,255,0.08)", color:"#e2e8f0" }}>{c[2]}</code>); r=r.slice(c[0].length); continue; }
    s.push(<span key={`t${key}${i++}`}>{r}</span>); r="";
  }
  return <>{s}</>;
}
function MarkdownMessage({ text }: { text: string }) {
  const blocks: React.ReactNode[]=[]; const lines=text.split("\n"); let i=0;
  while (i<lines.length) {
    const line=lines[i];
    if (line.trimStart().startsWith("```")) {
      const lang=line.replace(/```/,"").trim(); const cl:string[]=[]; i++;
      while (i<lines.length && !lines[i].trimStart().startsWith("```")) { cl.push(lines[i]); i++; }
      blocks.push(<div key={`code${i}`} className="rounded-xl overflow-hidden my-2" style={{ background:"rgba(0,0,0,0.4)", border:"1px solid rgba(255,255,255,0.08)" }}>
        {lang && <div className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wide" style={{ background:"rgba(255,255,255,0.04)", color:"rgba(255,255,255,0.3)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>{lang}</div>}
        <pre className="px-4 py-3 text-[12px] overflow-x-auto leading-relaxed" style={{ color:"#e2e8f0",margin:0 }}><code>{cl.join("\n")}</code></pre>
      </div>); i++; continue;
    }
    const h1=line.match(/^# (.+)/); const h2=line.match(/^## (.+)/); const h3=line.match(/^### (.+)/);
    if (h1||h2||h3) { const t=(h1||h2||h3)![1]; const sz=h1?"text-base":h2?"text-[14px]":"text-[13px]"; blocks.push(<p key={`h${i}`} className={`${sz} font-bold text-white mt-3 mb-1`}>{renderInline(t)}</p>); i++; continue; }
    if (/^---+$/.test(line.trim())) { blocks.push(<hr key={`hr${i}`} className="my-3" style={{ border:"none",borderTop:"1px solid rgba(255,255,255,0.1)" }}/>); i++; continue; }
    if (/^[-*•]\s/.test(line)) {
      const its:React.ReactNode[]=[];
      while (i<lines.length && /^[-*•]\s/.test(lines[i])) { its.push(<li key={`li${i}`} className="flex items-start gap-2 text-[13px] leading-relaxed" style={{ color:"rgba(255,255,255,0.75)" }}><span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background:"#6366f1" }}/><span className="flex-1">{renderInline(lines[i].replace(/^[-*•]\s/,""))}</span></li>); i++; }
      blocks.push(<ul key={`ul${i}`} className="space-y-1 my-2 ml-1 list-none">{its}</ul>); continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const its:React.ReactNode[]=[]; let n=1;
      while (i<lines.length && /^\d+\.\s/.test(lines[i])) { its.push(<li key={`li${i}`} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color:"rgba(255,255,255,0.75)" }}><span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{ background:"rgba(99,102,241,0.2)", color:"#818cf8" }}>{n++}</span><span className="flex-1">{renderInline(lines[i].replace(/^\d+\.\s/,""))}</span></li>); i++; }
      blocks.push(<ol key={`ol${i}`} className="space-y-1.5 my-2 ml-1 list-none">{its}</ol>); continue;
    }
    if (!line.trim()) { if (blocks.length>0) blocks.push(<div key={`sp${i}`} className="h-1"/>); i++; continue; }
    blocks.push(<p key={`p${i}`} className="text-[13px] leading-relaxed" style={{ color:"rgba(255,255,255,0.82)" }}>{renderInline(line)}</p>); i++;
  }
  return <div className="space-y-0.5">{blocks}</div>;
}

// ── Tool Card ─────────────────────────────────────────────────────────────────
const TOOL_META: Record<string,{icon:string;label:string;color:string;bg:string}> = {
  web_search:        {icon:"🌐",label:"Pesquisa Web",   color:"#38bdf8",bg:"rgba(56,189,248,0.08)"},
  create_task:       {icon:"✅",label:"Tarefa criada",  color:"#34d399",bg:"rgba(52,211,153,0.08)"},
  create_memory:     {icon:"🧠",label:"Memória salva",  color:"#a78bfa",bg:"rgba(167,139,250,0.08)"},
  list_projects:     {icon:"📁",label:"Projetos",       color:"#818cf8",bg:"rgba(129,140,248,0.08)"},
  get_project_stats: {icon:"📊",label:"Estatísticas",   color:"#fbbf24",bg:"rgba(251,191,36,0.08)"},
};
function confColor(c:number){return c>=0.8?"#10b981":c>=0.5?"#f59e0b":"#ef4444";}
function ToolCallCard({tc}:{tc:ToolCall}){
  const [open,setOpen]=useState(false);
  const meta=TOOL_META[tc.name]??{icon:"🔧",label:tc.name,color:"#9ca3af",bg:"rgba(255,255,255,0.04)"};
  const res=tc.result as Record<string,unknown>; const isErr=typeof res?.error==="string";
  return <div className="rounded-xl overflow-hidden" style={{background:isErr?"rgba(239,68,68,0.06)":meta.bg,border:`1px solid ${isErr?"rgba(239,68,68,0.2)":`${meta.color}25`}`}}>
    <button onClick={()=>setOpen(v=>!v)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
      <span className="text-base shrink-0">{meta.icon}</span>
      <span className="text-[12px] font-semibold flex-1 min-w-0 truncate" style={{color:isErr?"#fca5a5":meta.color}}>{isErr?`Erro: ${res.error as string}`:meta.label}</span>
      {tc.name==="web_search"&&!isErr&&<span className="text-[10px] shrink-0 px-2 py-0.5 rounded-full" style={{background:"rgba(56,189,248,0.1)",color:"#38bdf8"}}>{((res?.results as unknown[])??[]).length} resultados</span>}
      {tc.name==="create_task"&&!isErr&&<span className="text-[10px] shrink-0 px-2 py-0.5 rounded-full" style={{background:"rgba(52,211,153,0.1)",color:"#34d399"}}>{String(res.priority??"MEDIUM")}</span>}
      <span className="text-[10px] shrink-0" style={{color:"rgba(255,255,255,0.2)"}}>{open?"▲":"▼"}</span>
    </button>
    {open&&<div className="px-3 pb-3 space-y-2 border-t" style={{borderColor:`${meta.color}15`}}>
      {tc.name==="web_search"&&!isErr&&<div className="space-y-2 pt-2">
        {!!res.answer&&<div className="rounded-lg px-3 py-2 text-[12px] leading-relaxed" style={{background:"rgba(56,189,248,0.07)",color:"#bae6fd",border:"1px solid rgba(56,189,248,0.15)"}}><span className="font-semibold text-sky-300 block mb-1 text-[10px] uppercase tracking-widest">Síntese</span>{String(res.answer)}</div>}
        {((res.results??[]) as {title:string;url:string;snippet:string}[]).map((r,idx)=><div key={idx} className="rounded-lg p-2.5 space-y-1" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="flex items-start gap-2"><span className="text-[10px] shrink-0 mt-0.5 opacity-50">{idx+1}</span><div className="flex-1 min-w-0"><p className="text-[12px] font-medium leading-tight mb-1" style={{color:"rgba(255,255,255,0.8)"}}>{r.title}</p><p className="text-[11px]" style={{color:"rgba(255,255,255,0.35)"}}>{r.snippet}</p></div></div>
          <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium" style={{background:"rgba(56,189,248,0.1)",color:"#38bdf8",border:"1px solid rgba(56,189,248,0.2)",textDecoration:"none"}}>🔗 {(()=>{try{return new URL(r.url).hostname;}catch{return r.url.slice(0,28);}})()}</a>
        </div>)}
      </div>}
      {tc.name==="create_task"&&!isErr&&<div className="pt-2 flex items-center gap-2"><span className="text-[11px]" style={{color:"rgba(255,255,255,0.5)"}}>Criado:</span><span className="text-[12px] font-medium" style={{color:"#34d399"}}>{String(res.title)}</span></div>}
      {tc.name==="create_memory"&&!isErr&&<div className="pt-2 flex items-center gap-2"><span className="text-[11px]" style={{color:"rgba(255,255,255,0.5)"}}>Salvo:</span><span className="text-[12px] font-medium" style={{color:"#a78bfa"}}>{String(res.title)}</span></div>}
      {tc.name==="list_projects"&&!isErr&&<div className="pt-2 grid grid-cols-1 gap-1.5">{((res as unknown) as {name:string;memories:number;tasks:number}[]).map((p,idx)=><div key={idx} className="flex items-center justify-between px-2 py-1.5 rounded-lg" style={{background:"rgba(255,255,255,0.03)"}}><span className="text-[12px] font-medium" style={{color:"#818cf8"}}>{p.name}</span><div className="flex gap-2 text-[10px]" style={{color:"rgba(255,255,255,0.35)"}}><span>🧠 {p.memories}</span><span>✅ {p.tasks}</span></div></div>)}</div>}
      {tc.name==="get_project_stats"&&!isErr&&<div className="pt-2 grid grid-cols-3 gap-2">{[{l:"Memórias",v:String(res.memories),c:"#a78bfa"},{l:"Validadas",v:String(res.validated),c:"#34d399"},{l:"Tasks",v:String(res.openTasks),c:"#fbbf24"}].map(s=><div key={s.l} className="rounded-lg p-2 text-center" style={{background:"rgba(255,255,255,0.03)"}}><p className="text-lg font-bold" style={{color:s.c}}>{s.v}</p><p className="text-[9px] mt-0.5" style={{color:"rgba(255,255,255,0.3)"}}>{s.l}</p></div>)}</div>}
    </div>}
  </div>;
}

// ── Brain Message ─────────────────────────────────────────────────────────────
const MODE_I={
  semantic:{label:"Memória",bg:"rgba(59,130,246,0.12)",color:"#93c5fd",icon:"🔍"},
  inferred:{label:"Inferido",bg:"rgba(139,92,246,0.12)",color:"#c4b5fd",icon:"🕸"},
  agentic:{label:"Agente",bg:"rgba(16,185,129,0.12)",color:"#6ee7b7",icon:"🤖"},
  web:{label:"Web",bg:"rgba(56,189,248,0.12)",color:"#7dd3fc",icon:"🌐"},
};
function BrainMessage({msg,onSpeak}:{msg:Message;onSpeak:(t:string)=>void}){
  const [showSrc,setShowSrc]=useState(false);
  const mi=MODE_I[msg.mode??"semantic"];
  return <div className="flex items-start gap-2.5 max-w-full">
    <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs mt-0.5" style={{background:"linear-gradient(135deg,#ec4899,#8b5cf6)"}}>🧠</div>
    <div className="flex-1 min-w-0 space-y-2">
      <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}><MarkdownMessage text={msg.text}/></div>
      {(msg.toolCalls??[]).length>0&&<div className="space-y-1.5">{msg.toolCalls!.map((tc,idx)=><ToolCallCard key={idx} tc={tc}/>)}</div>}
      <div className="flex items-center gap-1.5 flex-wrap px-1">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{background:mi.bg,color:mi.color}}>{mi.icon} {mi.label}</span>
        {(msg.confidence??0)>0&&<div className="flex items-center gap-1"><div className="w-10 h-1 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.08)"}}><div className="h-full rounded-full" style={{width:`${Math.round((msg.confidence??0)*100)}%`,background:confColor(msg.confidence??0)}}/></div><span className="text-[9px] font-mono" style={{color:confColor(msg.confidence??0)}}>{Math.round((msg.confidence??0)*100)}%</span></div>}
        {(msg.sources??[]).length>0&&<button onClick={()=>setShowSrc(v=>!v)} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{background:showSrc?"rgba(99,102,241,0.15)":"rgba(255,255,255,0.04)",color:showSrc?"#818cf8":"rgba(255,255,255,0.3)"}}>📚 {msg.sources!.length}</button>}
        <button onClick={()=>onSpeak(msg.text)} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{background:"rgba(139,92,246,0.1)",color:"#c4b5fd"}}>🔊</button>
      </div>
      {showSrc&&<div className="mx-1 rounded-xl overflow-hidden" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>{msg.sources!.map(s=><div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] last:border-0"><span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{background:"rgba(99,102,241,0.12)",color:"#818cf8"}}>{s.type}</span><span className="flex-1 text-[11px] truncate" style={{color:"rgba(255,255,255,0.55)"}}>{s.title}</span><span className="text-[10px] font-mono shrink-0" style={{color:confColor(s.similarity)}}>{Math.round(s.similarity*100)}%</span></div>)}</div>}
    </div>
  </div>;
}

// ── Hooks ──────────────────────────────────────────────────────────────────────
function useTTS(){
  const [speaking,setSpeaking]=useState(false);
  const audioRef=useRef<HTMLAudioElement|null>(null);
  const token=localStorage.getItem("mcp_token");
  const speak=useCallback(async(text:string,voice="nova")=>{
    if(audioRef.current){audioRef.current.pause();audioRef.current=null;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).speechSynthesis?.cancel();
    try{
      const res=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({text,voice})});
      if(!res.ok)throw new Error();
      const blob=await res.blob();const url=URL.createObjectURL(blob);
      const audio=new Audio(url);audioRef.current=audio;setSpeaking(true);
      audio.onended=()=>{setSpeaking(false);URL.revokeObjectURL(url);};
      audio.onerror=()=>{setSpeaking(false);URL.revokeObjectURL(url);};
      await audio.play();
    }catch{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s=(window as any).speechSynthesis as SpeechSynthesis|undefined;if(!s)return;
      s.cancel();const u=new SpeechSynthesisUtterance(text);u.lang="pt-BR";
      u.onstart=()=>setSpeaking(true);u.onend=()=>setSpeaking(false);u.onerror=()=>setSpeaking(false);s.speak(u);
    }
  },[token]);
  const stop=useCallback(()=>{if(audioRef.current){audioRef.current.pause();audioRef.current=null;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).speechSynthesis?.cancel();setSpeaking(false);},[]);
  return{speaking,speak,stop};
}
function useVoiceInput(onT:(t:string)=>void){
  const [listening,setListening]=useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef=useRef<any>(null);
  const start=useCallback(()=>{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w=window as any;const SR=w.SpeechRecognition??w.webkitSpeechRecognition;
    if(!SR){alert("Microfone não suportado. Use Chrome ou Edge.");return;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec:any=new SR();rec.lang="pt-BR";rec.continuous=false;rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>onT(e.results[0][0].transcript as string);
    rec.onend=()=>setListening(false);rec.onerror=()=>setListening(false);
    recRef.current=rec;rec.start();setListening(true);
  },[onT]);
  const stop=useCallback(()=>{recRef.current?.stop();setListening(false);},[]);
  return{listening,start,stop};
}

const VOICES=[
  {id:"nova",label:"Nova",desc:"Feminina, calorosa"},
  {id:"shimmer",label:"Shimmer",desc:"Feminina, suave"},
  {id:"alloy",label:"Alloy",desc:"Neutra, clara"},
  {id:"echo",label:"Echo",desc:"Masculina, grave"},
  {id:"onyx",label:"Onyx",desc:"Masculina, profunda"},
  {id:"fable",label:"Fable",desc:"Britânica, expressiva"},
];

// ── Attachment chip ───────────────────────────────────────────────────────────
function AttachChip({file,onRemove}:{file:AttachFile;onRemove:()=>void}){
  return <div className="relative shrink-0 rounded-lg overflow-hidden" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>
    {file.kind==="image"&&file.preview
      ?<div className="relative w-14 h-14"><img src={file.preview} alt={file.name} className="w-full h-full object-cover"/><button onClick={onRemove} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px]" style={{background:"rgba(0,0,0,0.7)",color:"#fff"}}>✕</button></div>
      :<div className="flex items-center gap-1.5 px-2 py-1.5 pr-1"><span className="text-sm">{file.kind==="text"?"📄":"📎"}</span><span className="text-[10px] max-w-[80px] truncate" style={{color:"rgba(255,255,255,0.6)"}}>{file.name}</span><button onClick={onRemove} className="text-[10px] ml-0.5" style={{color:"rgba(255,255,255,0.3)"}}>✕</button></div>
    }
  </div>;
}

// ── Main ChatPage ──────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [projects,setProjects]=useState<Project[]>([]);
  const [project,setProject]=useState<string>("");
  const [messages,setMessages]=useState<Message[]>([]);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [voice,setVoice]=useState("nova");
  const [showVP,setShowVP]=useState(false);
  const [oracleOpen,setOracleOpen]=useState(false);
  const [attachments,setAttachments]=useState<AttachFile[]>([]);

  const bottomRef   =useRef<HTMLDivElement>(null);
  const taRef       =useRef<HTMLTextAreaElement>(null);
  const fileRef     =useRef<HTMLInputElement>(null);
  const camRef      =useRef<HTMLInputElement>(null);

  const{speaking,speak,stop:stopTTS}=useTTS();
  const{listening,start:startListen,stop:stopListen}=useVoiceInput(
    useCallback((t:string)=>setInput(p=>p?`${p} ${t}`:t),[])
  );

  useEffect(()=>{
    api.get<Project[]>("/api/projects")
      .then(p=>{setProjects(p);if(p.length>0)setProject(p[0].slug);}).catch(()=>{});
  },[]);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  function buildHistory():HistMsg[]{
    return messages.slice(-20).map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}));
  }

  async function processFile(file:File):Promise<AttachFile|null>{
    return new Promise(resolve=>{
      const reader=new FileReader();
      const id=`f-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if(file.type.startsWith("image/")){
        reader.onload=e=>{const d=e.target?.result as string;resolve({id,name:file.name,mimeType:file.type,data:d.split(",")[1],preview:d,kind:"image"});};
        reader.readAsDataURL(file);
      } else if(file.type.startsWith("text/")||/\.(txt|md|csv|json)$/i.test(file.name)){
        reader.onload=e=>resolve({id,name:file.name,mimeType:file.type,data:e.target?.result as string,kind:"text"});
        reader.readAsText(file);
      } else {
        resolve({id,name:file.name,mimeType:file.type,data:"",kind:"doc"});
      }
    });
  }

  async function handleFiles(fl:FileList|null){
    if(!fl)return;
    const processed=await Promise.all(Array.from(fl).slice(0,4).map(processFile));
    setAttachments(prev=>[...prev,...processed.filter(Boolean) as AttachFile[]].slice(0,4));
  }

  async function send(){
    const q=input.trim();
    if(!q&&attachments.length===0)return;
    if(!project||loading)return;
    const textA=attachments.filter(a=>a.kind==="text").map(a=>`[Arquivo: ${a.name}]\n${a.data.slice(0,2000)}`).join("\n\n---\n\n");
    const queryFull=[q,textA].filter(Boolean).join("\n\n");
    const imgA=attachments.filter(a=>a.kind==="image").map(a=>({type:"image",mimeType:a.mimeType,data:a.data}));
    const userMsg:Message={id:`u-${Date.now()}`,role:"user",text:q||(attachments.map(a=>a.name).join(", ")),attachments:attachments.map(a=>({name:a.name,kind:a.kind,preview:a.preview}))};
    setMessages(prev=>[...prev,userMsg]);setInput("");setAttachments([]);setLoading(true);
    try{
      const res=await api.post<{answer:string;mode:string;confidence:number;sources:Source[];toolCalls:ToolCall[];conversationType:string}>(
        `/api/projects/${project}/brain/chat`,{query:queryFull||"(sem texto)",history:buildHistory(),attachments:imgA}
      );
      setMessages(prev=>[...prev,{id:`b-${Date.now()}`,role:"brain",text:res.answer,mode:res.mode as Message["mode"],confidence:res.confidence,sources:res.sources,toolCalls:res.toolCalls,conversationType:res.conversationType as Message["conversationType"]}]);
    }catch(e:unknown){
      setMessages(prev=>[...prev,{id:`e-${Date.now()}`,role:"brain",text:`Erro: ${e instanceof Error?e.message:"desconhecido"}`}]);
    }finally{setLoading(false);taRef.current?.focus();}
  }

  function handleKey(e:React.KeyboardEvent){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}

  const selS:React.CSSProperties={background:"rgba(8,12,30,0.8)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.75)",borderRadius:"0.75rem",padding:"0.5rem 0.75rem",fontSize:"0.875rem",outline:"none"};

  return<>
    {oracleOpen&&<OracleMode project={project} voice={voice} messages={messages} onClose={()=>setOracleOpen(false)} onAddMessages={msgs=>setMessages(prev=>[...prev,...msgs])}/>}

    <div className="flex flex-col" style={{height:"calc(100dvh - 8rem)"}}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 shrink-0" style={{borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)"}}>
            <svg fill="none" viewBox="0 0 20 20" className="w-4 h-4 text-white"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H6l-4 3V5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-white">Chat Agêntico</h1>
            <p className="text-[10px] hidden sm:block" style={{color:"rgba(255,255,255,0.28)"}}>Memória · voz HD · web · tarefas · visão</p>
          </div>
        </div>

        {/* Oracle button */}
        <button onClick={()=>{if(!project)return;setOracleOpen(true);}} disabled={!project} title="Oráculo — conversa por voz em tempo real"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all"
          style={{background:"linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.2))",color:"#c4b5fd",border:"1px solid rgba(139,92,246,0.3)"}}>
          🔮 <span className="hidden sm:inline">Oráculo</span>
        </button>

        {/* Voice picker */}
        <div className="relative">
          <button onClick={()=>setShowVP(v=>!v)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium"
            style={{background:speaking?"rgba(139,92,246,0.2)":"rgba(255,255,255,0.05)",color:speaking?"#c4b5fd":"rgba(255,255,255,0.45)",border:"1px solid rgba(255,255,255,0.08)"}}>
            {speaking?"🔊":"🎙"} {voice}
          </button>
          {showVP&&<div className="absolute right-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-xl" style={{background:"#0d1224",border:"1px solid rgba(255,255,255,0.1)",width:"180px"}}>
            {VOICES.map(v=><button key={v.id} onClick={()=>{setVoice(v.id);setShowVP(false);}} className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-white/5">
              <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold" style={{color:v.id===voice?"#818cf8":"rgba(255,255,255,0.75)"}}>{v.label}{v.id===voice&&" ✓"}</p><p className="text-[10px]" style={{color:"rgba(255,255,255,0.3)"}}>{v.desc}</p></div>
            </button>)}
          </div>}
        </div>

        {speaking&&<button onClick={stopTTS} className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium" style={{background:"rgba(139,92,246,0.15)",color:"#c4b5fd",border:"1px solid rgba(139,92,246,0.3)"}}>🔇 Parar</button>}

        <select value={project} onChange={e=>{setProject(e.target.value);setMessages([]);}} style={selS}>
          <option value="">Projeto…</option>
          {projects.map(p=><option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>

        {messages.length>0&&<button onClick={()=>setMessages([])} className="px-2.5 py-1.5 rounded-xl text-[11px]" style={{background:"rgba(239,68,68,0.08)",color:"rgba(239,68,68,0.6)",border:"1px solid rgba(239,68,68,0.15)"}}>Limpar</button>}
      </div>

      {showVP&&<div className="fixed inset-0 z-40" onClick={()=>setShowVP(false)}/>}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2 pr-1" style={{overscrollBehavior:"contain"}}>
        {messages.length===0&&(
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="mb-4"><OracleBall state="idle" size={76}/></div>
            <p className="text-sm font-semibold mb-1 text-white/50">Segundo cérebro agêntico</p>
            <p className="text-[11px] mb-4" style={{color:"rgba(255,255,255,0.2)"}}>🔮 Toque em Oráculo para falar por voz em tempo real</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-xs">
              {["🌐 Pesquisa web","✅ Cria tarefas","🧠 Salva memórias","📎 Anexa arquivos","📷 Tira foto"].map(h=>(
                <button key={h} onClick={()=>setInput(h.replace(/^[^\s]+ /,""))} className="text-[11px] px-2.5 py-1 rounded-full" style={{background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.35)",border:"1px solid rgba(255,255,255,0.06)"}}>{h}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map(msg=><div key={msg.id} className={`flex ${msg.role==="user"?"justify-end":"justify-start"}`}>
          {msg.role==="user"
            ?<div className="max-w-[80%] sm:max-w-[70%]">
              {(msg.attachments??[]).length>0&&<div className="flex gap-2 mb-2 justify-end flex-wrap">{msg.attachments!.map((a,i)=>a.preview?<img key={i} src={a.preview} alt={a.name} className="w-16 h-16 rounded-lg object-cover" style={{border:"1px solid rgba(255,255,255,0.1)"}}/>:<div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.5)"}}>📎 {a.name}</div>)}</div>}
              <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-[13px] leading-relaxed" style={{background:"linear-gradient(135deg,rgba(99,102,241,0.35),rgba(139,92,246,0.28))",color:"#e0e7ff",border:"1px solid rgba(99,102,241,0.3)"}}>{msg.text}</div>
            </div>
            :<div className="max-w-full sm:max-w-[90%] w-full"><BrainMessage msg={msg} onSpeak={(t)=>speak(t,voice)}/></div>}
        </div>)}
        {loading&&<div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-xl shrink-0 flex items-center justify-center text-xs" style={{background:"linear-gradient(135deg,#ec4899,#8b5cf6)"}}>🧠</div>
          <div className="px-4 py-3 rounded-2xl rounded-tl-sm" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div className="flex items-center gap-1.5 mb-1">{[0,150,300].map(d=><span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{background:["#6366f1","#8b5cf6","#ec4899"][d/150],animationDelay:`${d}ms`}}/>)}</div>
            <p className="text-[10px]" style={{color:"rgba(255,255,255,0.25)"}}>Agente processando…</p>
          </div>
        </div>}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="pt-3 shrink-0" style={{borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        {attachments.length>0&&<div className="flex gap-2 mb-2 flex-wrap">{attachments.map(f=><AttachChip key={f.id} file={f} onRemove={()=>setAttachments(prev=>prev.filter(a=>a.id!==f.id))}/>)}</div>}
        {!project&&<p className="text-center text-sm mb-2" style={{color:"rgba(255,255,255,0.3)"}}>Selecione um projeto acima</p>}
        <div className="flex gap-2 items-end">
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={()=>camRef.current?.click()} title="Tirar foto" className="w-9 h-9 rounded-xl flex items-center justify-center text-base" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>📷</button>
            <button onClick={()=>fileRef.current?.click()} title="Anexar arquivo" className="w-9 h-9 rounded-xl flex items-center justify-center text-base" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>📎</button>
          </div>
          <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKey} disabled={!project||loading} rows={2}
            placeholder={!project?"Selecione um projeto":listening?"🎤 Ouvindo…":"Pergunte, pesquise, crie tarefas… (Ctrl+Enter)"}
            className="flex-1 px-3.5 py-2.5 rounded-2xl text-[13px] outline-none resize-none"
            style={{background:listening?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.04)",border:listening?"1px solid rgba(99,102,241,0.45)":"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.85)",lineHeight:"1.5"}}
          />
          <div className="flex flex-col gap-1.5 shrink-0">
            <button onClick={listening?stopListen:startListen} disabled={!project||loading} title={listening?"Parar":"Falar"} className="w-10 h-10 rounded-xl flex items-center justify-center" style={{background:listening?"rgba(239,68,68,0.15)":"rgba(255,255,255,0.05)",border:listening?"1px solid rgba(239,68,68,0.35)":"1px solid rgba(255,255,255,0.08)"}}>
              <span className="text-base">{listening?"⏹":"🎤"}</span>
            </button>
            <button onClick={send} disabled={(!input.trim()&&attachments.length===0)||!project||loading} className="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold"
              style={{background:(!input.trim()&&attachments.length===0)||!project||loading?"rgba(99,102,241,0.12)":"linear-gradient(135deg,#6366f1,#8b5cf6)",color:(!input.trim()&&attachments.length===0)||!project||loading?"rgba(165,180,252,0.35)":"#fff",cursor:(!input.trim()&&attachments.length===0)||!project||loading?"not-allowed":"pointer"}}>
              {loading?<span className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin"/>:"↑"}
            </button>
          </div>
        </div>
        <p className="text-[9px] mt-1.5 text-center" style={{color:"rgba(255,255,255,0.13)"}}>Ctrl+Enter · 🎤 voz · 📷 câmera · 📎 arquivos · 🔮 oráculo ao vivo</p>
      </div>
    </div>

    <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json" className="hidden" onChange={e=>handleFiles(e.target.files).then(()=>{if(fileRef.current)fileRef.current.value="";})}/>
    <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>handleFiles(e.target.files).then(()=>{if(camRef.current)camRef.current.value="";})}/>
  </>;
}
