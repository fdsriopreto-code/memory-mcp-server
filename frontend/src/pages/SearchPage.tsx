import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

const TYPE_COLOR: Record<string, string> = {
  DECISION: "#6366f1", CONTEXT: "#3b82f6", PATTERN: "#10b981",
  NOTE: "#f59e0b", BUG_FIX: "#ef4444", ARCHITECTURE: "#8b5cf6",
};

type Result = {
  id: string; title: string; content: string; type: string;
  tags: string[]; importance: number;
  project: { name: string; slug: string; color: string } | null;
};

export default function SearchPage() {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get<{ memories: Result[] }>(`/api/search?q=${encodeURIComponent(query)}`);
        setResults(data.memories);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
  }, [query]);

  function toggle(id: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function highlight(text: string, q: string) {
    if (!q.trim()) return text;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(regex, "<mark class=\"bg-indigo-500/30 text-indigo-200 rounded px-0.5\">$1</mark>");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Busca Global</h1>
        <p className="text-xs text-gray-500 mt-0.5">Pesquisa em todas as memórias de todos os projetos</p>
      </div>

      {/* Input */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-base">⌕</span>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar memórias... (mín. 2 caracteres)"
          className="w-full bg-gray-900 border border-gray-700 rounded-2xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Results count */}
      {query.trim().length >= 2 && !loading && (
        <p className="text-xs text-gray-600">
          {results.length === 0 ? "Nenhum resultado" : `${results.length} resultado${results.length > 1 ? "s" : ""}`}
        </p>
      )}

      {/* Results */}
      <div className="space-y-3">
        {results.map(r => {
          const isOpen = expanded.has(r.id);
          const color = TYPE_COLOR[r.type] ?? "#6b7280";
          return (
            <div key={r.id} className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <button
                onClick={() => toggle(r.id)}
                className="w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-gray-800/50 transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: `${color}22`, color }}>
                      {r.type.replace(/_/g, " ")}
                    </span>
                    {r.project && (
                      <span className="text-[10px] text-gray-500">{r.project.name}</span>
                    )}
                    {"★".repeat(r.importance).padEnd(5, "☆").split("").map((s, i) => (
                      <span key={i} className={s === "★" ? "text-amber-400 text-[10px]" : "text-gray-700 text-[10px]"}>{s}</span>
                    ))}
                  </div>
                  <p className="text-sm font-semibold text-white"
                    dangerouslySetInnerHTML={{ __html: highlight(r.title, query) }} />
                  {r.tags.length > 0 && (
                    <p className="text-[10px] text-gray-600 mt-1">{r.tags.join(" · ")}</p>
                  )}
                </div>
                <span className="text-gray-600 shrink-0 mt-0.5">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-4 border-t border-gray-800">
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed mt-3 font-sans"
                    dangerouslySetInnerHTML={{ __html: highlight(r.content, query) }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {query.trim().length < 2 && (
        <div className="text-center py-20 text-gray-700">
          <p className="text-4xl mb-3">⌕</p>
          <p className="text-sm">Digite para buscar em todas as memórias</p>
        </div>
      )}
    </div>
  );
}
