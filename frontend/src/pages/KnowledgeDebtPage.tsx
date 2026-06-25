import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../services/api";

type Project = { id: string; name: string; slug: string; color: string };

type DebtData = {
  coverage: number;
  totalFiles: number;
  coveredFiles: number;
  uncoveredFiles: number;
  uncoveredByDir: Record<string, string[]>;
  coveredSample: string[];
};

export default function KnowledgeDebtPage() {
  const [projects, setProjects]       = useState<Project[]>([]);
  const [project, setProject]         = useState("");
  const [repoPath, setRepoPath]       = useState("");
  const [data, setData]               = useState<DebtData | null>(null);
  const [loading, setLoading]         = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  function analyze() {
    if (!project || !repoPath.trim()) { toast.error("Informe o projeto e o caminho do repositório"); return; }
    setLoading(true);
    setData(null);
    api.get<DebtData>(`/api/projects/${project}/knowledge-debt?repoPath=${encodeURIComponent(repoPath.trim())}`)
      .then(setData)
      .catch(e => toast.error(e.message || "Erro ao analisar"))
      .finally(() => setLoading(false));
  }

  function toggleDir(dir: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }

  const coverageColor =
    !data ? "#64748b" :
    data.coverage >= 70 ? "#10b981" :
    data.coverage >= 40 ? "#f59e0b" :
    "#ef4444";

  const uncoveredDirs = data ? Object.entries(data.uncoveredByDir).sort((a, b) => b[1].length - a[1].length) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Knowledge Debt</h1>
        <p className="text-sm text-white/40 mt-0.5">Descubra quais módulos não têm memórias — os pontos cegos do cérebro</p>
      </div>

      {/* Input */}
      <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-white/40 mb-1 block">Projeto</label>
            <select value={project} onChange={e => setProject(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none">
              {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-white/40 mb-1 block">Caminho do repositório (absoluto)</label>
            <input value={repoPath} onChange={e => setRepoPath(e.target.value)}
              placeholder="Ex: C:\Users\usuario\projetos\meu-app  ou  /home/user/meu-app"
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono"
              onKeyDown={e => { if (e.key === "Enter") analyze(); }} />
          </div>
        </div>
        <button onClick={analyze} disabled={loading || !repoPath.trim()}
          className="px-6 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
          style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }}>
          {loading ? "Analisando…" : "Analisar Cobertura"}
        </button>
      </div>

      {data && (
        <>
          {/* Coverage score */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Cobertura", value: `${data.coverage}%`, color: coverageColor, big: true },
              { label: "Total de arquivos", value: data.totalFiles, color: "#94a3b8", big: false },
              { label: "Com memórias", value: data.coveredFiles, color: "#10b981", big: false },
              { label: "Sem memórias", value: data.uncoveredFiles, color: "#ef4444", big: false },
            ].map(({ label, value, color, big }) => (
              <div key={label} className="rounded-2xl border border-white/10 p-5"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className={`font-bold ${big ? "text-4xl" : "text-3xl"}`} style={{ color }}>{value}</p>
                <p className="text-sm text-white/40 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Coverage bar */}
          <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.02)" }}>
            <div className="flex justify-between text-xs text-white/40 mb-2">
              <span>Cobertura de conhecimento</span>
              <span>{data.coveredFiles} / {data.totalFiles} arquivos</span>
            </div>
            <div className="h-3 rounded-full overflow-hidden bg-white/5">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${data.coverage}%`, background: coverageColor }} />
            </div>
          </div>

          {/* Uncovered files by directory */}
          {uncoveredDirs.length > 0 && (
            <div className="rounded-2xl border border-white/10 overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="px-5 py-4 border-b border-white/10">
                <h3 className="text-sm font-semibold text-white">
                  Módulos sem cobertura ({data.uncoveredFiles} arquivos)
                </h3>
                <p className="text-xs text-white/40 mt-0.5">Organize por prioridade e adicione memórias com brain_learn ou memory_add</p>
              </div>
              <div className="divide-y divide-white/5">
                {uncoveredDirs.slice(0, 30).map(([dir, files]) => (
                  <div key={dir}>
                    <button onClick={() => toggleDir(dir)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors text-left">
                      <span className="text-white/20 text-xs w-4">{expandedDirs.has(dir) ? "▼" : "▶"}</span>
                      <span className="font-mono text-xs text-white/60 flex-1">{dir || "."}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
                        {files.length} {files.length === 1 ? "arquivo" : "arquivos"}
                      </span>
                    </button>
                    {expandedDirs.has(dir) && (
                      <div className="pl-12 pb-3 space-y-1">
                        {files.map(f => (
                          <div key={f} className="text-xs font-mono text-white/30 flex items-center gap-2">
                            <span className="w-1 h-1 rounded-full bg-red-400/40 shrink-0" />
                            {f.split("/").pop()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Covered sample */}
          {data.coveredSample.length > 0 && (
            <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(16,185,129,0.03)" }}>
              <h3 className="text-sm font-semibold text-emerald-400 mb-3">
                Arquivos com cobertura (amostra de {data.coveredSample.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {data.coveredSample.map(f => (
                  <span key={f} className="text-[10px] px-2 py-1 rounded-lg font-mono"
                    style={{ background: "rgba(16,185,129,0.08)", color: "#6ee7b7" }}>
                    {f.split("/").slice(-2).join("/")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="text-center py-20 text-white/20">
          <div className="text-5xl mb-4">&#x1F5FA;</div>
          <p className="text-sm">Informe o caminho do repositório para mapear lacunas de conhecimento.</p>
        </div>
      )}
    </div>
  );
}
