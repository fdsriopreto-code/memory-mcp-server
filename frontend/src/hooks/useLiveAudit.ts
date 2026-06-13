import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { useWs } from "../contexts/WsContext";

export type AuditLog = {
  id: string;
  tool: string;
  input: unknown;
  outputSummary: string | null;
  createdAt: string;
  sessionId: string | null;
  project: { name: string; slug: string; color: string } | null;
};

export function useLiveAudit(limit = 50) {
  const [logs, setLogs]         = useState<AuditLog[]>([]);
  const [newIds, setNewIds]     = useState<Set<string>>(new Set());
  const [isActive, setIsActive] = useState(false);
  const lastActivity            = useRef<number>(0);
  const { subscribe }           = useWs();

  useEffect(() => {
    api.get<AuditLog[]>("/api/audit-logs")
      .then(all => {
        const fresh = all.slice(0, limit);
        setLogs(fresh);
        if (fresh.length > 0) {
          const last = new Date(fresh[0].createdAt).getTime();
          if (Date.now() - last < 30_000) {
            lastActivity.current = last;
            setIsActive(true);
          }
        }
      })
      .catch(() => {});
  }, [limit]);

  useEffect(() => {
    return subscribe("audit_log", (data) => {
      const log = data as AuditLog;
      lastActivity.current = Date.now();
      setIsActive(true);
      setLogs(prev => [log, ...prev].slice(0, limit));
      const id = log.id;
      setNewIds(prev => new Set([...prev, id]));
      setTimeout(() => setNewIds(prev => { const s = new Set(prev); s.delete(id); return s; }), 3000);
    });
  }, [subscribe, limit]);

  useEffect(() => {
    const ticker = setInterval(() => {
      setIsActive(Date.now() - lastActivity.current < 30_000);
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  return { logs, newIds, isActive };
}
