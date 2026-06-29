"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpClient = void 0;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
class McpClient {
    constructor(serverUrl, apiKey) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        this.sessionId = null;
        this.reqId = 100;
    }
    async initialize() {
        const resp = await this.post({
            jsonrpc: "2.0", id: this.reqId++, method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "vscode-memory-mcp", version: "1.0.0" }
            }
        });
        if (resp.sessionId)
            this.sessionId = resp.sessionId;
    }
    async sessionStart(project, focus) {
        return this.tool("brain_session_start", { project, focus: focus ?? "sessão de trabalho no VS Code" });
    }
    async pulse(project) {
        const text = await this.tool("brain_pulse", { project });
        // Parse stats from text
        const total = Number(text.match(/Total mem[^:]*:\s*(\d+)/)?.[1] ?? 0);
        const hot = Number(text.match(/Quentes[^:]*:\s*(\d+)/)?.[1] ?? 0);
        const links = Number(text.match(/Total links[^:]*:\s*(\d+)/)?.[1] ?? 0);
        const pinned = Number(text.match(/Pinadas[^:]*:\s*(\d+)/)?.[1] ?? 0);
        return { total, hot, links, pinned, healthScore: total > 0 ? Math.min(100, Math.round((links / total) * 100 + hot * 2)) : 0 };
    }
    async search(project, query, limit = 8) {
        const text = await this.tool("memory_search", { project, query, limit: Math.min(limit, 20) });
        return this.parseMemories(text);
    }
    async addMemory(project, type, title, content, tags) {
        return this.tool("memory_add", { project, type, title, content, tags, importance: 4 });
    }
    async learn(project, text) {
        return this.tool("brain_learn", { project, text });
    }
    async tool(name, args) {
        const resp = await this.post({
            jsonrpc: "2.0", id: this.reqId++, method: "tools/call",
            params: { name, arguments: args }
        });
        const d = resp.data;
        if (d?.error)
            throw new Error(d.error.message ?? "MCP error");
        return d?.result?.content?.[0]?.text ?? "";
    }
    post(body) {
        return new Promise((resolve, reject) => {
            const url = new URL("/mcp", this.serverUrl);
            const isHttps = url.protocol === "https:";
            const payload = JSON.stringify(body);
            const headers = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Length": Buffer.byteLength(payload).toString(),
            };
            if (this.sessionId)
                headers["Mcp-Session-Id"] = this.sessionId;
            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: "POST",
                headers,
                timeout: 15000,
            };
            const req = (isHttps ? https : http).request(options, (res) => {
                const sessionId = res.headers["mcp-session-id"];
                const chunks = [];
                res.on("data", c => chunks.push(c));
                res.on("end", () => {
                    const raw = Buffer.concat(chunks).toString("utf-8");
                    const line = raw.split("\n").find(l => l.startsWith("data:"));
                    if (!line) {
                        reject(new Error("Empty MCP response"));
                        return;
                    }
                    try {
                        resolve({ data: JSON.parse(line.slice(5).trim()), sessionId });
                    }
                    catch {
                        reject(new Error(`MCP parse error: ${raw.slice(0, 120)}`));
                    }
                });
            });
            req.on("error", reject);
            req.on("timeout", () => { req.destroy(); reject(new Error("MCP request timeout")); });
            req.write(payload);
            req.end();
        });
    }
    parseMemories(text) {
        const blocks = text.split(/\n## \d+\./).slice(1);
        return blocks.slice(0, 10).map((block, i) => {
            const titleMatch = block.match(/\[([A-Z_]+)\] (.+?)\n/);
            const importMatch = block.match(/Importância: (\d)/);
            const tagsMatch = block.match(/Tags: ([^\n|]+)/);
            const contentStart = block.indexOf("\n\n") + 2;
            return {
                id: `parsed-${i}`,
                type: titleMatch?.[1] ?? "NOTE",
                title: titleMatch?.[2]?.trim() ?? `Memória ${i + 1}`,
                content: block.slice(contentStart, contentStart + 300).trim(),
                importance: Number(importMatch?.[1] ?? 3),
                epistemicStatus: "HYPOTHESIS",
                isPinned: false,
                tags: tagsMatch?.[1]?.split(",").map(t => t.trim()).filter(Boolean) ?? [],
            };
        });
    }
}
exports.McpClient = McpClient;
