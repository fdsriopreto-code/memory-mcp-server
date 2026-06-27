import { Mic } from "lucide-react";
import { useState, useEffect } from "react";

interface AIVoiceInputProps {
  onStart?: () => void;
  onStop?: (duration: number) => void;
  visualizerBars?: number;
  demoMode?: boolean;
  demoInterval?: number;
  className?: string;
}

export function AIVoiceInput({
  onStart,
  onStop,
  visualizerBars = 48,
  demoMode = false,
  demoInterval = 3000,
  className,
}: AIVoiceInputProps) {
  const [submitted, setSubmitted] = useState(false);
  const [time, setTime]           = useState(0);
  const [isClient, setIsClient]   = useState(false);
  const [isDemo, setIsDemo]       = useState(demoMode);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    if (submitted) {
      onStart?.();
      intervalId = setInterval(() => setTime(t => t + 1), 1000);
    } else {
      onStop?.(time);
      setTime(0);
    }
    return () => clearInterval(intervalId);
  }, [submitted]);

  useEffect(() => {
    if (!isDemo) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const run = () => {
      setSubmitted(true);
      timeoutId = setTimeout(() => {
        setSubmitted(false);
        timeoutId = setTimeout(run, 1000);
      }, demoInterval);
    };
    const init = setTimeout(run, 100);
    return () => { clearTimeout(timeoutId); clearTimeout(init); };
  }, [isDemo, demoInterval]);

  const fmt = (s: number) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  function handleClick() {
    if (isDemo) { setIsDemo(false); setSubmitted(false); }
    else setSubmitted(p => !p);
  }

  return (
    <div className={`w-full py-4 ${className ?? ""}`}>
      <div className="relative max-w-xl w-full mx-auto flex items-center flex-col gap-2">
        <button
          type="button"
          onClick={handleClick}
          className={`group w-16 h-16 rounded-xl flex items-center justify-center transition-colors ${submitted ? "" : "hover:bg-black/10 dark:hover:bg-white/10"}`}
        >
          {submitted ? (
            <div className="w-6 h-6 rounded-sm animate-spin bg-black dark:bg-white cursor-pointer" style={{animationDuration:"3s"}}/>
          ) : (
            <Mic className="w-6 h-6 text-black/70 dark:text-white/70"/>
          )}
        </button>

        <span className={`font-mono text-sm transition-opacity duration-300 ${submitted ? "text-black/70 dark:text-white/70" : "text-black/30 dark:text-white/30"}`}>
          {fmt(time)}
        </span>

        <div className="h-4 w-64 flex items-center justify-center gap-0.5">
          {Array.from({length:visualizerBars}).map((_,i) => (
            <div
              key={i}
              className={`w-0.5 rounded-full transition-all duration-300 ${submitted ? "bg-black/50 dark:bg-white/50 animate-pulse" : "bg-black/10 dark:bg-white/10 h-1"}`}
              style={submitted && isClient ? {height:`${20+Math.random()*80}%`,animationDelay:`${i*0.05}s`} : undefined}
            />
          ))}
        </div>

        <p className="h-4 text-xs text-black/70 dark:text-white/70">
          {submitted ? "Ouvindo…" : "Clique para falar"}
        </p>
      </div>
    </div>
  );
}
