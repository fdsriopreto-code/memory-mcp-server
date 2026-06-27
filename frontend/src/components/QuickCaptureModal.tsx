import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../services/api";

type Project = { slug: string; name: string; color: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (title: string) => void;
}

export default function QuickCaptureModal({ open, onClose, onSaved }: Props) {
  const [text, setText]         = useState("");
  const [projectSlug, setSlug]  = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving]     = useState(false);
  const [status, setStatus]     = useState<"idle"|"saved"|"error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      api.get<Project[]>("/api/projects").then(p => { setProjects(p); if (p.length) setSlug(p[0].slug); }).catch(() => {});
      setTimeout(() => taRef.current?.focus(), 80);
    } else {
      setText(""); setStatus("idle"); setStatusMsg("");
    }
  }, [open]);

  // Detecta URL para mostrar badge
  const isUrl = /https?:\/\/[^\s]+/.test(text.trim());
  const isCode = /```[\s\S]+```/.test(text) || /^(import|export|function|const|class|def |public )/m.test(text);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true); setStatus("idle");
    try {
      const res = await api.post<{ ok: boolean; title: string; type: string; fetchedUrl?: string }>(
        "/api/quick-capture", { text: text.trim(), projectSlug: projectSlug || undefined }
      );
      setStatus("saved");
      setStatusMsg(`"${res.title}" salva como ${res.type}${res.fetchedUrl ? " (URL capturada)" : ""}`);
      onSaved?.(res.title);
      setTimeout(() => { onClose(); setText(""); setStatus("idle"); }, 1400);
    } catch (e: unknown) {
      setStatus("error");
      setStatusMsg(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    if (e.key === "Escape") onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100]" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={onClose} />

          <motion.div initial={{ opacity: 0, scale: 0.95, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }} transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed z-[101] left-1/2 -translate-x-1/2 w-full max-w-xl px-4"
            style={{ top: "15vh" }}>

            <div className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(8,12,30,0.98)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>

              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="text-base">⚡</span>
                <p className="text-sm font-semibold text-white flex-1">Captura Rápida</p>
                {isUrl && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(56,189,248,0.15)", color: "#38bdf8" }}>🔗 URL detectada</span>}
                {isCode && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>💻 Código</span>}
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>Ctrl+Enter</span>
              </div>

              {/* Textarea */}
              <div className="px-4 pt-3 pb-2">
                <textarea ref={taRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKey}
                  placeholder={"Cole uma ideia, URL, trecho de código, ou qualquer pensamento...\n\nCtrl+Enter para salvar · Esc para fechar"}
                  rows={5}
                  className="w-full bg-transparent outline-none resize-none text-[13px] leading-relaxed placeholder:opacity-30"
                  style={{ color: "rgba(255,255,255,0.88)" }} />
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 px-4 pb-4">
                {projects.length > 1 && (
                  <select value={projectSlug} onChange={e => setSlug(e.target.value)}
                    className="flex-1 text-[12px] rounded-xl px-3 py-2 outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }}>
                    {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                  </select>
                )}
                <AnimatePresence mode="wait">
                  {status === "saved" && (
                    <motion.p key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex-1 text-[11px] truncate" style={{ color: "#34d399" }}>✓ {statusMsg}</motion.p>
                  )}
                  {status === "error" && (
                    <motion.p key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex-1 text-[11px] truncate" style={{ color: "#f87171" }}>✗ {statusMsg}</motion.p>
                  )}
                  {status === "idle" && <div className="flex-1" />}
                </AnimatePresence>
                <motion.button onClick={save} disabled={!text.trim() || saving}
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold"
                  style={{
                    background: !text.trim() || saving ? "rgba(99,102,241,0.1)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                    color: !text.trim() || saving ? "rgba(165,180,252,0.3)" : "#fff",
                    cursor: !text.trim() || saving ? "not-allowed" : "pointer",
                  }}>
                  {saving
                    ? <span className="w-3 h-3 border-2 border-white/30 border-t-white/70 rounded-full animate-spin" />
                    : <span>⚡ Salvar</span>
                  }
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
