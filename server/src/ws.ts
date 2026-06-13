import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

let wss: WebSocketServer | null = null;

export function initWss(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
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
