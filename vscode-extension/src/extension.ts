import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { McpClient } from "./mcpClient";
import { SidebarProvider } from "./sidebar";

let statusBar: vscode.StatusBarItem;
let pollTimer: NodeJS.Timeout | undefined;
let client:   McpClient | undefined;
let sidebar:  SidebarProvider | undefined;

// ── Config helpers ─────────────────────────────────────────────────────────────
function cfg<T>(key: string, def: T): T {
  return vscode.workspace.getConfiguration("memory-mcp").get<T>(key, def);
}

function getProjectSlug(): string {
  const explicit = cfg<string>("projectSlug", "").trim();
  if (explicit) return explicit;
  // Auto-detect: look for CLAUDE.md with project name or use folder name
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "default";
  const root    = folders[0].uri.fsPath;
  const claudeMd = path.join(root, "CLAUDE.md");
  if (fs.existsSync(claudeMd)) {
    const content = fs.readFileSync(claudeMd, "utf-8");
    // Extract from "project": "slug" or first heading
    const m = content.match(/project["\s]*[=:]\s*["']?([a-z0-9_-]+)["']?/i)
           ?? content.match(/^#\s+(.+)/m);
    if (m?.[1]) return m[1].toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  }
  return path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function buildClient(): McpClient | undefined {
  const url = cfg<string>("serverUrl", "").trim();
  const key = cfg<string>("apiKey",    "").trim();
  if (!url || !key) return undefined;
  return new McpClient(url, key);
}

// ── Status bar ─────────────────────────────────────────────────────────────────
function updateStatusBar(text: string, tooltip?: string, color?: string) {
  statusBar.text    = text;
  statusBar.tooltip = tooltip ?? "Memory MCP — clique para abrir o sidebar";
  statusBar.color   = color;
  statusBar.show();
}

async function pollStats() {
  if (!client) {
    updateStatusBar("$(brain) MCP: sem key", "Configure memory-mcp.apiKey nas settings", "#f87171");
    return;
  }
  try {
    const project = getProjectSlug();
    const s       = await client.pulse(project);
    const health  = s.healthScore;
    const icon    = health > 60 ? "$(pass-filled)" : health > 30 ? "$(warning)" : "$(error)";
    updateStatusBar(
      `$(brain) ${project} | ${s.total} mem | ${health}%`,
      `Memórias: ${s.total} | Links: ${s.links} | Pinadas: ${s.pinned} | Saúde: ${health}%\nClique para abrir o sidebar`,
      health > 60 ? "#34d399" : health > 30 ? "#fbbf24" : "#f87171",
    );
    sidebar?.refresh(s);
  } catch {
    updateStatusBar("$(brain) MCP: offline", "Servidor não acessível", "#f87171");
  }
}

// ── Auto session start ─────────────────────────────────────────────────────────
async function doSessionStart(focus?: string) {
  if (!client) {
    const action = await vscode.window.showWarningMessage(
      "Memory MCP: configure serverUrl e apiKey nas settings para usar o cérebro.",
      "Abrir Settings"
    );
    if (action === "Abrir Settings") vscode.commands.executeCommand("workbench.action.openSettings", "memory-mcp");
    return;
  }

  sidebar?.setLoading(true);
  updateStatusBar("$(sync~spin) MCP: iniciando...");

  try {
    await client.initialize();
    const project = getProjectSlug();
    const text    = await client.sessionStart(project, focus ?? `sessão de trabalho — ${new Date().toLocaleDateString("pt-BR")}`);
    sidebar?.setSession(text);

    // Show quick summary in notification
    const lines = text.split("\n").filter(l => l.trim()).slice(0, 4).join(" | ");
    vscode.window.showInformationMessage(`🧠 Cérebro ativo: ${project} — ${lines}`, "Ver Sidebar").then(v => {
      if (v === "Ver Sidebar") vscode.commands.executeCommand("memory-mcp.sidebar.focus");
    });

    await pollStats();
    sidebar?.loadMemories();
  } catch (e) {
    const err = (e as Error).message;
    updateStatusBar("$(brain) MCP: erro", err, "#f87171");
    vscode.window.showErrorMessage(`Memory MCP: ${err}`);
  } finally {
    sidebar?.setLoading(false);
  }
}

// ── Activate ──────────────────────────────────────────────────────────────────
export async function activate(ctx: vscode.ExtensionContext) {
  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusBar.command = "memory-mcp.sidebar.focus";
  updateStatusBar("$(brain) MCP: iniciando...");
  ctx.subscriptions.push(statusBar);

  // Build client
  client = buildClient();

  // Sidebar
  sidebar = new SidebarProvider(ctx, client ?? buildClient()!, getProjectSlug);
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider("memory-mcp.sidebar", sidebar, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand("memory-mcp.sessionStart", () =>
      doSessionStart()
    ),
    vscode.commands.registerCommand("memory-mcp.searchMemories", async () => {
      const q = await vscode.window.showInputBox({ prompt: "Buscar no cérebro...", placeHolder: "ex: pagamento, auth, bug" });
      if (q) sidebar?.loadMemories(q);
      vscode.commands.executeCommand("memory-mcp.sidebar.focus");
    }),
    vscode.commands.registerCommand("memory-mcp.addMemory", async () => {
      const editor = vscode.window.activeTextEditor;
      const sel    = editor?.document.getText(editor.selection);
      if (!sel?.trim()) { vscode.window.showWarningMessage("Selecione um texto primeiro."); return; }
      const title = await vscode.window.showInputBox({ prompt: "Título da memória", value: sel.slice(0, 60) });
      if (!title) return;
      const type = await vscode.window.showQuickPick(
        ["BUG_FIX", "DECISION", "PATTERN", "ARCHITECTURE", "CONTEXT", "NOTE"],
        { placeHolder: "Tipo da memória" }
      );
      if (!type) return;
      if (!client) { vscode.window.showErrorMessage("Configure memory-mcp.apiKey"); return; }
      await client.addMemory(getProjectSlug(), type, title, sel, []);
      vscode.window.showInformationMessage(`🧠 Memória salva: ${title}`);
      sidebar?.loadMemories();
    }),
    vscode.commands.registerCommand("memory-mcp.openBrainDoctor", () => {
      const url = cfg<string>("serverUrl", "");
      vscode.env.openExternal(vscode.Uri.parse(url + "/brain-doctor"));
    }),
    vscode.commands.registerCommand("memory-mcp.refreshSidebar", () => {
      pollStats();
      sidebar?.loadMemories();
    }),
  );

  // Auto session start on activate
  if (cfg<boolean>("autoSessionStart", true) && client) {
    // Small delay so VS Code finishes loading
    setTimeout(() => doSessionStart(), 2500);
  }

  // Initial poll + periodic refresh
  await pollStats();
  const interval = cfg<number>("pollInterval", 60) * 1000;
  pollTimer = setInterval(pollStats, Math.max(interval, 30_000));

  // Re-build client when settings change
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("memory-mcp")) {
        client = buildClient();
        pollStats();
      }
    })
  );

  // Refresh sidebar when active editor changes (load relevant memories)
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (client) sidebar?.loadMemories();
    })
  );
}

export function deactivate() {
  if (pollTimer) clearInterval(pollTimer);
}
