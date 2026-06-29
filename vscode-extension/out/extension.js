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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const mcpClient_1 = require("./mcpClient");
const sidebar_1 = require("./sidebar");
let statusBar;
let pollTimer;
let client;
let sidebar;
// ── Config helpers ─────────────────────────────────────────────────────────────
function cfg(key, def) {
    return vscode.workspace.getConfiguration("memory-mcp").get(key, def);
}
function getProjectSlug() {
    const explicit = cfg("projectSlug", "").trim();
    if (explicit)
        return explicit;
    // Auto-detect: look for CLAUDE.md with project name or use folder name
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
        return "default";
    const root = folders[0].uri.fsPath;
    const claudeMd = path.join(root, "CLAUDE.md");
    if (fs.existsSync(claudeMd)) {
        const content = fs.readFileSync(claudeMd, "utf-8");
        // Extract from "project": "slug" or first heading
        const m = content.match(/project["\s]*[=:]\s*["']?([a-z0-9_-]+)["']?/i)
            ?? content.match(/^#\s+(.+)/m);
        if (m?.[1])
            return m[1].toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
    }
    return path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
function buildClient() {
    const url = cfg("serverUrl", "").trim();
    const key = cfg("apiKey", "").trim();
    if (!url || !key)
        return undefined;
    return new mcpClient_1.McpClient(url, key);
}
// ── Status bar ─────────────────────────────────────────────────────────────────
function updateStatusBar(text, tooltip, color) {
    statusBar.text = text;
    statusBar.tooltip = tooltip ?? "Memory MCP — clique para abrir o sidebar";
    statusBar.color = color;
    statusBar.show();
}
async function pollStats() {
    if (!client) {
        updateStatusBar("$(brain) MCP: sem key", "Configure memory-mcp.apiKey nas settings", "#f87171");
        return;
    }
    try {
        const project = getProjectSlug();
        const s = await client.pulse(project);
        const health = s.healthScore;
        const icon = health > 60 ? "$(pass-filled)" : health > 30 ? "$(warning)" : "$(error)";
        updateStatusBar(`$(brain) ${project} | ${s.total} mem | ${health}%`, `Memórias: ${s.total} | Links: ${s.links} | Pinadas: ${s.pinned} | Saúde: ${health}%\nClique para abrir o sidebar`, health > 60 ? "#34d399" : health > 30 ? "#fbbf24" : "#f87171");
        sidebar?.refresh(s);
    }
    catch {
        updateStatusBar("$(brain) MCP: offline", "Servidor não acessível", "#f87171");
    }
}
// ── Auto session start ─────────────────────────────────────────────────────────
async function doSessionStart(focus) {
    if (!client) {
        const action = await vscode.window.showWarningMessage("Memory MCP: configure serverUrl e apiKey nas settings para usar o cérebro.", "Abrir Settings");
        if (action === "Abrir Settings")
            vscode.commands.executeCommand("workbench.action.openSettings", "memory-mcp");
        return;
    }
    sidebar?.setLoading(true);
    updateStatusBar("$(sync~spin) MCP: iniciando...");
    try {
        await client.initialize();
        const project = getProjectSlug();
        const text = await client.sessionStart(project, focus ?? `sessão de trabalho — ${new Date().toLocaleDateString("pt-BR")}`);
        sidebar?.setSession(text);
        // Show quick summary in notification
        const lines = text.split("\n").filter(l => l.trim()).slice(0, 4).join(" | ");
        vscode.window.showInformationMessage(`🧠 Cérebro ativo: ${project} — ${lines}`, "Ver Sidebar").then(v => {
            if (v === "Ver Sidebar")
                vscode.commands.executeCommand("memory-mcp.sidebar.focus");
        });
        await pollStats();
        sidebar?.loadMemories();
    }
    catch (e) {
        const err = e.message;
        updateStatusBar("$(brain) MCP: erro", err, "#f87171");
        vscode.window.showErrorMessage(`Memory MCP: ${err}`);
    }
    finally {
        sidebar?.setLoading(false);
    }
}
// ── Activate ──────────────────────────────────────────────────────────────────
async function activate(ctx) {
    // Status bar
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    statusBar.command = "memory-mcp.sidebar.focus";
    updateStatusBar("$(brain) MCP: iniciando...");
    ctx.subscriptions.push(statusBar);
    // Build client
    client = buildClient();
    // Sidebar
    sidebar = new sidebar_1.SidebarProvider(ctx, client ?? buildClient(), getProjectSlug);
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider("memory-mcp.sidebar", sidebar, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    // Commands
    ctx.subscriptions.push(vscode.commands.registerCommand("memory-mcp.sessionStart", () => doSessionStart()), vscode.commands.registerCommand("memory-mcp.searchMemories", async () => {
        const q = await vscode.window.showInputBox({ prompt: "Buscar no cérebro...", placeHolder: "ex: pagamento, auth, bug" });
        if (q)
            sidebar?.loadMemories(q);
        vscode.commands.executeCommand("memory-mcp.sidebar.focus");
    }), vscode.commands.registerCommand("memory-mcp.addMemory", async () => {
        const editor = vscode.window.activeTextEditor;
        const sel = editor?.document.getText(editor.selection);
        if (!sel?.trim()) {
            vscode.window.showWarningMessage("Selecione um texto primeiro.");
            return;
        }
        const title = await vscode.window.showInputBox({ prompt: "Título da memória", value: sel.slice(0, 60) });
        if (!title)
            return;
        const type = await vscode.window.showQuickPick(["BUG_FIX", "DECISION", "PATTERN", "ARCHITECTURE", "CONTEXT", "NOTE"], { placeHolder: "Tipo da memória" });
        if (!type)
            return;
        if (!client) {
            vscode.window.showErrorMessage("Configure memory-mcp.apiKey");
            return;
        }
        await client.addMemory(getProjectSlug(), type, title, sel, []);
        vscode.window.showInformationMessage(`🧠 Memória salva: ${title}`);
        sidebar?.loadMemories();
    }), vscode.commands.registerCommand("memory-mcp.openBrainDoctor", () => {
        const url = cfg("serverUrl", "");
        vscode.env.openExternal(vscode.Uri.parse(url + "/brain-doctor"));
    }), vscode.commands.registerCommand("memory-mcp.refreshSidebar", () => {
        pollStats();
        sidebar?.loadMemories();
    }));
    // Auto session start on activate
    if (cfg("autoSessionStart", true) && client) {
        // Small delay so VS Code finishes loading
        setTimeout(() => doSessionStart(), 2500);
    }
    // Initial poll + periodic refresh
    await pollStats();
    const interval = cfg("pollInterval", 60) * 1000;
    pollTimer = setInterval(pollStats, Math.max(interval, 30000));
    // Re-build client when settings change
    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("memory-mcp")) {
            client = buildClient();
            pollStats();
        }
    }));
    // Refresh sidebar when active editor changes (load relevant memories)
    ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        if (client)
            sidebar?.loadMemories();
    }));
}
function deactivate() {
    if (pollTimer)
        clearInterval(pollTimer);
}
