import * as vscode from "vscode";
import type { McpClient, Memory, BrainStats } from "./mcpClient";

const TYPE_COLORS: Record<string, string> = {
  BUG_FIX:      "#f87171",
  DECISION:     "#a78bfa",
  PATTERN:      "#38bdf8",
  ARCHITECTURE: "#34d399",
  CONTEXT:      "#fbbf24",
  NOTE:         "#94a3b8",
};

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private memories: Memory[]  = [];
  private stats: BrainStats   = { total: 0, pinned: 0, links: 0, healthScore: 0, hot: 0 };
  private loading             = false;
  private sessionText         = "";

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly mcp: McpClient,
    private readonly getProject: () => string,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.render();
  }

  async refresh(stats?: BrainStats, memories?: Memory[]) {
    if (stats)    this.stats    = stats;
    if (memories) this.memories = memories;
    this.render();
  }

  setSession(text: string) { this.sessionText = text; this.render(); }
  setLoading(v: boolean)   { this.loading = v; this.render(); }

  async loadMemories(query?: string) {
    this.setLoading(true);
    try {
      const q = query ?? (vscode.window.activeTextEditor?.document.fileName.split(/[\\/]/).pop()?.replace(/\.\w+$/, "") ?? "");
      const [m, s] = await Promise.all([
        this.mcp.search(this.getProject(), q || "importante padrão decisão").catch(() => []),
        this.mcp.pulse(this.getProject()).catch(() => this.stats),
      ]);
      await this.refresh(s, m);
    } finally { this.setLoading(false); }
  }

  private async handleMessage(msg: { command: string; query?: string; type?: string; title?: string; content?: string }) {
    switch (msg.command) {
      case "search":
        await this.loadMemories(msg.query ?? "");
        break;
      case "sessionStart": {
        this.setLoading(true);
        const text = await this.mcp.sessionStart(this.getProject()).catch(e => `Erro: ${e.message}`);
        this.setSession(text);
        await this.loadMemories();
        break;
      }
      case "addMemory": {
        const editor = vscode.window.activeTextEditor;
        const sel    = editor?.document.getText(editor.selection);
        if (!sel?.trim()) { vscode.window.showWarningMessage("Selecione um texto no editor para salvar como memória."); break; }
        const title = await vscode.window.showInputBox({ prompt: "Título da memória", value: sel.slice(0, 60) });
        if (!title) break;
        const type = await vscode.window.showQuickPick(["BUG_FIX", "DECISION", "PATTERN", "ARCHITECTURE", "CONTEXT", "NOTE"], { placeHolder: "Tipo da memória" });
        if (!type) break;
        await this.mcp.addMemory(this.getProject(), type, title, sel, []).catch(e => vscode.window.showErrorMessage(e.message));
        vscode.window.showInformationMessage(`🧠 Memória salva: ${title}`);
        await this.loadMemories();
        break;
      }
      case "openBrainDoctor": {
        const url = vscode.workspace.getConfiguration("memory-mcp").get<string>("serverUrl") ?? "";
        await vscode.env.openExternal(vscode.Uri.parse(url + "/brain-doctor"));
        break;
      }
      case "copyContent":
        if (msg.content) await vscode.env.clipboard.writeText(msg.content);
        break;
    }
  }

  private render() {
    if (!this.view) return;
    this.view.webview.html = this.buildHtml();
  }

  private buildHtml(): string {
    const project = this.getProject();
    const s       = this.stats;
    const pill    = (v: number | string, color: string) =>
      `<span style="background:${color}22;color:${color};border:1px solid ${color}44;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700">${v}</span>`;

    const memCards = this.memories.length === 0
      ? `<div style="color:rgba(255,255,255,0.2);text-align:center;padding:24px 8px;font-size:11px">Nenhuma memória — busque ou inicie a sessão</div>`
      : this.memories.map(m => {
          const c = TYPE_COLORS[m.type] ?? "#94a3b8";
          const preview = m.content.slice(0, 160).replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return `
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px;margin-bottom:6px;cursor:pointer"
               onclick="copy(${JSON.stringify(m.content)})">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:3px;padding:0 5px;font-size:9px;font-weight:700">${m.type}</span>
              ${m.isPinned ? `<span style="color:#fbbf24;font-size:9px">📌</span>` : ""}
              <span style="color:rgba(255,255,255,0.5);font-size:9px;margin-left:auto">${"★".repeat(m.importance)}</span>
            </div>
            <div style="color:white;font-size:11px;font-weight:600;margin-bottom:3px;line-height:1.3">${m.title.replace(/</g, "&lt;")}</div>
            <div style="color:rgba(255,255,255,0.35);font-size:10px;line-height:1.4">${preview}${m.content.length > 160 ? "…" : ""}</div>
          </div>`;
        }).join("");

    const sessionBlock = this.sessionText
      ? `<div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:8px;padding:10px;margin-bottom:12px;font-size:10px;color:rgba(255,255,255,0.6);max-height:120px;overflow-y:auto">
           <div style="color:#34d399;font-weight:700;margin-bottom:4px">✅ Sessão ativa</div>
           ${this.sessionText.slice(0, 400).replace(/</g, "&lt;")}${this.sessionText.length > 400 ? "…" : ""}
         </div>`
      : "";

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing:border-box; margin:0; padding:0 }
  body { font-family:-apple-system,sans-serif; background:#0f0f1a; color:#fff; padding:12px; min-height:100vh }
  input { width:100%; padding:7px 10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:7px; color:#fff; font-size:11px; outline:none }
  input:focus { border-color:#6366f1 }
  button { border:none; border-radius:7px; cursor:pointer; font-size:11px; font-weight:700; padding:7px 12px; transition:opacity .15s }
  button:hover { opacity:.85 }
  .btn-primary { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff }
  .btn-ghost   { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.7) }
  .spin { display:inline-block; animation:spin 1s linear infinite }
  @keyframes spin { to { transform:rotate(360deg) } }
  ::-webkit-scrollbar { width:4px } ::-webkit-scrollbar-track { background:transparent } ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15); border-radius:2px }
</style>
</head>
<body>
<!-- Header -->
<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
  <span style="font-size:18px">🧠</span>
  <div style="flex:1">
    <div style="font-size:12px;font-weight:700;color:#fff">${project || "Nenhum projeto"}</div>
    <div style="font-size:9px;color:rgba(255,255,255,0.3)">Memory MCP Server</div>
  </div>
  ${this.loading ? `<span class="spin" style="font-size:14px">⟳</span>` : ""}
</div>

<!-- Stats -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:12px">
  ${[
    ["💾", s.total,       "Memórias"],
    ["🔗", s.links,       "Links"],
    ["📌", s.pinned,      "Pinadas"],
    ["🔥", s.hot,         "Quentes"],
  ].map(([icon, val, label]) => `
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:7px;padding:6px;text-align:center">
      <div style="font-size:14px">${icon}</div>
      <div style="font-size:14px;font-weight:700;color:#fff">${val}</div>
      <div style="font-size:8px;color:rgba(255,255,255,0.3)">${label}</div>
    </div>`).join("")}
</div>

<!-- Health bar -->
<div style="margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,0.3);margin-bottom:3px">
    <span>Saúde do cérebro</span><span>${s.healthScore}%</span>
  </div>
  <div style="background:rgba(255,255,255,0.07);border-radius:4px;height:5px">
    <div style="background:${s.healthScore > 60 ? "#34d399" : s.healthScore > 30 ? "#fbbf24" : "#f87171"};width:${s.healthScore}%;height:100%;border-radius:4px;transition:width .5s"></div>
  </div>
</div>

<!-- Session block -->
${sessionBlock}

<!-- Actions -->
<div style="display:flex;gap:6px;margin-bottom:12px">
  <button class="btn-primary" style="flex:1" onclick="msg('sessionStart')">▶ Iniciar Sessão</button>
  <button class="btn-ghost" onclick="msg('addMemory')" title="Salvar seleção como memória">＋ Salvar</button>
  <button class="btn-ghost" onclick="msg('openBrainDoctor')" title="Abrir Brain Doctor">🩺</button>
</div>

<!-- Search -->
<div style="margin-bottom:10px">
  <input id="search" type="text" placeholder="Buscar memórias... (Enter)"
         onkeydown="if(event.key==='Enter') msg('search',{query:this.value})">
</div>

<!-- Memories -->
<div id="memories">${memCards}</div>

<script>
  const vscode = acquireVsCodeApi();
  function msg(command, extra={}) { vscode.postMessage({ command, ...extra }); }
  function copy(content) { vscode.postMessage({ command:'copyContent', content }); }
</script>
</body>
</html>`;
  }
}
