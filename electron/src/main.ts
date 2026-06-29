import {
  app, BrowserWindow, Tray, Menu, nativeImage,
  shell, ipcMain, dialog
} from "electron";
import * as path  from "path";
import * as fs    from "fs";
import * as cp    from "child_process";
import * as https from "https";
import * as os    from "os";
import { WebSocket } from "ws";

// ── Paths ──────────────────────────────────────────────────────────────────────
const CONFIG_PATH  = path.join(app.getPath("userData"), "config.json");
const SERVER_DIR   = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "../../server");

// ── Config ─────────────────────────────────────────────────────────────────────
interface Config {
  mode:             "local" | "vps";
  serverUrl?:       string;
  databaseUrl?:     string;
  openaiApiKey?:    string;
  anthropicApiKey?: string;
  tavilyApiKey?:    string;
  port?:            number;
  adminEmail?:      string;
  adminPassword?:   string;
  adminName?:       string;
  setupDone?:       boolean;
  jwtSecret?:       string;
  mcpApiKey?:       string;
  redisUrl?:        string;
}

function loadConfig(): Config | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config;
    }
  } catch {}
  return null;
}

function saveConfig(cfg: Config): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ── State ──────────────────────────────────────────────────────────────────────
let mainWindow:       BrowserWindow    | null = null;
let setupWindow:      BrowserWindow    | null = null;
let tray:             Tray             | null = null;
let serverProc:       cp.ChildProcess  | null = null;
let localAgentWs:     WebSocket        | null = null;
let localAgentTimer:  ReturnType<typeof setTimeout> | null = null;
let isQuitting        = false;

type UpdateInfo = { hasUpdate: boolean; currentVersion: string; latestVersion: string; downloadUrl: string; releaseUrl: string; releaseNotes: string };
let cachedUpdateInfo: UpdateInfo | null = null;

// ── Auto Update (GitHub Releases) ─────────────────────────────────────────────
const GITHUB_REPO = "fdsriopreto-code/memory-mcp-server";

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "memory-mcp-desktop", "Accept": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function checkForUpdateImpl(): Promise<UpdateInfo> {
  if (cachedUpdateInfo) return cachedUpdateInfo;
  const current = app.getVersion();
  try {
    const release = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`) as {
      tag_name: string;
      html_url: string;
      body: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const latest = release.tag_name ?? "0.0.0";
    const hasUpdate = compareVersions(current, latest) > 0;
    const winAsset = release.assets?.find(a => a.name.endsWith(".exe"));
    const downloadUrl = winAsset?.browser_download_url ?? release.html_url;
    cachedUpdateInfo = { hasUpdate, currentVersion: current, latestVersion: latest, downloadUrl, releaseUrl: release.html_url, releaseNotes: (release.body ?? "").slice(0, 500) };
  } catch {
    cachedUpdateInfo = { hasUpdate: false, currentVersion: current, latestVersion: current, downloadUrl: "", releaseUrl: "", releaseNotes: "" };
  }
  return cachedUpdateInfo;
}

// ── Tray ───────────────────────────────────────────────────────────────────────
function createTray(): void {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9h" +
    "AAAAbklEQVQ4T2NkIBIwEqmOgWoGKCsrJ4D5H4D4AxCfAeIgIP4FJgcDaABUAxiB" +
    "WH8g/gfEJ4D4CogNBhiJNACXAciABCA+BsS3gHgbEL+FGYDNAJgBuAyAGQAzAJsB" +
    "MAOwGQAzAJsBMANAAADkABVlEQAAAABJRU5ErkJggg=="
  );

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Memory MCP");

  const rebuild = () => {
    const cfg = loadConfig();
    const menu = Menu.buildFromTemplate([
      { label: "Memory MCP",      enabled: false },
      { type:  "separator" },
      { label: "Abrir",           click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: "Recarregar",      click: () => mainWindow?.webContents.reload() },
      { label: "Abrir no Browser",click: () => cfg && shell.openExternal(cfg.serverUrl ?? `http://localhost:${cfg.port ?? 3100}`) },
      { type:  "separator" },
      { label: "Configurações",   click: () => shell.openPath(CONFIG_PATH) },
      { label: "Reconfigurar",    click: () => openSetup() },
      { label: "DevTools",        click: () => mainWindow?.webContents.openDevTools() },
      { type:  "separator" },
      { label: "Sair",            click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray!.setContextMenu(menu);
  };

  rebuild();
  tray.on("double-click", () => {
    if (mainWindow)       { mainWindow.show();  mainWindow.focus();  }
    else if (setupWindow) { setupWindow.show(); setupWindow.focus(); }
    else                  { openSetup(); }
  });
}

// ── Setup window ───────────────────────────────────────────────────────────────
function openSetup(): void {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width:           620,
    height:          720,
    minWidth:        540,
    minHeight:       560,
    resizable:       true,
    title:           "Memory MCP — Setup",
    backgroundColor: "#0a0a0f",
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, "preload.js"),
    },
  });

  // setup.html está dentro do asar junto com dist/
  const setupHtml = app.isPackaged
    ? path.join(app.getAppPath(), "setup.html")
    : path.join(__dirname, "../setup.html");

  setupWindow.loadFile(setupHtml);

  // Abre DevTools em desenvolvimento para depurar
  if (!app.isPackaged) setupWindow.webContents.openDevTools();

  setupWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[setup] Falha ao carregar setup.html: ${code} ${desc} | path: ${setupHtml}`);
    // Fallback: mostra HTML inline se o arquivo não carregar
    setupWindow?.loadURL(`data:text/html,<!DOCTYPE html>
<html><body style="background:%230a0a0f;color:%23fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;padding:32px;text-align:center">
<div style="font-size:48px">🧠</div>
<div style="font-size:20px;font-weight:700">Memory MCP</div>
<div style="font-size:13px;color:%23888">Erro ao carregar setup (${code})<br>${desc}</div>
<div style="font-size:11px;color:%23555;margin-top:8px;max-width:400px;word-break:break-all">${setupHtml}</div>
<button onclick="openSetup()" style="margin-top:16px;padding:12px 28px;background:%236366f1;border:none;border-radius:8px;color:%23fff;cursor:pointer;font-size:14px;font-weight:600">Configurar servidor</button>
</body></html>`);
  });
  setupWindow.on("closed", () => { setupWindow = null; });
}

// ── Main window ────────────────────────────────────────────────────────────────
function createMainWindow(url: string): void {
  if (mainWindow) { mainWindow.loadURL(url); mainWindow.show(); return; }

  mainWindow = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        900,
    minHeight:       600,
    title:           "Memory MCP",
    backgroundColor: "#0a0a0f",
    show:            false,          // só mostra depois de carregar (sem tela preta)
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  // Mostra a janela assim que o primeiro frame renderizou
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Enquanto carrega, mostra uma tela de loading
  mainWindow.loadURL(`data:text/html,<!DOCTYPE html>
<html><body style="background:%230a0a0f;color:%23fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
<div style="width:48px;height:48px;border:3px solid %23333;border-top-color:%236366f1;border-radius:50%;animation:spin 0.8s linear infinite"></div>
<div style="font-size:15px;color:%23888">Conectando ao servidor...</div>
<div style="font-size:12px;color:%23444;max-width:400px;text-align:center;word-break:break-all">${url}</div>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body></html>`);

  // Depois de exibir o loading, carrega a URL real
  setTimeout(() => mainWindow?.loadURL(url), 500);

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    const encodedUrl = encodeURIComponent(url);
    mainWindow?.loadURL(`data:text/html,<!DOCTYPE html>
<html>
<head><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:%230a0a0f;color:%23fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:32px}
.card{background:%23111118;border:1px solid %231e1e2e;border-radius:16px;padding:40px;max-width:500px;width:100%;text-align:center}
h2{font-size:18px;margin:16px 0 8px}
.url{font-size:12px;color:%23ef4444;word-break:break-all;margin-bottom:8px}
.err{font-size:11px;color:%23555;margin-bottom:24px}
input{width:100%;background:%230a0a0f;border:1px solid %231e1e2e;border-radius:8px;padding:10px 14px;color:%23fff;font-size:13px;margin-bottom:12px;outline:none}
input:focus{border-color:%236366f1}
.btns{display:flex;gap:10px}
button{flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}
.retry{background:%236366f1;color:%23fff}
.open{background:%231e1e2e;color:%23aaa}
</style></head>
<body>
<div class="card">
  <div style="font-size:48px">⚠️</div>
  <h2>Servidor não encontrado</h2>
  <div class="url">${url}</div>
  <div class="err">Erro ${code}: ${desc}</div>
  <p style="font-size:12px;color:%23666;margin-bottom:16px">Verifique se o servidor está online e tente novamente.</p>
  <input id="u" value="${url}" placeholder="https://seu-servidor..." />
  <div class="btns">
    <button class="retry" onclick="location.href=document.getElementById('u').value">Conectar</button>
    <button class="open" onclick="window.open(document.getElementById('u').value)">Abrir no browser</button>
  </div>
</div>
</body></html>`);
  });
}

// ── Local server ───────────────────────────────────────────────────────────────
async function startLocalServer(cfg: Config): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const serverIndex = path.join(SERVER_DIR, "dist", "index.js");

    if (!fs.existsSync(serverIndex)) {
      resolve({ ok: false, error: `Arquivo não encontrado: ${serverIndex}` });
      return;
    }

    const jwtSecret = cfg.jwtSecret  ?? generateSecret();
    const mcpApiKey = cfg.mcpApiKey  ?? generateSecret();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL:       cfg.databaseUrl,
      OPENAI_API_KEY:     cfg.openaiApiKey,
      ANTHROPIC_API_KEY:  cfg.anthropicApiKey ?? "",
      JWT_SECRET:         jwtSecret,
      MCP_API_KEY:        mcpApiKey,
      PORT:               String(cfg.port ?? 3100),
      ELECTRON_MODE:      "true",
      ADMIN_EMAIL:        cfg.adminEmail,
      ADMIN_PASSWORD:     cfg.adminPassword,
      ADMIN_NAME:         cfg.adminName,
      TAVILY_API_KEY:     cfg.tavilyApiKey ?? "",
      REDIS_URL:          cfg.redisUrl ?? "",
    };

    // Persiste JWT secret e MCP key (para não regenerar a cada restart)
    const existing = loadConfig();
    if (!existing?.jwtSecret || !existing?.mcpApiKey) {
      saveConfig({ ...cfg, jwtSecret, mcpApiKey, setupDone: true });
    }

    serverProc = cp.fork(serverIndex, [], {
      env,
      cwd:   SERVER_DIR,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) resolve({ ok: false, error: "Servidor demorou muito para iniciar (timeout 30s)" });
    }, 30_000);

    serverProc.stdout?.on("data", (chunk) => {
      const line = chunk.toString();
      console.log("[server]", line.trim());
      if (line.includes("listening") || line.includes("started") || line.includes("Rodando")) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          // Auto-start do computer agent (5s de delay — WS precisa estar pronto)
          setTimeout(() => startLocalComputerAgent(cfg.port ?? 3100, mcpApiKey), 5_000);
          resolve({ ok: true });
        }
      }
    });

    serverProc.stderr?.on("data", (chunk) => {
      const line = chunk.toString();
      console.error("[server-err]", line.trim());
      if (!started && (line.includes("Error") || line.includes("error"))) {
        clearTimeout(timeout);
        resolve({ ok: false, error: line.slice(0, 300) });
      }
    });

    serverProc.on("exit", (code) => {
      console.log("[server] exited with code", code);
      if (!started) resolve({ ok: false, error: `Processo encerrou com código ${code}` });
    });
  });
}

function generateSecret(): string {
  return require("crypto").randomBytes(32).toString("hex");
}

// ── Inline Computer Agent ─────────────────────────────────────────────────────
// Conecta ao servidor local via WebSocket e expõe o terminal do desktop como
// agente autônomo — sem processo filho externo, sem dependências extras.
const BLOCKED_CMDS = ["rm -rf /", "format c:", "del /f /s /q c:\\", "shutdown /s", "mkfs"];

function isCmdBlocked(cmd: string): boolean {
  const l = cmd.toLowerCase();
  return BLOCKED_CMDS.some(b => l.includes(b));
}

function buildAgentWsUrl(serverUrl: string, mcpApiKey: string): string {
  // Converte http(s)://host para ws(s)://host/ws?apikey=KEY
  const wsBase = serverUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${wsBase}/ws?apikey=${encodeURIComponent(mcpApiKey)}`;
}

function startLocalComputerAgent(wsUrlOrPort: string | number, mcpApiKey?: string): void {
  if (localAgentTimer)  { clearTimeout(localAgentTimer); localAgentTimer = null; }
  if (localAgentWs)     { try { localAgentWs.close(); } catch {} localAgentWs = null; }

  const agentId = `desktop-${os.hostname()}`;
  const wsUrl   = typeof wsUrlOrPort === "number"
    ? `ws://localhost:${wsUrlOrPort}/ws?apikey=${encodeURIComponent(mcpApiKey ?? "")}`
    : wsUrlOrPort;

  console.log(`[agent] Conectando como "${agentId}" → ${wsUrl.split("?")[0]}...`);

  const ws = new WebSocket(wsUrl);
  localAgentWs = ws;

  ws.on("open", () => {
    ws.send(JSON.stringify({
      type:     "computer_register",
      agentId,
      hostname: os.hostname(),
      platform: process.platform,
      cwd:      os.homedir(),
    }));
    console.log(`[agent] ✅ Registrado — "${agentId}"`);
    tray?.setToolTip(`Memory MCP — 💻 Agente: ${agentId}`);
  });

  ws.on("message", (rawData: Buffer | string) => {
    try {
      const msg = JSON.parse(rawData.toString()) as Record<string, unknown>;

      if (msg.type === "computer_welcome") {
        console.log(`[agent] ${msg.message}`);
        return;
      }

      if (msg.type === "computer_command") {
        const commandId = String(msg.commandId ?? "");
        const command   = String(msg.command   ?? "");
        const workdir   = String(msg.workdir   ?? os.homedir());

        if (isCmdBlocked(command)) {
          ws.send(JSON.stringify({ type: "computer_error", commandId, error: `Comando bloqueado: ${command}` }));
          return;
        }

        console.log(`[agent] exec: ${command.slice(0, 80)}`);

        const proc = cp.exec(command, { cwd: workdir, env: { ...process.env }, maxBuffer: 10 * 1024 * 1024 });

        proc.stdout?.on("data", (chunk: Buffer) =>
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: chunk.toString() }))
        );
        proc.stderr?.on("data", (chunk: Buffer) =>
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: chunk.toString() }))
        );
        proc.on("close",  (code) => ws.send(JSON.stringify({ type: "computer_done",  commandId, exitCode: code ?? 0 })));
        proc.on("error",  (err)  => ws.send(JSON.stringify({ type: "computer_error", commandId, error: err.message })));
      }

      if (msg.type === "computer_read_file") {
        const commandId = String(msg.commandId ?? "");
        const filePath  = String(msg.path      ?? "");
        try {
          const content = fs.readFileSync(path.resolve(filePath), "utf8");
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: content }));
          ws.send(JSON.stringify({ type: "computer_done",   commandId, exitCode: 0  }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "computer_error", commandId, error: String(e) }));
        }
      }

      if (msg.type === "computer_write_file") {
        const commandId = String(msg.commandId ?? "");
        const filePath  = String(msg.path      ?? "");
        const content   = String(msg.content   ?? "");
        try {
          fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
          fs.writeFileSync(path.resolve(filePath), content, "utf8");
          ws.send(JSON.stringify({ type: "computer_output", commandId, chunk: `Gravado: ${filePath}` }));
          ws.send(JSON.stringify({ type: "computer_done",   commandId, exitCode: 0 }));
        } catch (e) {
          ws.send(JSON.stringify({ type: "computer_error", commandId, error: String(e) }));
        }
      }
    } catch (e) {
      console.error("[agent] Erro ao processar mensagem:", e);
    }
  });

  ws.on("close", () => {
    console.log("[agent] Desconectado. Reconectando em 5s...");
    tray?.setToolTip("Memory MCP — 💻 Agente desconectado (reconectando...)");
    localAgentWs = null;
    if (!isQuitting) localAgentTimer = setTimeout(() => startLocalComputerAgent(wsUrl), 5_000);
  });

  ws.on("error", (err: Error) => {
    console.error("[agent] Erro WebSocket:", err.message, "| URL:", wsUrl.split("?")[0]);
  });
}

// ── IPC Handlers ───────────────────────────────────────────────────────────────
function registerIpc(): void {
  ipcMain.handle("open-external", (_e, url: string) => shell.openExternal(url));

  ipcMain.handle("save-config", (_e, cfg: Config) => {
    const existing = loadConfig() ?? {};
    saveConfig({ ...existing, ...cfg } as Config);
  });

  ipcMain.handle("start-local-server", async (_e, cfg: Config) => {
    return startLocalServer(cfg);
  });

  ipcMain.handle("launch", (_e, url: string) => {
    setupWindow?.close();
    createMainWindow(url);
  });

  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("check-for-update", async () => {
    return checkForUpdateImpl();
  });

  ipcMain.handle("install-update", async () => {
    const info = await checkForUpdateImpl();
    if (!info.hasUpdate) return;
    const { response } = await dialog.showMessageBox({
      type:    "info",
      title:   "Atualização disponível",
      message: `Memory MCP ${info.latestVersion} está disponível!`,
      detail:  `Versão atual: ${info.currentVersion}\n\n${info.releaseNotes}\n\nO instalador será aberto no navegador.`,
      buttons: ["Baixar agora", "Depois"],
      defaultId: 0,
    });
    if (response === 0) shell.openExternal(info.downloadUrl || info.releaseUrl);
  });
}

// ── App entry ──────────────────────────────────────────────────────────────────
async function main() {
  await app.whenReady();

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (mainWindow)       { mainWindow.show();  mainWindow.focus();  }
    else if (setupWindow) { setupWindow.show(); setupWindow.focus(); }
    else                  { openSetup(); }
  });

  if (process.platform === "darwin") app.dock?.hide();

  registerIpc();
  createTray();

  const cfg = loadConfig();

  if (!cfg || !cfg.setupDone) {
    // Primeira execução → wizard
    openSetup();
  } else if (cfg.mode === "vps") {
    // VPS mode → abre direto e conecta o computer agent ao servidor remoto
    createMainWindow(cfg.serverUrl!);
    if (cfg.mcpApiKey && cfg.serverUrl) {
      setTimeout(() => startLocalComputerAgent(buildAgentWsUrl(cfg.serverUrl!, cfg.mcpApiKey!)), 3_000);
    }
  } else {
    // Local mode → inicia servidor e abre
    console.log("[main] Iniciando servidor local...");
    const result = await startLocalServer(cfg);
    if (result.ok) {
      createMainWindow(`http://localhost:${cfg.port ?? 3100}`);
    } else {
      console.error("[main] Falha ao iniciar servidor:", result.error);
      openSetup();
    }
  }

  app.on("activate",            () => { mainWindow?.show(); });
  app.on("window-all-closed",   () => { if (isQuitting) app.quit(); });

  // Check for updates in background after 3s
  setTimeout(() => checkForUpdateImpl().catch(() => {}), 3_000);
}

app.on("before-quit", () => {
  isQuitting = true;
  if (localAgentTimer) { clearTimeout(localAgentTimer); localAgentTimer = null; }
  try { localAgentWs?.close(); } catch {}
  serverProc?.kill();
});

main().catch(console.error);
