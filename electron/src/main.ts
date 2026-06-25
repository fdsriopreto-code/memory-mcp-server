import {
  app, BrowserWindow, Tray, Menu, nativeImage,
  shell, ipcMain
} from "electron";
import * as path  from "path";
import * as fs    from "fs";
import * as cp    from "child_process";

// ── Paths ──────────────────────────────────────────────────────────────────────
const CONFIG_PATH  = path.join(app.getPath("userData"), "config.json");
const SERVER_DIR   = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "../../server");

// ── Config ─────────────────────────────────────────────────────────────────────
interface Config {
  mode:          "local" | "vps";
  serverUrl?:    string;
  databaseUrl?:  string;
  openaiApiKey?: string;
  tavilyApiKey?: string;
  port?:         number;
  adminEmail?:   string;
  adminPassword?:string;
  adminName?:    string;
  setupDone?:    boolean;
  jwtSecret?:    string;
  mcpApiKey?:    string;
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
let mainWindow:  BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
let tray:        Tray          | null = null;
let serverProc:  cp.ChildProcess | null = null;
let isQuitting   = false;

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
<button onclick="window.electronAPI?.launch('https://ferramentas-memory-mcp-server.m5mfeg.easypanel.host')" style="margin-top:16px;padding:12px 28px;background:%236366f1;border:none;border-radius:8px;color:%23fff;cursor:pointer;font-size:14px;font-weight:600">Usar servidor padrão</button>
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
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow?.hide(); }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    mainWindow?.loadURL(`data:text/html,<!DOCTYPE html>
<html><body style="background:%230a0a0f;color:%23fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;text-align:center">
<div style="font-size:48px">⚠️</div>
<div style="font-size:18px;font-weight:600">Servidor inacessível</div>
<div style="color:%23ef4444;font-size:13px">${url}</div>
<div style="color:%23555;font-size:11px">Erro ${code}: ${desc}</div>
<button onclick="location.reload()" style="margin-top:12px;padding:10px 24px;background:%236366f1;border:none;border-radius:8px;color:%23fff;cursor:pointer;font-size:14px">Tentar novamente</button>
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

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL:     cfg.databaseUrl,
      OPENAI_API_KEY:   cfg.openaiApiKey,
      JWT_SECRET:       generateSecret(),
      MCP_API_KEY:      generateSecret(),
      PORT:             String(cfg.port ?? 3100),
      ELECTRON_MODE:    "true",
      ADMIN_EMAIL:      cfg.adminEmail,
      ADMIN_PASSWORD:   cfg.adminPassword,
      ADMIN_NAME:       cfg.adminName,
      TAVILY_API_KEY:   cfg.tavilyApiKey ?? "",
    };

    // Persiste o JWT secret e MCP key no config (para não regenerar ao reiniciar)
    const existing = loadConfig();
    if (!existing?.jwtSecret) {
      saveConfig({ ...cfg, jwtSecret: env.JWT_SECRET, mcpApiKey: env.MCP_API_KEY, setupDone: true } as any);
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
      if (line.includes("listening") || line.includes("started") || line.includes("3100")) {
        started = true;
        clearTimeout(timeout);
        resolve({ ok: true });
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
    // VPS mode → abre direto
    createMainWindow(cfg.serverUrl!);
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
}

app.on("before-quit", () => {
  isQuitting = true;
  serverProc?.kill();
});

main().catch(console.error);
