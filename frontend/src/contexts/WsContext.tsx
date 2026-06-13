import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Handler = (data: unknown) => void;

interface WsCtx {
  connected: boolean;
  subscribe: (type: string, handler: Handler) => () => void;
}

const WsContext = createContext<WsCtx>({ connected: false, subscribe: () => () => {} });

const BACKOFF = [1000, 2000, 5000, 10000, 30000];

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef<Map<string, Set<Handler>>>(new Map());
  const wsRef    = useRef<WebSocket | null>(null);
  const retries  = useRef(0);
  const timer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subscribe = useCallback((type: string, handler: Handler) => {
    if (!handlers.current.has(type)) handlers.current.set(type, new Set());
    handlers.current.get(type)!.add(handler);
    return () => handlers.current.get(type)?.delete(handler);
  }, []);

  useEffect(() => {
    let destroyed = false;

    function connect() {
      if (destroyed) return;

      const token = localStorage.getItem("mcp_token") ?? "";
      const base = import.meta.env.VITE_API_URL ?? "";
      const wsBase = base
        ? base.replace(/^https?/, (m: string) => m === "https" ? "wss" : "ws")
        : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
      const wsUrl = `${wsBase}/ws?token=${encodeURIComponent(token)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }
        setConnected(true);
        retries.current = 0;
      };

      ws.onclose = () => {
        setConnected(false);
        if (destroyed) return;
        const delay = BACKOFF[Math.min(retries.current++, BACKOFF.length - 1)];
        timer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; data: unknown };
          handlers.current.get(msg.type)?.forEach(h => h(msg.data));
          handlers.current.get("*")?.forEach(h => h(msg));
        } catch { /* ignore */ }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (timer.current) clearTimeout(timer.current);
      wsRef.current?.close();
    };
  }, []);

  return <WsContext.Provider value={{ connected, subscribe }}>{children}</WsContext.Provider>;
}

export const useWs = () => useContext(WsContext);
