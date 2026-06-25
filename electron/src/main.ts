import {
  app, BrowserWindow, Tray, Menu, nativeImage,
  dialog, shell, ipcMain
} from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import * as crypto from "crypto";

// ── Constantes ─────────────────────────────────────────────────────────────────
const SERVER_PORT  = 3100;
const CONFIG_PATH  = path.join(app.getPath("userData"), "config.json");
const isDev        = process.env.NODE_ENV === "development";
const RESOURCES    = isDev ? path.join(__dirname, "../..") : process.resourcesPath;

interface Config {
  DATABASE_URL:  string;
  OPENAI_API_KEY: string;
  JWT_SECRET:    string;
  MCP_API_KEY:   string;
}

// ── Estado global ──────────────────────────────────────────────────────────────
let mainWindow:    BrowserWindow | null = null;
let tray:          Tray         | null = null;
let serverProcess: ChildProcess  | null = null;
let isQuitting = false;

// ── Config ─────────────────────────────────────────────────────────────────────
function loadConfig(): Config | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config;
    }
  } catch {}
  return null;
}

function generateConfig(): Config {
  return {
    DATABASE_URL:   "postgresql://user:password@localhost:5432/memory_mcp",
    OPENAI_API_KEY: "sk-...",
    JWT_SECRET:     crypto.randomBytes(32).toString("hex"),
    MCP_API_KEY:    crypto.randomBytes(16).toString("hex"),
  };
}

// ── Servidor ───────────────────────────────────────────────────────────────────
function startServer(config: Config): void {
  const serverDir = path.join(RESOURCES, "server");
  const serverEnv = {
    ...process.env,
    DATABASE_URL:    config.DATABASE_URL,
    OPENAI_API_KEY:  config.OPENAI_API_KEY,
    JWT_SECRET:      config.JWT_SECRET,
    MCP_API_KEY:     config.MCP_API_KEY,
    PORT:            String(SERVER_PORT),
    NODE_ENV:        "production",
    SERVE_FRONTEND:  "true",
    FRONTEND_DIST:   path.join(RESOURCES, "frontend", "dist"),
  };

  const entryJs = isDev
    ? path.join(__dirname, "../../server/dist/index.js")
    : path.join(serverDir, "dist", "index.js");

  serverProcess = spawn("node", [entryJs], {
    cwd:   path.dirname(entryJs),
    env:   serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  serverProcess.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));

  serverProcess.on("exit", (code) => {
    if (!isQuitting) {
      console.log(`[server] Processo encerrou (code ${code}) — reiniciando em 3s...`);
      setTimeout(() => startServer(config), 3000);
    }
  });
}

function waitForServer(retries = 30): Promise<void> {
  return new Promise((resolve, _reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
        if (res.statusCode === 200 || res.statusCode === 404) {
          resolve();
        } else {
          retry();
        }
      });
      req.on("error", retry);
      req.setTimeout(1000, retry);
      function retry() {
        attempts++;
        if (attempts >= retries) {
          resolve(); // Abre mesmo se não conseguiu confirmar
        } else {
          setTimeout(check, 1000);
        }
      }
    };
    check();
  });
}

// ── Tray ───────────────────────────────────────────────────────────────────────
// Ícone como data URL (16x16 roxo com "M")
const TRAY_ICON_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAuklEQVQ4T2NkIBIwEqmOgWoGKCsrJwD5H4D4PhCfBeIgIP6FJieLoAEoBlANYMQmSIoBJBsAMoAFiB8D8T0gfgbEV4D4DLIBjIQMwGUAMiABiB8C8S0g3gbEb2EGYDMAZgAuA2AGwAzAZgDMAGwGwAzAZgDMAFwGYDMAZgA2A2AGYDMAZ4ANgBmAzQCYAdgMgBmAzQCYAdgMgBmAzQCYAdgMgBmAzQCYAdgMgBmAzQBsBmAzAGYANgNgBmAzAGYANgNgBmAzAGYANgNgBmAzAGYA0AAAkzAYEePPXUAAAAASUVORK5CYII=";

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const updateMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Memory MCP",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Abrir Interface",
        click: () => { mainWindow?.show(); mainWindow?.focus(); },
      },
      {
        label: "Abrir no Browser",
        click: () => shell.openExternal(`http://localhost:${SERVER_PORT}`),
      },
      {
        label: "Configuracoes",
        click: () => shell.openPath(CONFIG_PATH),
      },
      {
        label: "Logs do Servidor",
        click: () => shell.openPath(path.join(app.getPath("userData"), "logs")),
      },
      { type: "separator" },
      {
        label: `MCP URL: http://localhost:${SERVER_PORT}/mcp`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          isQuitting = true;
          serverProcess?.kill();
          app.quit();
        },
      },
    ]);
    tray!.setContextMenu(menu);
  };

  updateMenu();
  tray.setToolTip(`Memory MCP — localhost:${SERVER_PORT}`);
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        1000,
    minHeight:       600,
    title:           "Memory MCP",
    backgroundColor: "#0a0a0f",
    titleBarStyle:   "hiddenInset",
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  // Abre links externos no browser padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

// ── Setup Wizard ──────────────────────────────────────────────────────────────
async function showSetupWizard(): Promise<Config | null> {
  const result = await dialog.showMessageBox({
    type:    "info",
    title:   "Memory MCP — Configuracao Inicial",
    message: "Bem-vindo ao Memory MCP!",
    detail: [
      "Para usar o app voce precisa de:",
      "",
      "1. PostgreSQL — Use uma opcao gratuita:",
      "   - Neon (neon.tech) — free tier, sem cartao",
      "   - Supabase (supabase.com) — free tier",
      "",
      "2. OpenAI API Key (para embeddings e IA)",
      "   - platform.openai.com",
      "",
      "Um arquivo de configuracao sera criado para voce preencher.",
      "Apos preencher, reinicie o app.",
    ].join("\n"),
    buttons: ["Criar arquivo de configuracao", "Cancelar"],
    defaultId: 0,
  });

  if (result.response !== 0) return null;

  const config = generateConfig();
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");

  await dialog.showMessageBox({
    type:    "info",
    title:   "Arquivo criado",
    message: "Arquivo de configuracao criado!",
    detail:  `Localizacao:\n${CONFIG_PATH}\n\nPreencha DATABASE_URL e OPENAI_API_KEY, salve e reinicie o app.`,
    buttons: ["Abrir arquivo", "Fechar"],
  }).then((r) => {
    if (r.response === 0) shell.openPath(CONFIG_PATH);
  });

  return null;
}

// ── Loading Screen ─────────────────────────────────────────────────────────────
function createLoadingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width:           400,
    height:          250,
    resizable:       false,
    frame:           false,
    backgroundColor: "#0a0a0f",
    alwaysOnTop:     true,
    webPreferences:  { nodeIntegration: false },
  });

  win.loadURL(`data:text/html,
    <html>
    <body style="background:#0a0a0f;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
      <div style="font-size:48px">&#129504;</div>
      <div style="font-size:20px;font-weight:600">Memory MCP</div>
      <div style="color:#6366f1;font-size:13px">Iniciando servidor...</div>
      <div style="width:200px;height:3px;background:#1a1a2e;border-radius:2px;overflow:hidden">
        <div style="width:40%;height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);animation:slide 1s ease-in-out infinite alternate" id="bar"></div>
      </div>
      <style>@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}}</style>
    </body>
    </html>
  `);

  return win;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  await app.whenReady();

  // Single instance
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Load or create config
  let config = loadConfig();

  if (!config) {
    config = await showSetupWizard();
    if (!config) { app.quit(); return; }
  }

  // Loading screen
  const loading = createLoadingWindow();

  // Start server
  startServer(config);

  // Wait for server
  await waitForServer(30);

  // Create main window + tray
  createTray();
  createWindow();

  loading.close();

  // macOS dock hide (run as menu bar app)
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  app.on("activate", () => {
    mainWindow?.show();
  });

  app.on("window-all-closed", (e: Electron.Event) => {
    // Don't quit when all windows are closed — keep in tray
    e.preventDefault?.();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  serverProcess?.kill();
});

main().catch((err) => {
  console.error("Fatal error:", err);
  dialog.showErrorBox("Erro Fatal", String(err));
  app.quit();
});
