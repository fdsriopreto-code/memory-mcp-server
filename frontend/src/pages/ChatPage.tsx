import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, MicOff, Paperclip, Camera, Plus, Volume2, VolumeX, History, Trash2, X, ChevronLeft } from "lucide-react";
import { api } from "../services/api";

// ── Types ──────────────────────────────────────────────────────────────────────
type Project  = { id: string; name: string; slug: string; color: string };
type Source   = { id: string; title: string; type: string; similarity: number };
type ToolCall = { name: string; args: Record<string, unknown>; result: unknown };
type HistMsg  = { role: "user" | "assistant"; content: string };
type OState   = "idle" | "listening" | "thinking" | "speaking" | "error";
type AttachFile = { id: string; name: string; mimeType: string; data: string; preview?: string; kind: "image"|"text"|"doc" };
type Message = {
  id: string; role: "user"|"brain"; text: string;
  mode?: "semantic"|"agentic"|"web"|"inferred"; confidence?: number;
  sources?: Source[]; toolCalls?: ToolCall[];
  conversationType?: string;
  attachments?: { name: string; kind: string; preview?: string }[];
  ts?: number;
};
type ChatSession = {
  id: string; projectSlug: string; projectName: string;
  title: string; messages: Message[];
  createdAt: number; updatedAt: number;
};

// ── Session storage ────────────────────────────────────────────────────────────
const SKEY = "mcp_sessions_v1";
const loadSessions = (): ChatSession[] => {
  try { return JSON.parse(localStorage.getItem(SKEY) ?? "[]"); } catch { return []; }
};
const saveSessions = (s: ChatSession[]) => {
  try { localStorage.setItem(SKEY, JSON.stringify(s.slice(-50))); } catch { /* quota */ }
};
const mkSession = (slug: string, name: string): ChatSession => ({
  id: `s${Date.now()}`, projectSlug: slug, projectName: name,
  title: "Nova conversa", messages: [], createdAt: Date.now(), updatedAt: Date.now(),
});
const FREE_SLUG = "__free__";
function timeAgo(ts: number) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "agora"; if (d < 3600) return `${Math.floor(d/60)}min`;
  if (d < 86400) return `${Math.floor(d/3600)}h`; return `${Math.floor(d/86400)}d`;
}

// ── Oracle config ──────────────────────────────────────────────────────────────
const OCFG: Record<OState, { c1:string; c2:string; ring:string; glow:string; label:string; s1:number; s2:number; s3:number }> = {
  idle:     {c1:"#6366f1",c2:"#4338ca",ring:"rgba(99,102,241,0.4)", glow:"rgba(99,102,241,0.3)", label:"Toque para ativar",       s1:6,  s2:9,   s3:12  },
  listening:{c1:"#06b6d4",c2:"#0284c7",ring:"rgba(6,182,212,0.5)", glow:"rgba(6,182,212,0.45)",  label:"Ouvindo…",               s1:2.5,s2:3.5, s3:2   },
  thinking: {c1:"#f59e0b",c2:"#b45309",ring:"rgba(245,158,11,0.5)",glow:"rgba(245,158,11,0.4)",  label:"Pensando…",              s1:1.5,s2:2,   s3:2.5 },
  speaking: {c1:"#10b981",c2:"#047857",ring:"rgba(16,185,129,0.5)",glow:"rgba(16,185,129,0.4)",  label:"Falando…",               s1:3,  s2:4,   s3:2.5 },
  error:    {c1:"#ef4444",c2:"#b91c1c",ring:"rgba(239,68,68,0.4)", glow:"rgba(239,68,68,0.3)",   label:"Toque para tentar novamente",s1:5,s2:7,s3:9   },
};
const CANIM: Record<OState,string> = {
  idle:     "oracle-core-pulse 3.5s ease-in-out infinite",
  listening:"oracle-listen-wave 1.2s ease-in-out infinite",
  thinking: "oracle-core-think 0.9s ease-in-out infinite",
  speaking: "oracle-core-speak 0.7s ease-in-out infinite",
  error:    "oracle-core-pulse 2s ease-in-out infinite",
};

// ── OracleBall ─────────────────────────────────────────────────────────────────
function OracleBall({ state, size=180, onClick }: { state:OState; size?:number; onClick?:()=>void }) {
  const c = OCFG[state]; const ri = size*0.08; const ci = size*0.22;
  const rs = (inset:number,rx:number,ry:number,sp:number,rev=false):React.CSSProperties => ({
    position:"absolute",inset,borderRadius:"50%",border:`1.5px solid ${c.ring}`,
    transform:`rotateX(${rx}deg) rotateY(${ry}deg)`,
    animation:`oracle-spin-${rev?3:1} ${sp}s linear infinite${rev?" reverse":""}`,
    transition:"border-color 0.8s ease",
  });
  const ds = (col:string,sz=7):React.CSSProperties => ({
    position:"absolute",top:-4,left:"50%",transform:"translateX(-50%)",
    width:sz,height:sz,borderRadius:"50%",background:col,boxShadow:`0 0 10px 3px ${col}99`,
    transition:"background 0.8s ease",
  });
  return (
    <button onClick={onClick} className="relative focus:outline-none select-none" style={{width:size,height:size,cursor:onClick?"pointer":"default"}}>
      <div style={{position:"absolute",inset:-size*0.12,borderRadius:"50%",background:c.glow,filter:`blur(${size*0.22}px)`,animation:"oracle-glow-pulse 2.5s ease-in-out infinite",transition:"background 0.8s ease"}}/>
      <div style={{position:"absolute",inset:0,perspective:`${size*5}px`,perspectiveOrigin:"center"}}>
        <div style={rs(ri,72,0,c.s1)}><div style={ds(c.c1)}/></div>
        <div style={rs(ri+2,25,65,c.s2,true)}><div style={ds(c.c2)}/></div>
        <div style={{...rs(ri+size*0.06,-68,0,c.s3),opacity:0.55}}><div style={ds(c.c1,5)}/></div>
      </div>
      <div style={{position:"absolute",inset:ci,borderRadius:"50%",zIndex:10,
        background:`radial-gradient(circle at 35% 28%, rgba(255,255,255,0.45) 0%, ${c.c1} 35%, ${c.c2} 100%)`,
        boxShadow:`0 0 ${size*0.15}px ${c.glow}, 0 0 ${size*0.3}px ${c.glow}55, inset 0 0 ${size*0.1}px rgba(255,255,255,0.12)`,
        animation:CANIM[state],transition:"background 0.8s ease, box-shadow 0.8s ease"}}/>
      <div style={{position:"absolute",borderRadius:"50%",zIndex:11,width:size*0.14,height:size*0.09,top:"31%",left:"35%",background:"rgba(255,255,255,0.5)",filter:"blur(4px)",transform:"rotate(-20deg)"}}/>
    </button>
  );
}

// ── OracleMode ─── FIX: continuous=false elimina capturas duplicadas ───────────
function OracleMode({ project, voice, messages, onClose, onAddMessages }: {
  project:string; voice:string; messages:Message[];
  onClose:()=>void; onAddMessages:(m:Message[])=>void;
}) {
  const [oState,  setOState]  = useState<OState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim,    setInterim]    = useState("");
  const [lastResp,   setLastResp]   = useState("");
  const [isActive,   setIsActive]   = useState(false);

  const recRef   = useRef<unknown>(null);
  const audioRef = useRef<HTMLAudioElement|null>(null);
  const abortRef = useRef<AbortController|null>(null);
  const isActRef = useRef(false);
  const isSending= useRef(false);
  const token    = localStorage.getItem("mcp_token");

  function stopAudio() {
    abortRef.current?.abort(); abortRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    (window as unknown as {speechSynthesis?:SpeechSynthesis}).speechSynthesis?.cancel();
  }
  function stopRecognition() {
    try {
      const rec = recRef.current as {abort?:()=>void; stop?:()=>void} | null;
      rec?.abort?.() ?? rec?.stop?.();
    } catch {/* */}
    recRef.current = null;
  }

  async function speakTTS(text: string): Promise<void> {
    stopAudio(); setOState("speaking"); setLastResp(text);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    return new Promise(resolve => {
      fetch("/api/tts", { method:"POST", signal:ctrl.signal,
        headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},
        body:JSON.stringify({text:text.slice(0,1500),voice}),
      }).then(r => { if(!r.ok) throw new Error(); return r.blob(); })
        .then(blob => {
          if(ctrl.signal.aborted){resolve();return;}
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url); audioRef.current = audio;
          audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(resolve);
        }).catch(e => {
          if(e instanceof Error && e.name==="AbortError"){resolve();return;}
          const ss = (window as unknown as {speechSynthesis?:SpeechSynthesis}).speechSynthesis;
          if(!ss){resolve();return;}
          ss.cancel();
          const u = new SpeechSynthesisUtterance(text.slice(0,400));
          u.lang = "pt-BR"; u.onend = () => resolve(); u.onerror = () => resolve(); ss.speak(u);
        });
    });
  }

  async function sendQuery(text: string) {
    if(isSending.current) return;
    isSending.current = true; setOState("thinking"); setTranscript(""); setInterim("");
    const userMsg: Message = {id:`u${Date.now()}`, role:"user", text, ts:Date.now()};
    const history = messages.slice(-10).map(m => ({role:(m.role==="user"?"user":"assistant") as "user"|"assistant", content:m.text}));
    try {
      const res = await api.post<{answer:string;mode:string;confidence:number;sources:Source[];toolCalls:ToolCall[];conversationType:string}>(
        `/api/projects/${project}/brain/chat`, {query:text, history}
      );
      const brainMsg: Message = {id:`b${Date.now()}`, role:"brain", text:res.answer,
        mode:res.mode as Message["mode"], confidence:res.confidence,
        sources:res.sources, toolCalls:res.toolCalls, conversationType:res.conversationType, ts:Date.now()};
      onAddMessages([userMsg, brainMsg]);
      await speakTTS(res.answer);
    } catch {
      setOState("error");
      onAddMessages([userMsg, {id:`e${Date.now()}`, role:"brain", text:"Não consegui responder. Tente novamente.", ts:Date.now()}]);
      isSending.current = false; return;
    }
    isSending.current = false;
    // 800ms cooldown — evita mic capturar áudio do TTS
    await new Promise<void>(r => setTimeout(r, 800));
    if(isActRef.current && !isSending.current) { setOState("listening"); startListening(); }
  }

  // KEY FIX: continuous=false → browser detecta o fim da fala naturalmente
  //          sem acumulação de texto intermediário que causava repetições
  function startListening() {
    stopRecognition();
    const w = window as unknown as {SpeechRecognition?:unknown; webkitSpeechRecognition?:unknown};
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if(!SR) { setOState("error"); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new (SR as new()=>unknown)();
    rec.lang = "pt-BR";
    rec.continuous = false;     // ← UMA frase por sessão, sem acumulação
    rec.interimResults = true;  // mostra texto enquanto fala para feedback visual

    let finalResult = "";       // local — reseta para cada sessão de reconhecimento

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      if(isSending.current) return;
      if(audioRef.current) stopAudio();
      setOState("listening");

      let int = "";
      for(let i = 0; i < e.results.length; i++) {
        if(e.results[i].isFinal)  finalResult += e.results[i][0].transcript as string;
        else                      int = e.results[i][0].transcript as string; // só o mais recente
      }
      setTranscript(finalResult || int);
      setInterim(int);
    };

    rec.onend = () => {
      setInterim("");
      if(!isActRef.current) return;
      const txt = finalResult.trim();
      finalResult = ""; // reseta para próxima sessão
      if(txt && !isSending.current) {
        sendQuery(txt); // sendQuery → TTS → startListening (com cooldown)
      } else if(!isSending.current) {
        // silêncio sem fala → reinicia rapidamente
        setTimeout(() => { if(isActRef.current && !isSending.current) startListening(); }, 150);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      if(e.error === "no-speech" || e.error === "aborted") {
        if(isActRef.current && !isSending.current) setTimeout(() => startListening(), 300);
        return;
      }
      setOState("error");
    };

    recRef.current = rec; rec.start();
  }

  function toggle() {
    if(!isActive) {
      isActRef.current = true; setIsActive(true); setOState("listening"); startListening();
    } else {
      isActRef.current = false; isSending.current = false; setIsActive(false);
      stopAudio(); stopRecognition();
      setOState("idle"); setTranscript(""); setInterim(""); setLastResp("");
    }
  }

  useEffect(() => () => { isActRef.current = false; isSending.current = false; stopAudio(); stopRecognition(); }, []);

  const display = transcript || interim || (oState==="speaking" ? lastResp.slice(0,140)+(lastResp.length>140?"…":"") : "");

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{background:"radial-gradient(ellipse at center,rgba(18,20,45,0.98) 0%,rgba(4,5,12,0.99) 100%)"}}>
      <button onClick={onClose} className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center"
        style={{background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.4)",border:"1px solid rgba(255,255,255,0.1)"}}>
        <X size={14}/>
      </button>
      <p className="absolute top-5 left-0 right-0 text-center text-[10px] tracking-[0.25em] uppercase font-light" style={{color:"rgba(255,255,255,0.15)"}}>Oráculo Agêntico</p>

      <div className="flex flex-col items-center gap-6 px-6 w-full max-w-sm">
        <OracleBall state={oState} size={180} onClick={toggle}/>
        <div className="text-center space-y-1">
          <p className="text-[13px] font-medium" style={{color:OCFG[oState].c1,transition:"color 0.6s ease"}}>{OCFG[oState].label}</p>
          {!isActive&&<p className="text-[11px]" style={{color:"rgba(255,255,255,0.2)"}}>Microfone · Voz HD · Ferramentas ativas</p>}
        </div>
        <AnimatePresence>
          {display&&(
            <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}}
              className="w-full text-center px-4 py-3 rounded-2xl"
              style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)"}}>
              <p className="text-[12px] leading-relaxed" style={{color:oState==="listening"?"rgba(255,255,255,0.75)":"rgba(255,255,255,0.4)"}}>{display}</p>
            </motion.div>
          )}
        </AnimatePresence>
        {isActive&&(
          <button onClick={toggle} className="px-4 py-2 rounded-xl text-[11px] font-medium"
            style={{background:"rgba(239,68,68,0.1)",color:"#fca5a5",border:"1px solid rgba(239,68,68,0.25)"}}>
            Parar oráculo
          </button>
        )}
      </div>

      {messages.length>0&&(
        <div className="absolute bottom-4 left-4 right-4 max-h-20 overflow-y-auto space-y-1 opacity-30">
          {messages.slice(-3).map(m=>(
            <div key={m.id} className="flex items-start gap-1.5">
              <span className="text-[9px] shrink-0 mt-0.5" style={{color:m.role==="user"?"#818cf8":"#34d399"}}>{m.role==="user"?"Você":"IA"}</span>
              <p className="text-[10px] truncate" style={{color:"rgba(255,255,255,0.4)"}}>{m.text}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── useTTS — singleton com AbortController ─────────────────────────────────────
function useTTS() {
  const [speakingId, setSpeakingId] = useState<string|null>(null);
  const audioRef = useRef<HTMLAudioElement|null>(null);
  const abortRef = useRef<AbortController|null>(null);
  const token    = localStorage.getItem("mcp_token");

  const stop = useCallback(() => {
    abortRef.current?.abort(); abortRef.current = null;
    if(audioRef.current){audioRef.current.pause();audioRef.current=null;}
    (window as unknown as {speechSynthesis?:SpeechSynthesis}).speechSynthesis?.cancel();
    setSpeakingId(null);
  },[]);

  const speak = useCallback(async(id:string, text:string, voice="nova") => {
    if(speakingId===id){stop();return;}
    abortRef.current?.abort();
    if(audioRef.current){audioRef.current.pause();audioRef.current=null;}
    (window as unknown as {speechSynthesis?:SpeechSynthesis}).speechSynthesis?.cancel();
    setSpeakingId(id);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch("/api/tts",{method:"POST",signal:ctrl.signal,
        headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},
        body:JSON.stringify({text:text.slice(0,3000),voice}),
      });
      if(ctrl.signal.aborted) return;
      if(!res.ok) throw new Error();
      const blob = await res.blob(); if(ctrl.signal.aborted) return;
      const url = URL.createObjectURL(blob); const audio = new Audio(url); audioRef.current = audio;
      audio.onended = () => {setSpeakingId(null);URL.revokeObjectURL(url);audioRef.current=null;};
      audio.onerror = () => {setSpeakingId(null);URL.revokeObjectURL(url);audioRef.current=null;};
      await audio.play();
    } catch(e) {
      if(e instanceof Error && e.name==="AbortError") return;
      setSpeakingId(null);
      const ss = (window as unknown as {speechSynthesis?:SpeechSynthesis}).speechSynthesis;
      if(!ss) return; ss.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang="pt-BR";
      u.onend=()=>setSpeakingId(null); u.onerror=()=>setSpeakingId(null); ss.speak(u);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[speakingId,token,stop]);

  return {speakingId, speak, stop};
}

// ── useVoiceInput ──────────────────────────────────────────────────────────────
function useVoiceInput(onT:(t:string)=>void){
  const [listening,setListening]=useState(false);
  const recRef = useRef<{stop?:()=>void}|null>(null);
  const start = useCallback(()=>{
    const w = window as unknown as {SpeechRecognition?:unknown;webkitSpeechRecognition?:unknown};
    const SR = w.SpeechRecognition??w.webkitSpeechRecognition;
    if(!SR){alert("Microfone não suportado. Use Chrome ou Edge.");return;}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new (SR as new()=>unknown)();
    rec.lang="pt-BR"; rec.continuous=false; rec.interimResults=false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult=(e:any)=>onT(e.results[0][0].transcript as string);
    rec.onend=()=>setListening(false); rec.onerror=()=>setListening(false);
    recRef.current=rec; rec.start(); setListening(true);
  },[onT]);
  const stop = useCallback(()=>{recRef.current?.stop?.();setListening(false);},[]);
  return{listening,start,stop};
}

// ── SessionsPanel ──────────────────────────────────────────────────────────────
function SessionsPanel({ sessions, currentId, onSelect, onDelete, onClearAll, onClose }: {
  sessions:ChatSession[]; currentId:string;
  onSelect:(s:ChatSession)=>void; onDelete:(id:string)=>void;
  onClearAll:()=>void; onClose:()=>void;
}) {
  const sorted = [...sessions].reverse();
  return (
    <div className="flex flex-col h-full" style={{background:"rgba(5,8,20,0.98)"}}>
      <div className="flex items-center justify-between px-4 py-3.5 shrink-0" style={{borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
        <div>
          <p className="text-sm font-bold text-white">Histórico</p>
          <p className="text-[10px] mt-0.5" style={{color:"rgba(255,255,255,0.25)"}}>{sessions.length} conversa{sessions.length!==1?"s":""} salva{sessions.length!==1?"s":""}</p>
        </div>
        <div className="flex items-center gap-1">
          {sessions.length>0&&(
            <button onClick={onClearAll} title="Apagar tudo"
              className="p-2 rounded-lg transition-colors hover:text-red-400" style={{color:"rgba(255,255,255,0.25)"}}>
              <Trash2 size={13}/>
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-lg" style={{color:"rgba(255,255,255,0.3)"}}>
            <ChevronLeft size={16}/>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {sorted.length===0&&(
          <div className="flex flex-col items-center justify-center h-32 gap-2 px-4 text-center">
            <History size={24} style={{color:"rgba(255,255,255,0.1)"}}/>
            <p className="text-[11px]" style={{color:"rgba(255,255,255,0.2)"}}>Nenhuma conversa salva.<br/>Comece a chatear!</p>
          </div>
        )}
        {sorted.map(s=>(
          <div key={s.id} className="group relative mx-2 mb-1">
            <button onClick={()=>onSelect(s)} className="w-full text-left px-3 py-2.5 rounded-xl transition-all"
              style={{
                background:s.id===currentId?"rgba(99,102,241,0.15)":"transparent",
                border:`1px solid ${s.id===currentId?"rgba(99,102,241,0.25)":"transparent"}`,
              }}>
              <p className="text-[12px] font-medium truncate pr-5" style={{color:s.id===currentId?"#c7d2fe":"rgba(255,255,255,0.65)"}}>{s.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[9px] truncate" style={{color:"rgba(255,255,255,0.22)"}}>{s.projectName}</span>
                <span className="text-[9px]" style={{color:"rgba(255,255,255,0.12)"}}>·</span>
                <span className="text-[9px] shrink-0" style={{color:"rgba(255,255,255,0.18)"}}>{s.messages.length} msg</span>
                <span className="text-[9px]" style={{color:"rgba(255,255,255,0.12)"}}>·</span>
                <span className="text-[9px] shrink-0" style={{color:"rgba(255,255,255,0.18)"}}>{timeAgo(s.updatedAt)}</span>
              </div>
            </button>
            <button onClick={()=>onDelete(s.id)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
              style={{color:"rgba(255,255,255,0.3)"}}>
              <X size={11}/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Markdown ───────────────────────────────────────────────────────────────────
function RI(line:string,k:number):React.ReactNode[]{
  const parts:React.ReactNode[]=[]; let r=line; let i=0;
  while(r){
    const mL=r.match(/^(.*?)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/s);
    if(mL){if(mL[1])parts.push(RB(mL[1],`t${k}${i++}`));parts.push(<a key={`ml${k}${i++}`} href={mL[3]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium" style={{background:"rgba(56,189,248,0.1)",color:"#38bdf8",border:"1px solid rgba(56,189,248,0.2)",textDecoration:"none"}}>🔗 {mL[2]}</a>);r=r.slice(mL[0].length);continue;}
    const bU=r.match(/^(.*?)(https?:\/\/[^\s<>"]+)/s);
    if(bU){if(bU[1])parts.push(RB(bU[1],`t${k}${i++}`));const h=(()=>{try{return new URL(bU[2]).hostname;}catch{return bU[2].slice(0,28);}})();parts.push(<a key={`bu${k}${i++}`} href={bU[2]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium" style={{background:"rgba(56,189,248,0.1)",color:"#38bdf8",border:"1px solid rgba(56,189,248,0.2)",textDecoration:"none"}}>🌐 {h}</a>);r=r.slice(bU[0].length);continue;}
    parts.push(RB(r,`t${k}${i++}`));r="";
  }
  return parts;
}
function RB(text:string,key:string):React.ReactNode{
  const s:React.ReactNode[]=[]; let r=text; let i=0;
  while(r){
    const b=r.match(/^(.*?)\*\*(.+?)\*\*/s);if(b){if(b[1])s.push(<span key={`${key}t${i++}`}>{b[1]}</span>);s.push(<strong key={`${key}b${i++}`} className="font-semibold text-white">{b[2]}</strong>);r=r.slice(b[0].length);continue;}
    const c=r.match(/^(.*?)`([^`]+)`/s);if(c){if(c[1])s.push(<span key={`${key}t${i++}`}>{c[1]}</span>);s.push(<code key={`${key}c${i++}`} className="px-1.5 py-0.5 rounded text-[11px] font-mono" style={{background:"rgba(255,255,255,0.08)",color:"#e2e8f0"}}>{c[2]}</code>);r=r.slice(c[0].length);continue;}
    s.push(<span key={`${key}t${i++}`}>{r}</span>);r="";
  }
  return <>{s}</>;
}
function Markdown({text}:{text:string}){
  const bl:React.ReactNode[]=[]; const ls=text.split("\n"); let i=0;
  while(i<ls.length){
    const l=ls[i];
    if(l.trimStart().startsWith("```")){const lang=l.replace(/```/,"").trim();const cl:string[]=[]; i++;while(i<ls.length&&!ls[i].trimStart().startsWith("```")){cl.push(ls[i]);i++;}
      bl.push(<div key={`code${i}`} className="rounded-xl overflow-hidden my-3" style={{background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.08)"}}>{lang&&<div className="px-3 py-1.5 text-[10px] font-mono font-bold tracking-wide" style={{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.3)",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>{lang}</div>}<pre className="px-4 py-3 text-[12px] overflow-x-auto leading-relaxed" style={{color:"#e2e8f0",margin:0}}><code>{cl.join("\n")}</code></pre></div>);i++;continue;}
    const h1=l.match(/^# (.+)/);const h2=l.match(/^## (.+)/);const h3=l.match(/^### (.+)/);
    if(h1||h2||h3){const t=(h1||h2||h3)![1];const sz=h1?"text-base":h2?"text-[14px]":"text-[13px]";bl.push(<p key={`h${i}`} className={`${sz} font-bold text-white mt-4 mb-2`}>{RI(t,i)}</p>);i++;continue;}
    if(/^---+$/.test(l.trim())){bl.push(<hr key={`hr${i}`} className="my-4" style={{border:"none",borderTop:"1px solid rgba(255,255,255,0.1)"}}/>);i++;continue;}
    if(/^[-*•]\s/.test(l)){const its:React.ReactNode[]=[]; while(i<ls.length&&/^[-*•]\s/.test(ls[i])){its.push(<li key={`li${i}`} className="flex items-start gap-2.5 leading-relaxed" style={{color:"rgba(255,255,255,0.8)"}}><span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{background:"#6366f1"}}/><span className="flex-1 text-[13px]">{RI(ls[i].replace(/^[-*•]\s/,""),i)}</span></li>);i++;}bl.push(<ul key={`ul${i}`} className="space-y-1.5 my-2 ml-1 list-none">{its}</ul>);continue;}
    if(/^\d+\.\s/.test(l)){const its:React.ReactNode[]=[]; let n=1;while(i<ls.length&&/^\d+\.\s/.test(ls[i])){its.push(<li key={`li${i}`} className="flex items-start gap-2.5 leading-relaxed" style={{color:"rgba(255,255,255,0.8)"}}><span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{background:"rgba(99,102,241,0.2)",color:"#818cf8"}}>{n++}</span><span className="flex-1 text-[13px]">{RI(ls[i].replace(/^\d+\.\s/,""),i)}</span></li>);i++;}bl.push(<ol key={`ol${i}`} className="space-y-2 my-2 ml-1 list-none">{its}</ol>);continue;}
    if(!l.trim()){if(bl.length>0)bl.push(<div key={`sp${i}`} className="h-2"/>);i++;continue;}
    bl.push(<p key={`p${i}`} className="text-[13px] leading-relaxed" style={{color:"rgba(255,255,255,0.85)"}}>{RI(l,i)}</p>);i++;
  }
  return <div className="space-y-1">{bl}</div>;
}

// ── ToolCard ───────────────────────────────────────────────────────────────────
const TM: Record<string,{icon:string;label:string;color:string;bg:string}> = {
  web_search:       {icon:"🌐",label:"Pesquisa Web",   color:"#38bdf8",bg:"rgba(56,189,248,0.08)"},
  create_task:      {icon:"✅",label:"Tarefa criada",  color:"#34d399",bg:"rgba(52,211,153,0.08)"},
  create_memory:    {icon:"🧠",label:"Memória salva",  color:"#a78bfa",bg:"rgba(167,139,250,0.08)"},
  list_projects:    {icon:"📁",label:"Projetos",       color:"#818cf8",bg:"rgba(129,140,248,0.08)"},
  get_project_stats:{icon:"📊",label:"Estatísticas",   color:"#fbbf24",bg:"rgba(251,191,36,0.08)"},
};
function cc(c:number){return c>=0.8?"#10b981":c>=0.5?"#f59e0b":"#ef4444";}
function ToolCard({tc}:{tc:ToolCall}){
  const [open,setOpen]=useState(false);
  const m = TM[tc.name]??{icon:"🔧",label:tc.name,color:"#9ca3af",bg:"rgba(255,255,255,0.04)"};
  const r = tc.result as Record<string,unknown>; const er = typeof r?.error==="string";
  return(
    <div className="rounded-xl overflow-hidden" style={{background:er?"rgba(239,68,68,0.06)":m.bg,border:`1px solid ${er?"rgba(239,68,68,0.2)":`${m.color}25`}`}}>
      <button onClick={()=>setOpen(v=>!v)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left">
        <span className="text-base shrink-0">{m.icon}</span>
        <span className="text-[12px] font-semibold flex-1 min-w-0 truncate" style={{color:er?"#fca5a5":m.color}}>{er?`Erro: ${r.error as string}`:m.label}</span>
        {tc.name==="web_search"&&!er&&<span className="text-[10px] shrink-0 px-2 py-0.5 rounded-full" style={{background:"rgba(56,189,248,0.1)",color:"#38bdf8"}}>{((r?.results as unknown[])??[]).length} res.</span>}
        <span className="text-[10px] shrink-0 opacity-30">{open?"▲":"▼"}</span>
      </button>
      {open&&<div className="px-3.5 pb-3.5 space-y-2 border-t" style={{borderColor:`${m.color}15`}}>
        {tc.name==="web_search"&&!er&&<div className="space-y-2 pt-2.5">
          {!!r.answer&&<div className="rounded-lg px-3 py-2 text-[12px] leading-relaxed" style={{background:"rgba(56,189,248,0.07)",color:"#bae6fd",border:"1px solid rgba(56,189,248,0.15)"}}><span className="font-semibold text-sky-300 block mb-1 text-[10px] uppercase tracking-widest">Síntese</span>{String(r.answer)}</div>}
          {((r.results??[]) as {title:string;url:string;snippet:string}[]).map((res,idx)=>(
            <div key={idx} className="rounded-lg p-2.5 space-y-1" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
              <p className="text-[12px] font-medium" style={{color:"rgba(255,255,255,0.85)"}}>{res.title}</p>
              <p className="text-[11px]" style={{color:"rgba(255,255,255,0.38)"}}>{res.snippet}</p>
              <a href={res.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium" style={{background:"rgba(56,189,248,0.1)",color:"#38bdf8",border:"1px solid rgba(56,189,248,0.2)",textDecoration:"none"}}>🔗 {(()=>{try{return new URL(res.url).hostname;}catch{return res.url.slice(0,28);}})()}</a>
            </div>
          ))}
        </div>}
        {tc.name==="create_task"&&!er&&<div className="pt-2 flex items-center gap-2"><span className="text-[11px]" style={{color:"rgba(255,255,255,0.4)"}}>Criado:</span><span className="text-[12px] font-semibold" style={{color:"#34d399"}}>{String(r.title)}</span></div>}
        {tc.name==="create_memory"&&!er&&<div className="pt-2 flex items-center gap-2"><span className="text-[11px]" style={{color:"rgba(255,255,255,0.4)"}}>Salvo:</span><span className="text-[12px] font-semibold" style={{color:"#a78bfa"}}>{String(r.title)}</span></div>}
      </div>}
    </div>
  );
}

// ── BrainMsg ───────────────────────────────────────────────────────────────────
const MI = {
  semantic:{label:"Memória",bg:"rgba(59,130,246,0.12)", color:"#93c5fd",icon:"🔍"},
  inferred:{label:"Inferido",bg:"rgba(139,92,246,0.12)",color:"#c4b5fd",icon:"🕸"},
  agentic: {label:"Agente", bg:"rgba(16,185,129,0.12)", color:"#6ee7b7",icon:"🤖"},
  web:     {label:"Web",    bg:"rgba(56,189,248,0.12)", color:"#7dd3fc",icon:"🌐"},
};
function BrainMsg({msg,speakingId,onSpeak}:{msg:Message;speakingId:string|null;onSpeak:(id:string,t:string)=>void}){
  const [showSrc,setShowSrc]=useState(false);
  const mi = MI[msg.mode??"semantic"]; const isSpeaking = speakingId===msg.id;
  return(
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="flex items-start gap-2.5 max-w-full">
      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-sm mt-0.5" style={{background:"linear-gradient(135deg,#ec4899,#8b5cf6)"}}>🧠</div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 sm:px-5" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)"}}>
          <Markdown text={msg.text}/>
        </div>
        {(msg.toolCalls??[]).length>0&&<div className="space-y-2">{msg.toolCalls!.map((tc,idx)=><ToolCard key={idx} tc={tc}/>)}</div>}
        <div className="flex items-center gap-1.5 flex-wrap px-1">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{background:mi.bg,color:mi.color}}>{mi.icon} {mi.label}</span>
          {(msg.confidence??0)>0&&<div className="flex items-center gap-1"><div className="w-10 h-1 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.08)"}}><div className="h-full rounded-full" style={{width:`${Math.round((msg.confidence??0)*100)}%`,background:cc(msg.confidence??0)}}/></div><span className="text-[9px] font-mono" style={{color:cc(msg.confidence??0)}}>{Math.round((msg.confidence??0)*100)}%</span></div>}
          {(msg.sources??[]).length>0&&<button onClick={()=>setShowSrc(v=>!v)} className="text-[10px] px-2 py-0.5 rounded-full" style={{background:showSrc?"rgba(99,102,241,0.15)":"rgba(255,255,255,0.04)",color:showSrc?"#818cf8":"rgba(255,255,255,0.3)"}}>📚 {msg.sources!.length}</button>}
          <button onClick={()=>onSpeak(msg.id,msg.text)} className="text-[10px] px-2 py-0.5 rounded-full transition-all" style={{background:isSpeaking?"rgba(139,92,246,0.2)":"rgba(255,255,255,0.04)",color:isSpeaking?"#c4b5fd":"rgba(255,255,255,0.3)",border:isSpeaking?"1px solid rgba(139,92,246,0.3)":"1px solid transparent"}}>
            {isSpeaking?<><VolumeX size={10} className="inline mr-0.5"/>Parar</>:<><Volume2 size={10} className="inline mr-0.5"/>Ouvir</>}
          </button>
          {msg.ts&&<span className="text-[9px] ml-auto" style={{color:"rgba(255,255,255,0.12)"}}>{new Date(msg.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>}
        </div>
        {showSrc&&(
          <div className="mx-1 rounded-xl overflow-hidden" style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)"}}>
            {msg.sources!.map(s=>(
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] last:border-0">
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{background:"rgba(99,102,241,0.12)",color:"#818cf8"}}>{s.type}</span>
                <span className="flex-1 text-[11px] truncate" style={{color:"rgba(255,255,255,0.55)"}}>{s.title}</span>
                <span className="text-[10px] font-mono shrink-0" style={{color:cc(s.similarity)}}>{Math.round(s.similarity*100)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const VOICES = [{id:"nova",l:"Nova",d:"Feminina"},{id:"shimmer",l:"Shimmer",d:"Suave"},{id:"alloy",l:"Alloy",d:"Neutra"},{id:"echo",l:"Echo",d:"Grave"},{id:"onyx",l:"Onyx",d:"Profunda"},{id:"fable",l:"Fable",d:"Britânica"}];

function AttachChip({file,onRemove}:{file:AttachFile;onRemove:()=>void}){
  return(
    <div className="relative shrink-0 rounded-lg overflow-hidden" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>
      {file.kind==="image"&&file.preview
        ?<div className="relative w-14 h-14"><img src={file.preview} alt={file.name} className="w-full h-full object-cover"/><button onClick={onRemove} className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center" style={{background:"rgba(0,0,0,0.75)"}}><X size={8} color="white"/></button></div>
        :<div className="flex items-center gap-1.5 px-2 py-2 pr-1"><span className="text-sm">{file.kind==="text"?"📄":"📎"}</span><span className="text-[10px] max-w-[80px] truncate" style={{color:"rgba(255,255,255,0.6)"}}>{file.name}</span><button onClick={onRemove} className="ml-1 opacity-40 hover:opacity-70"><X size={10}/></button></div>
      }
    </div>
  );
}

// ── ChatPage ───────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const [projects,setProjects]=useState<Project[]>([]);
  const [project,setProject]=useState<string>(FREE_SLUG);
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [voice,setVoice]=useState("nova");
  const [showVP,setShowVP]=useState(false);
  const [oracleOpen,setOracleOpen]=useState(false);
  const [attachments,setAttachments]=useState<AttachFile[]>([]);
  const [showSessions,setShowSessions]=useState(false);

  const [sessions,setSessions] = useState<ChatSession[]>(loadSessions);
  const [currentSession,setCurrentSession] = useState<ChatSession>(()=>{
    const ss=loadSessions(); return ss.length>0?ss[ss.length-1]:mkSession(FREE_SLUG,"Chat Livre");
  });
  const messages = currentSession.messages;

  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef     = useRef<HTMLTextAreaElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const camRef    = useRef<HTMLInputElement>(null);

  const {speakingId,speak,stop:stopTTS} = useTTS();
  const {listening,start:startListen,stop:stopListen} = useVoiceInput(
    useCallback((t:string)=>setInput(p=>p?`${p} ${t}`:t),[])
  );

  useEffect(()=>{
    api.get<Project[]>("/api/projects").then(p=>setProjects(p)).catch(()=>{});
  },[]);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,loading]);

  function saveSession(sess:ChatSession, msgs:Message[]) {
    const title = msgs.find(m=>m.role==="user")?.text?.slice(0,55) ?? sess.title;
    const updated:ChatSession = {...sess, messages:msgs, title:title||"Nova conversa", updatedAt:Date.now()};
    setCurrentSession(updated);
    setSessions(prev=>{
      const without = prev.filter(s=>s.id!==updated.id);
      const next = [...without, updated];
      saveSessions(next); return next;
    });
  }

  function newChat(){
    stopTTS();
    const projName = project===FREE_SLUG?"Chat Livre":(projects.find(p=>p.slug===project)?.name??"Projeto");
    const sess = mkSession(project, projName);
    setCurrentSession(sess);
    setSessions(prev=>{const n=[...prev,sess];saveSessions(n);return n;});
    setInput(""); setAttachments([]); setShowSessions(false);
  }

  function selectSession(s:ChatSession){
    stopTTS(); setCurrentSession(s); setProject(s.projectSlug);
    setInput(""); setAttachments([]); setShowSessions(false);
  }

  function deleteSession(id:string){
    setSessions(prev=>{const n=prev.filter(s=>s.id!==id);saveSessions(n);return n;});
    if(currentSession.id===id){
      const remaining = sessions.filter(s=>s.id!==id);
      if(remaining.length>0){
        setCurrentSession(remaining[remaining.length-1]);
      } else {
        const projName = project===FREE_SLUG?"Chat Livre":(projects.find(p=>p.slug===project)?.name??"Projeto");
        setCurrentSession(mkSession(project, projName));
      }
    }
  }

  function clearAll(){
    const projName = project===FREE_SLUG?"Chat Livre":(projects.find(p=>p.slug===project)?.name??"Projeto");
    const sess = mkSession(project, projName);
    setSessions([sess]); saveSessions([sess]); setCurrentSession(sess); setShowSessions(false);
  }

  function addMessages(newMsgs:Message[]){
    saveSession(currentSession, [...messages, ...newMsgs]);
  }

  function buildHistory():HistMsg[]{
    return messages.slice(-20).map(m=>({role:m.role==="user"?"user":"assistant",content:m.text}));
  }

  async function processFile(file:File):Promise<AttachFile|null>{
    return new Promise(resolve=>{
      const reader=new FileReader(); const id=`f${Date.now()}${Math.random().toString(36).slice(2)}`;
      if(file.type.startsWith("image/")){reader.onload=e=>{const d=e.target?.result as string;resolve({id,name:file.name,mimeType:file.type,data:d.split(",")[1],preview:d,kind:"image"});};reader.readAsDataURL(file);}
      else if(file.type.startsWith("text/")||/\.(txt|md|csv|json)$/i.test(file.name)){reader.onload=e=>resolve({id,name:file.name,mimeType:file.type,data:e.target?.result as string,kind:"text"});reader.readAsText(file);}
      else resolve({id,name:file.name,mimeType:file.type,data:"",kind:"doc"});
    });
  }

  async function handleFiles(fl:FileList|null){
    if(!fl)return;
    const p=await Promise.all(Array.from(fl).slice(0,4).map(processFile));
    setAttachments(prev=>[...prev,...(p.filter(Boolean) as AttachFile[])].slice(0,4));
  }

  async function send(){
    const q=input.trim();
    if(!q&&attachments.length===0) return;
    if(loading) return;
    const textA=attachments.filter(a=>a.kind==="text").map(a=>`[Arquivo: ${a.name}]\n${a.data.slice(0,2000)}`).join("\n\n---\n\n");
    const qFull=[q,textA].filter(Boolean).join("\n\n");
    const imgA=attachments.filter(a=>a.kind==="image").map(a=>({type:"image",mimeType:a.mimeType,data:a.data}));
    const userMsg:Message={id:`u${Date.now()}`,role:"user",text:q||(attachments.map(a=>a.name).join(", ")),attachments:attachments.map(a=>({name:a.name,kind:a.kind,preview:a.preview})),ts:Date.now()};
    const msgsWith=[...messages,userMsg];
    saveSession(currentSession, msgsWith);
    setInput(""); setAttachments([]); setLoading(true);
    try{
      const res=await api.post<{answer:string;mode:string;confidence:number;sources:Source[];toolCalls:ToolCall[];conversationType:string}>(
        `/api/projects/${project}/brain/chat`,{query:qFull||"(sem texto)",history:buildHistory(),attachments:imgA}
      );
      const brainMsg:Message={id:`b${Date.now()}`,role:"brain",text:res.answer,mode:res.mode as Message["mode"],confidence:res.confidence,sources:res.sources,toolCalls:res.toolCalls,conversationType:res.conversationType,ts:Date.now()};
      saveSession(currentSession,[...msgsWith,brainMsg]);
    }catch(e:unknown){
      saveSession(currentSession,[...msgsWith,{id:`e${Date.now()}`,role:"brain",text:`Erro: ${e instanceof Error?e.message:"desconhecido"}`,ts:Date.now()}]);
    }finally{setLoading(false);setTimeout(()=>taRef.current?.focus(),50);}
  }

  function handleKey(e:React.KeyboardEvent){if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}

  const projectLabel = project===FREE_SLUG?"Chat Livre":(projects.find(p=>p.slug===project)?.name??"");

  return(
    <>
      <AnimatePresence>
        {oracleOpen&&<OracleMode project={project} voice={voice} messages={messages} onClose={()=>setOracleOpen(false)} onAddMessages={addMessages}/>}
      </AnimatePresence>

      {/* Sessions panel */}
      <AnimatePresence>
        {showSessions&&(
          <>
            <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="fixed inset-0 z-30 lg:hidden" style={{background:"rgba(0,0,0,0.55)"}}
              onClick={()=>setShowSessions(false)}/>
            <motion.div initial={{x:-280}} animate={{x:0}} exit={{x:-280}} transition={{type:"spring",damping:28,stiffness:280}}
              className="fixed left-0 top-0 bottom-0 z-40 w-72 overflow-hidden"
              style={{borderRight:"1px solid rgba(255,255,255,0.06)"}}>
              <SessionsPanel sessions={sessions} currentId={currentSession.id} onSelect={selectSession} onDelete={deleteSession} onClearAll={clearAll} onClose={()=>setShowSessions(false)}/>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex flex-col" style={{height:"calc(100dvh - 8rem)"}}>

        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-1 shrink-0" style={{borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button onClick={()=>setShowSessions(v=>!v)} title="Histórico"
              className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] shrink-0"
              style={{background:showSessions?"rgba(99,102,241,0.2)":"rgba(255,255,255,0.05)",color:showSessions?"#c7d2fe":"rgba(255,255,255,0.4)",border:`1px solid ${showSessions?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.07)"}`}}>
              <History size={13}/>
              {sessions.length>0&&<span className="text-[9px] font-bold ml-0.5">{Math.min(sessions.length,99)}</span>}
            </button>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-white truncate leading-tight">{currentSession.title}</p>
              <p className="text-[10px] hidden sm:block" style={{color:"rgba(255,255,255,0.2)"}}>{projectLabel} · {messages.length} msgs</p>
            </div>
          </div>

          <button onClick={()=>setOracleOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold shrink-0"
            style={{background:"linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.2))",color:"#c4b5fd",border:"1px solid rgba(139,92,246,0.3)"}}>
            🔮<span className="hidden sm:inline ml-0.5"> Oráculo</span>
          </button>

          <div className="relative shrink-0">
            <button onClick={()=>setShowVP(v=>!v)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-[11px]"
              style={{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.35)",border:"1px solid rgba(255,255,255,0.07)"}}>
              🎙 {voice}
            </button>
            {showVP&&(
              <div className="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-xl" style={{background:"#0d1224",border:"1px solid rgba(255,255,255,0.1)",width:"155px"}}>
                {VOICES.map(v=>(
                  <button key={v.id} onClick={()=>{setVoice(v.id);setShowVP(false);}} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/5">
                    <span className="text-[12px] font-medium" style={{color:v.id===voice?"#818cf8":"rgba(255,255,255,0.65)"}}>{v.l}{v.id===voice&&" ✓"}</span>
                    <span className="text-[10px]" style={{color:"rgba(255,255,255,0.25)"}}>{v.d}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {speakingId&&<button onClick={stopTTS} className="p-2 rounded-xl shrink-0" style={{background:"rgba(139,92,246,0.15)",color:"#c4b5fd",border:"1px solid rgba(139,92,246,0.3)"}}><VolumeX size={13}/></button>}

          <select value={project} onChange={e=>setProject(e.target.value)}
            className="shrink-0 text-[12px] rounded-xl px-2 py-1.5 outline-none" style={{background:"rgba(8,12,30,0.9)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.65)",maxWidth:130}}>
            <option value={FREE_SLUG}>✨ Chat Livre</option>
            {projects.map(p=><option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>

          <button onClick={newChat} title="Nova conversa"
            className="p-2 rounded-xl shrink-0" style={{background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.4)",border:"1px solid rgba(255,255,255,0.07)"}}>
            <Plus size={14}/>
          </button>
        </div>

        {showVP&&<div className="fixed inset-0 z-40" onClick={()=>setShowVP(false)}/>}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-5 py-3 pr-1 relative" style={{overscrollBehavior:"contain"}}>
          {messages.length===0&&(
            <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-5">
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-1/4 left-1/4 w-56 h-56 rounded-full opacity-[0.04]" style={{background:"radial-gradient(circle,#6366f1,transparent)",filter:"blur(60px)"}}/>
                <div className="absolute bottom-1/3 right-1/4 w-44 h-44 rounded-full opacity-[0.03]" style={{background:"radial-gradient(circle,#8b5cf6,transparent)",filter:"blur(50px)"}}/>
              </div>
              <OracleBall state="idle" size={68}/>
              <div>
                <p className="text-sm font-semibold mb-1" style={{color:"rgba(255,255,255,0.45)"}}>
                  {project===FREE_SLUG?"Chat Livre — sem projeto selecionado":`Projeto: ${projectLabel}`}
                </p>
                <p className="text-[11px]" style={{color:"rgba(255,255,255,0.18)"}}>🔮 Oráculo · 🎤 Voz · 📎 Arquivos · 🧠 Ferramentas</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-xs">
                {[
                  project===FREE_SLUG&&"💡 Me ajuda com uma ideia",
                  project===FREE_SLUG&&"🌐 Pesquisa IA em 2026",
                  project!==FREE_SLUG&&"📊 Como está o projeto?",
                  project!==FREE_SLUG&&"✅ Cria uma tarefa",
                  "🧠 Salva memória importante",
                ].filter(Boolean).map(h=>(
                  <button key={h as string} onClick={()=>setInput((h as string).replace(/^\S+ /,""))}
                    className="text-[11px] px-3 py-1.5 rounded-full transition-all hover:opacity-80"
                    style={{background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.32)",border:"1px solid rgba(255,255,255,0.07)"}}>
                    {h as string}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg=>(
            <div key={msg.id} className={`flex ${msg.role==="user"?"justify-end":"justify-start"}`}>
              {msg.role==="user"
                ?<motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="max-w-[88%] sm:max-w-[72%]">
                  {(msg.attachments??[]).length>0&&(
                    <div className="flex gap-2 mb-2 justify-end flex-wrap">
                      {msg.attachments!.map((a,i)=>
                        a.preview
                          ?<img key={i} src={a.preview} alt={a.name} className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover" style={{border:"1px solid rgba(255,255,255,0.1)"}}/>
                          :<div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px]" style={{background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.5)"}}>📎 {a.name}</div>
                      )}
                    </div>
                  )}
                  <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-[13px] leading-relaxed"
                    style={{background:"linear-gradient(135deg,rgba(99,102,241,0.38),rgba(139,92,246,0.3))",color:"#e0e7ff",border:"1px solid rgba(99,102,241,0.35)"}}>
                    {msg.text}
                  </div>
                  {msg.ts&&<p className="text-[9px] mt-1 text-right pr-1" style={{color:"rgba(255,255,255,0.12)"}}>{new Date(msg.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</p>}
                </motion.div>
                :<div className="max-w-full sm:max-w-[92%] w-full">
                  <BrainMsg msg={msg} speakingId={speakingId} onSpeak={(id,t)=>speak(id,t,voice)}/>
                </div>
              }
            </div>
          ))}

          {loading&&(
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-sm" style={{background:"linear-gradient(135deg,#ec4899,#8b5cf6)"}}>🧠</div>
              <motion.div initial={{opacity:0}} animate={{opacity:1}} className="px-4 py-3 rounded-2xl rounded-tl-sm" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
                <div className="flex items-center gap-1.5">
                  {[0,150,300].map(d=><span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{background:["#6366f1","#8b5cf6","#ec4899"][d/150],animationDelay:`${d}ms`}}/>)}
                </div>
              </motion.div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input area — glass morphism */}
        <div className="pt-3 shrink-0" style={{borderTop:"1px solid rgba(255,255,255,0.06)"}}>
          {attachments.length>0&&<div className="flex gap-2 mb-2 flex-wrap">{attachments.map(f=><AttachChip key={f.id} file={f} onRemove={()=>setAttachments(prev=>prev.filter(a=>a.id!==f.id))}/>)}</div>}

          <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 4px 32px rgba(0,0,0,0.25)"}}>
            <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKey} disabled={loading} rows={2}
              placeholder={listening?"🎤 Ouvindo…":project===FREE_SLUG?"Pergunte qualquer coisa…":"Pergunte, pesquise, crie tarefas…"}
              className="w-full px-4 py-3 text-[13px] outline-none resize-none bg-transparent"
              style={{color:"rgba(255,255,255,0.88)",lineHeight:"1.6",border:"none",borderRadius:0,minHeight:60,maxHeight:160}}
            />
            <div className="flex items-center justify-between px-3 py-2" style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
              <div className="flex items-center gap-1">
                <button onClick={()=>camRef.current?.click()} title="Tirar foto" className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{color:"rgba(255,255,255,0.28)"}}><Camera size={15}/></button>
                <button onClick={()=>fileRef.current?.click()} title="Anexar" className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{color:"rgba(255,255,255,0.28)"}}><Paperclip size={15}/></button>
                <button onClick={listening?stopListen:startListen} disabled={loading} title={listening?"Parar":"Falar"}
                  className="p-2 rounded-lg transition-colors"
                  style={{color:listening?"#f87171":"rgba(255,255,255,0.28)",background:listening?"rgba(239,68,68,0.1)":"transparent"}}>
                  {listening?<MicOff size={15}/>:<Mic size={15}/>}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] hidden md:block" style={{color:"rgba(255,255,255,0.12)"}}>Ctrl+Enter</span>
                <motion.button onClick={send} disabled={(!input.trim()&&attachments.length===0)||loading}
                  whileHover={{scale:1.02}} whileTap={{scale:0.97}}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold"
                  style={{
                    background:(!input.trim()&&attachments.length===0)||loading?"rgba(99,102,241,0.1)":"linear-gradient(135deg,#6366f1,#8b5cf6)",
                    color:(!input.trim()&&attachments.length===0)||loading?"rgba(165,180,252,0.25)":"#fff",
                    cursor:(!input.trim()&&attachments.length===0)||loading?"not-allowed":"pointer",
                    boxShadow:(!input.trim()&&attachments.length===0)||loading?"none":"0 4px 16px rgba(99,102,241,0.3)",
                  }}>
                  {loading?<span className="w-4 h-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin"/>:<Send size={14}/>}
                  <span className="hidden sm:inline">Enviar</span>
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json" className="hidden" onChange={e=>handleFiles(e.target.files).then(()=>{if(fileRef.current)fileRef.current.value="";})}/>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>handleFiles(e.target.files).then(()=>{if(camRef.current)camRef.current.value="";})}/>
    </>
  );
}
