import * as https from "https";
import * as http from "http";

export interface Memory {
  id:             string;
  title:          string;
  type:           string;
  content:        string;
  importance:     number;
  epistemicStatus: string;
  isPinned:       boolean;
  tags:           string[];
}

export interface BrainStats {
  total:       number;
  pinned:      number;
  links:       number;
  healthScore: number;
  hot:         number;
}

export class McpClient {
  private sessionId: string | null = null;
  private reqId = 100;

  constructor(private serverUrl: string, private apiKey: string) {}

  async initialize(): Promise<void> {
    const resp = await this.post({
      jsonrpc: "2.0", id: this.reqId++, method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vscode-memory-mcp", version: "1.0.0" }
      }
    });
    if (resp.sessionId) this.sessionId = resp.sessionId;
  }

  async sessionStart(project: string, focus?: string): Promise<string> {
    return this.tool("brain_session_start", { project, focus: focus ?? "sessão de trabalho no VS Code" });
  }

  async pulse(project: string): Promise<BrainStats> {
    const text = await this.tool("brain_pulse", { project });
    // Parse stats from text
    const total   = Number(text.match(/Total mem[^:]*:\s*(\d+)/)?.[1] ?? 0);
    const hot     = Number(text.match(/Quentes[^:]*:\s*(\d+)/)?.[1]  ?? 0);
    const links   = Number(text.match(/Total links[^:]*:\s*(\d+)/)?.[1] ?? 0);
    const pinned  = Number(text.match(/Pinadas[^:]*:\s*(\d+)/)?.[1]  ?? 0);
    return { total, hot, links, pinned, healthScore: total > 0 ? Math.min(100, Math.round((links / total) * 100 + hot * 2)) : 0 };
  }

  async search(project: string, query: string, limit = 8): Promise<Memory[]> {
    const text = await this.tool("memory_search", { project, query, limit: Math.min(limit, 20) });
    return this.parseMemories(text);
  }

  async addMemory(project: string, type: string, title: string, content: string, tags: string[]): Promise<string> {
    return this.tool("memory_add", { project, type, title, content, tags, importance: 4 });
  }

  async learn(project: string, text: string): Promise<string> {
    return this.tool("brain_learn", { project, text });
  }

  private async tool(name: string, args: Record<string, unknown>): Promise<string> {
    const resp = await this.post({
      jsonrpc: "2.0", id: this.reqId++, method: "tools/call",
      params: { name, arguments: args }
    });
    const d = resp.data as {
      error?:  { message?: string };
      result?: { content?: Array<{ text?: string }> };
    };
    if (d?.error) throw new Error(d.error.message ?? "MCP error");
    return d?.result?.content?.[0]?.text ?? "";
  }

  private post(body: object): Promise<{ data: Record<string, unknown>; sessionId?: string }> {
    return new Promise((resolve, reject) => {
      const url      = new URL("/mcp", this.serverUrl);
      const isHttps  = url.protocol === "https:";
      const payload  = JSON.stringify(body);
      const headers: Record<string, string> = {
        "Content-Type":  "application/json",
        "Accept":        "application/json, text/event-stream",
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Length": Buffer.byteLength(payload).toString(),
      };
      if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

      const options = {
        hostname: url.hostname,
        port:     url.port || (isHttps ? 443 : 80),
        path:     url.pathname,
        method:   "POST",
        headers,
        timeout:  15000,
      };

      const req = (isHttps ? https : http).request(options, (res) => {
        const sessionId = res.headers["mcp-session-id"] as string | undefined;
        const chunks: Buffer[] = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          const line = raw.split("\n").find(l => l.startsWith("data:"));
          if (!line) { reject(new Error("Empty MCP response")); return; }
          try {
            resolve({ data: JSON.parse(line.slice(5).trim()), sessionId });
          } catch {
            reject(new Error(`MCP parse error: ${raw.slice(0, 120)}`));
          }
        });
      });

      req.on("error",   reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("MCP request timeout")); });
      req.write(payload);
      req.end();
    });
  }

  private parseMemories(text: string): Memory[] {
    const blocks = text.split(/\n## \d+\./).slice(1);
    return blocks.slice(0, 10).map((block, i) => {
      const titleMatch   = block.match(/\[([A-Z_]+)\] (.+?)\n/);
      const importMatch  = block.match(/Importância: (\d)/);
      const tagsMatch    = block.match(/Tags: ([^\n|]+)/);
      const contentStart = block.indexOf("\n\n") + 2;
      return {
        id:              `parsed-${i}`,
        type:            titleMatch?.[1] ?? "NOTE",
        title:           titleMatch?.[2]?.trim() ?? `Memória ${i + 1}`,
        content:         block.slice(contentStart, contentStart + 300).trim(),
        importance:      Number(importMatch?.[1] ?? 3),
        epistemicStatus: "HYPOTHESIS",
        isPinned:        false,
        tags:            tagsMatch?.[1]?.split(",").map(t => t.trim()).filter(Boolean) ?? [],
      };
    });
  }
}
