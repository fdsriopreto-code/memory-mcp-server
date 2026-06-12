import { useEffect, useState } from "react";
import { api } from "../services/api";
import { toast } from "sonner";

type WriteRequest = {
  id: string; sql: string; reason: string; circumstances: string;
  status: string; result: string | null; requestedAt: string; resolvedAt: string | null;
  project: { name: string; slug: string };
  connection: { name: string; type: string };
};

const STATUS_STYLE: Record<string, string> = {
  PENDING:  "bg-yellow-500/20 text-yellow-300",
  APPROVED: "bg-blue-500/20 text-blue-300",
  REJECTED: "bg-red-500/20 text-red-300",
  EXECUTED: "bg-emerald-500/20 text-emerald-300",
};

export default function WriteRequestsPage() {
  const [requests, setRequests] = useState<WriteRequest[]>([]);
  const [filter,   setFilter]   = useState<string>("PENDING");
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<WriteRequest[]>(`/api/write-requests?status=${filter}`);
      setRequests(data);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [filter]);

  async function approve(id: string) {
    try {
      await api.patch(`/api/write-requests/${id}/approve`, {});
      toast.success("Query executada com sucesso!");
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Erro na execução"); }
  }

  async function reject(id: string) {
    const reason = prompt("Motivo da rejeição (opcional):");
    try {
      await api.patch(`/api/write-requests/${id}/reject`, { reason: reason ?? "Rejeitado" });
      toast.success("Rejeitado");
      load();
    } catch { toast.error("Erro"); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Write Requests</h1>
          <p className="text-xs text-gray-400 mt-0.5">Solicitações do Claude para escrever no banco de dados</p>
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500">
          <option value="PENDING">Pendentes</option>
          <option value="APPROVED">Aprovados</option>
          <option value="EXECUTED">Executados</option>
          <option value="REJECTED">Rejeitados</option>
        </select>
      </div>

      {loading && <div className="text-gray-400 text-sm">Carregando...</div>}

      <div className="space-y-3">
        {requests.map(r => (
          <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{r.project.name} → {r.connection.name}</p>
                  <p className="text-xs text-gray-400 mt-1">{r.reason}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{new Date(r.requestedAt).toLocaleString("pt-BR")}</p>
                </div>
                <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="text-xs text-gray-500 hover:text-white transition-colors shrink-0">
                  {expanded === r.id ? "ocultar" : "detalhes"}
                </button>
              </div>

              {expanded === r.id && (
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Circunstâncias</p>
                    <p className="text-xs text-gray-300">{r.circumstances}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">SQL a executar</p>
                    <pre className="text-xs text-emerald-300 bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto">{r.sql}</pre>
                  </div>
                  {r.result && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Resultado</p>
                      <pre className="text-xs text-gray-300 bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto">{r.result}</pre>
                    </div>
                  )}
                </div>
              )}

              {r.status === "PENDING" && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => approve(r.id)}
                    className="px-4 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold rounded-lg transition-colors border border-emerald-600/30">
                    ✓ Aprovar e executar
                  </button>
                  <button onClick={() => reject(r.id)}
                    className="px-4 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs font-semibold rounded-lg transition-colors border border-red-600/30">
                    ✕ Rejeitar
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && requests.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-sm">Nenhuma solicitação {filter.toLowerCase()}.</div>
      )}
    </div>
  );
}
