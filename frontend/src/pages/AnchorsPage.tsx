import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../services/api";
import { useWs } from "../contexts/WsContext";

type Anchor = {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  patternType: "KEYWORD" | "REGEX" | "SEMANTIC";
  memoryIds: string[];
  isActive: boolean;
  priority: number;
  hitCount: number;
  createdAt: string;
};

type Project = { id: string; name: string; slug: string; color: string };
type Memory = { id: string; title: string; type: string; importance: number };

const PATTERN_COLORS = {
  KEYWORD: { bg: "rgba(16,185,129,0.12)", color: "#10b981" },
  REGEX: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
  SEMANTIC: { bg: "rgba(139,92,246,0.12)", color: "#8b5cf6" },
};

export default function AnchorsPage() {
  const { subscribe } = useWs();
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<string>("");
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [testQuery, setTestQuery] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const [form, setForm] = useState({
    name: "", description: "", pattern: "",
    patternType: "KEYWORD" as "KEYWORD" | "REGEX" | "SEMANTIC",
    memoryIds: [] as string[], priority: 3,
  });

  useEffect(() => {
    api.get<Project[]>("/api/projects").then(p => {
      setProjects(p);
      if (p.length) setProject(p[0].slug);
    }).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    setLoading(true);
    Promise.all([
      api.get<Anchor[]>(`/api/projects/${project}/anchors`),
      api.get<Memory[]>(`/api/projects/${project}/memories`),
    ]).then(([a, m]) => { setAnchors(a); setMemories(m); })
      .catch(() => toast.error("Erro ao carregar anchors"))
      .finally(() => setLoading(false));
  }, [project]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe("refresh", (data: any) => {
      if (data?.resource === "anchor") load();
    });
  }, [subscribe, load]);

  async function createAnchor() {
    if (!form.name || !form.pattern) { toast.error("Nome e padrão são obrigatórios"); return; }
    if (!form.memoryIds.length) { toast.error("Vincule pelo menos 1 memória"); return; }
    try {
      await api.post(`/api/projects/${project}/anchors`, form);
      toast.success("Anchor criado!");
      setShowForm(false);
      setForm({ name: "", description: "", pattern: "", patternType: "KEYWORD", memoryIds: [], priority: 3 });
      load();
    } catch (e: any) { toast.error(e.message); }
  }

  async function toggleAnchor(id: string, isActive: boolean) {
    try {
      await api.patch(`/api/anchors/${id}`, { isActive: !isActive });
      load();
    } catch { toast.error("Erro ao atualizar"); }
  }

  async function deleteAnchor(id: string, name: string) {
    if (!confirm(`Deletar anchor "${name}"?`)) return;
    try {
      await api.delete(`/api/anchors/${id}`);
      toast.success("Anchor deletado");
      load();
    } catch { toast.error("Erro ao deletar"); }
  }

  function toggleMemory(id: string) {
    setForm(f => ({
      ...f,
      memoryIds: f.memoryIds.includes(id) ? f.memoryIds.filter(m => m !== id) : [...f.memoryIds, id],
    }));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Memory Anchors</h1>
          <p className="text-sm text-white/40 mt-0.5">
            Gatilhos automáticos que injetam contexto quando padrões são detectados
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select value={project} onChange={e => setProject(e.target.value)}
            className="text-sm rounded-xl px-3 py-1.5 border outline-none bg-white/5 border-white/10 text-white/70">
            {projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowForm(s => !s)}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" }}>
            + Novo Anchor
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-2xl border border-white/10 p-5 space-y-4"
          style={{ background: "rgba(99,102,241,0.06)" }}>
          <h3 className="text-sm font-semibold text-white/70">Criar Anchor</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/40 mb-1 block">Nome *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Regras de Pagamento"
                className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50" />
            </div>
            <div>
              <label className="text-xs text-white/40 mb-1 block">Tipo de Padrão</label>
              <select value={form.patternType} onChange={e => setForm(f => ({ ...f, patternType: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none">
                <option value="KEYWORD">KEYWORD — palavra-chave</option>
                <option value="REGEX">REGEX — expressão regular</option>
                <option value="SEMANTIC">SEMANTIC — similaridade</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Padrão *</label>
            <input value={form.pattern} onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
              placeholder={form.patternType === "KEYWORD" ? "pagamento, PIX, cobrança" : form.patternType === "REGEX" ? "\\bpix|cobran[çc]a\\b" : "fluxo de pagamento com MercadoPago"}
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono" />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Descrição</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Para que serve este anchor..."
              className="w-full px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label className="text-xs text-white/40 mb-1 block">Memórias a injetar ({form.memoryIds.length} selecionadas)</label>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
              {memories.map(m => (
                <label key={m.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors">
                  <input type="checkbox" checked={form.memoryIds.includes(m.id)} onChange={() => toggleMemory(m.id)}
                    className="rounded" />
                  <span className="text-xs text-white/60 flex-1 truncate">[{m.type}] {m.title}</span>
                  <span className="text-[10px] text-white/30">imp:{m.importance}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs text-white/40 mb-1 block">Prioridade: {form.priority}/5</label>
              <input type="range" min={1} max={5} value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
                className="w-full" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl text-sm text-white/40 hover:text-white/70 transition-colors">
                Cancelar
              </button>
              <button onClick={createAnchor}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                Criar Anchor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test panel */}
      <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(16,185,129,0.04)" }}>
        <h3 className="text-sm font-semibold text-emerald-400 mb-3">Testar Anchors</h3>
        <div className="flex gap-3">
          <input value={testQuery} onChange={e => setTestQuery(e.target.value)}
            placeholder="Digite uma query para ver quais anchors seriam ativados..."
            className="flex-1 px-3 py-2 rounded-xl text-sm bg-white/5 border border-white/10 text-white outline-none focus:border-emerald-500/50"
            onKeyDown={e => { if (e.key === "Enter") runTest(); }} />
          <button onClick={runTest} disabled={testLoading || !testQuery.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40">
            {testLoading ? "..." : "Testar"}
          </button>
        </div>
        {testResult && (
          <pre className="mt-3 text-xs text-white/60 bg-black/20 rounded-xl p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {testResult}
          </pre>
        )}
      </div>

      {/* Anchors list */}
      {loading ? (
        <div className="text-center text-white/30 py-12">Carregando anchors...</div>
      ) : anchors.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border border-white/5" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-white/30 text-sm">Nenhum anchor criado ainda.</p>
          <p className="text-white/20 text-xs mt-1">Anchors injetam contexto automaticamente quando padrões são detectados nas buscas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {anchors.map(anchor => {
            const pc = PATTERN_COLORS[anchor.patternType];
            return (
              <div key={anchor.id}
                className="rounded-2xl border p-4 transition-all"
                style={{
                  background: anchor.isActive ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
                  borderColor: anchor.isActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                  opacity: anchor.isActive ? 1 : 0.6,
                }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-white">{anchor.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: pc.bg, color: pc.color }}>
                        {anchor.patternType}
                      </span>
                      <span className="text-[10px] text-white/30">prio {anchor.priority}/5</span>
                      {anchor.hitCount > 0 && (
                        <span className="text-[10px] text-emerald-400">{anchor.hitCount} hits</span>
                      )}
                    </div>
                    {anchor.description && (
                      <p className="text-xs text-white/40 mb-2">{anchor.description}</p>
                    )}
                    <code className="text-xs px-2 py-0.5 rounded-lg font-mono"
                      style={{ background: pc.bg, color: pc.color }}>
                      {anchor.pattern}
                    </code>
                    <p className="text-xs text-white/30 mt-2">
                      {anchor.memoryIds.length} memória{anchor.memoryIds.length !== 1 ? "s" : ""} vinculada{anchor.memoryIds.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleAnchor(anchor.id, anchor.isActive)}
                      className="px-3 py-1.5 rounded-xl text-xs transition-all"
                      style={{
                        background: anchor.isActive ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.06)",
                        color: anchor.isActive ? "#10b981" : "rgba(255,255,255,0.3)",
                      }}>
                      {anchor.isActive ? "Ativo" : "Inativo"}
                    </button>
                    <button onClick={() => deleteAnchor(anchor.id, anchor.name)}
                      className="px-3 py-1.5 rounded-xl text-xs text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-all">
                      Deletar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  async function runTest() {
    if (!testQuery.trim() || !project) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      // Simular test localmente com os anchors carregados
      const matched = anchors.filter(a => {
        if (!a.isActive) return false;
        if (a.patternType === "KEYWORD") return testQuery.toLowerCase().includes(a.pattern.toLowerCase());
        if (a.patternType === "REGEX") { try { return new RegExp(a.pattern, "i").test(testQuery); } catch { return false; } }
        return false; // SEMANTIC requires backend
      });
      if (matched.length === 0) {
        setTestResult(`Nenhum anchor KEYWORD/REGEX ativado para: "${testQuery}"\n(Anchors SEMANTIC requerem o servidor MCP)`);
      } else {
        const lines = matched.map(a =>
          `"${a.name}" [${a.patternType}]\n   Padrão: ${a.pattern}\n   ${a.memoryIds.length} memória(s) seriam injetadas`
        ).join("\n\n");
        setTestResult(`${matched.length} anchor(s) ativado(s):\n\n${lines}`);
      }
    } finally { setTestLoading(false); }
  }
}
