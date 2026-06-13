import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import pkg from "jsonwebtoken";
const { verify } = pkg;
import { env } from "./config/env.js";

let wss: WebSocketServer | null = null;

export function initWss(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = url.searchParams.get("token");
      if (!token) { ws.terminate(); return; }
      verify(token, env.JWT_SECRET);
    } catch {
      ws.terminate();
      return;
    }

    ws.on("error", () => ws.terminate());
    ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
  });

  console.log("[WS] WebSocket server ativo em /ws");
}

export function broadcast(type: string, data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg, (err) => { if (err) client.terminate(); });
    }
  });
}
