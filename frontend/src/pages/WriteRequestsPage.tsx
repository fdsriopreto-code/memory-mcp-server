import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";
import { useWs } from "../contexts/WsContext";

type WriteRequest = {
  id: string; sql: string; reason: string; circumstances: string;
  status: string; result: string | null; requestedAt: string; resolvedAt: string | null;
  project: { name: string; slug: string };
  connection: { name: string; type: string };
};

const STATUS_TABS = [
  { key: "PENDING",  label: "Pendentes",  color: "text-yellow-300" },
  { key: "EXECUTED", label: "Executados", color: "text-emerald-300" },
  { key: "REJECTED", label: "Rejeitados", color: "text-red-400" },
  { key: "APPROVED", label: "Aprovados",  color: "text-blue-300" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  PENDING:  "bg-yellow-500/15 text-yellow-300 border-yellow-500/20",
  APPROVED: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/20",
  EXECUTED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
};

function relTime(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60)   return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return new Date(d).toLocaleDateString("pt-BR");
}

export default function WriteRequestsPage() {
  const [requests, setRequests] = useState<WriteRequest[]>([]);
  const [filter,   setFilter]   = useState<string>("PENDING");
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [counts,   setCounts]   = useState<Record<string, number>>({});
  const { subscribe } = useWs();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, executed, rejected, approved] = await Promise.all([
        api.get<WriteRequest[]>("/api/write-requests?status=PENDING"),
        api.get<WriteRequest[]>("/api/write-requests?status=EXECUTED"),
        api.get<WriteRequest[]>("/api/write-requests?status=REJECTED"),
        api.get<WriteRequest[]>("/api/write-requests?status=APPROVED"),
      ]);
      setCounts({
        PENDING: pending.length,
        EXECUTED: executed.length,
        REJECTED: rejected.length,
        APPROVED: approved.length,
      });
      const allByFilter: Record<string, WriteRequest[]> = { PENDING: pending, EXECUTED: executed, REJECTED: rejected, APPROVED: approved };
      setRequests(allByFilter[filter] ?? []);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return subscribe("refresh", (data) => {
      const ev = data as { resource: string };
      if (ev.resource === "write_request") load();
    });
  }, [subscribe, load]);

  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as { tool: string };
      if (log.tool === "db_write_request") load();
    });
  }, [subscribe, load]);

  async function approve(id: string) {
    try {
      await api.patch(`/api/write-requests/${id}/approve`, {});
      toast.success("Query executada com sucesso!");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro na execução"); }
  }

  async function reject(id: string) {
    const reason = prompt("Motivo da rejeição (opcional):");
    try {
      await api.patch(`/api/write-requests/${id}/reject`, { reason: reason ?? "Rejeitado" });
      toast.success("Rejeitado");
    } catch { toast.error("Erro"); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Write Requests</h1>
        <p className="text-xs text-gray-500 mt-0.5">Solicitações do Claude para escrever no banco de dados</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              filter === t.key
                ? "bg-gray-800 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                filter === t.key && t.key === "PENDING"
                  ? "bg-yellow-500/20 text-yellow-300"
                  : "bg-gray-700 text-gray-400"
              }`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div className="text-gray-500 text-sm">Carregando...</div>}

      <div className="space-y-3">
        {requests.map(r => (
          <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-colors">
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className={`text-[10px] font-bold px-2 py-1 rounded border shrink-0 mt-0.5 ${STATUS_BADGE[r.status]}`}>
                  {r.status}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{r.project.name}</p>
                    <span className="text-gray-600">→</span>
                    <p className="text-sm text-gray-400">{r.connection.name}</p>
                    <span className={`text-[10px] font-bold ml-1 ${
                      r.connection.type === "POSTGRES" ? "text-blue-500" : "text-gray-500"
                    }`}>{r.connection.type}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{r.reason}</p>
                  <p className="text-[11px] text-gray-600 mt-1">{relTime(r.requestedAt)}</p>
                </div>
                <button
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-gray-800"
                >
                  {expanded === r.id ? "▲ fechar" : "▼ detalhes"}
                </button>
              </div>

              {expanded === r.id && (
                <div className="mt-4 space-y-3 border-t border-gray-800 pt-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Circunstâncias</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{r.circumstances}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">SQL a executar</p>
                    <pre className="text-xs text-emerald-300 bg-gray-950 border border-gray-800 rounded-xl p-4 overflow-x-auto font-mono leading-relaxed">{r.sql}</pre>
                  </div>
                  {r.result && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Resultado</p>
                      <pre className="text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded-xl p-4 overflow-x-auto font-mono leading-relaxed">{r.result}</pre>
                    </div>
                  )}
                </div>
              )}

              {r.status === "PENDING" && (
                <div className="flex gap-2 mt-4 pt-3 border-t border-gray-800">
                  <button
                    onClick={() => approve(r.id)}
                    className="flex-1 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold rounded-xl transition-colors border border-emerald-600/30"
                  >
                    ✓ Aprovar e executar
                  </button>
                  <button
                    onClick={() => reject(r.id)}
                    className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs font-semibold rounded-xl transition-colors border border-red-600/30"
                  >
                    ✕ Rejeitar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && requests.length === 0 && (
        <div className="text-center py-12 text-gray-600 text-sm">
          <div className="text-4xl mb-3 opacity-20">✎</div>
          <p>Nenhuma solicitação {STATUS_TABS.find(t => t.key === filter)?.label.toLowerCase()}.</p>
        </div>
      )}
    </div>
  );
}
