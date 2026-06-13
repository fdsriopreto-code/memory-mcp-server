import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

type Log = {
  id: string;
  tool: string;
  input: unknown;
  outputSummary: string | null;
  createdAt: string;
  project: { name: string; slug: string; color: string } | null;
};

const POLL_MS = 3000;

export function useLiveAudit(limit = 50) {
  const [logs, setLogs]         = useState<Log[]>([]);
  const [newIds, setNewIds]     = useState<Set<string>>(new Set());
  const [isActive, setIsActive] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const lastActivity = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const all   = await api.get<Log[]>("/api/audit-logs");
        const fresh = all.slice(0, limit);
        if (cancelled) return;

        const incoming = new Set<string>();
        for (const l of fresh) {
          if (!knownIds.current.has(l.id)) incoming.add(l.id);
        }

        if (incoming.size > 0) {
          lastActivity.current = Date.now();
          setNewIds(incoming);
          setTimeout(() => setNewIds(new Set()), 2000);
          fresh.forEach(l => knownIds.current.add(l.id));
        }

        setLogs(fresh);
        setIsActive(Date.now() - lastActivity.current < 30_000);
      } catch {
        // silently ignore
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);

    // re-check isActive every second
    const ticker = setInterval(() => {
      setIsActive(Date.now() - lastActivity.current < 30_000);
    }, 1000);

    return () => { cancelled = true; clearInterval(id); clearInterval(ticker); };
  }, [limit]);

  return { logs, newIds, isActive };
}
