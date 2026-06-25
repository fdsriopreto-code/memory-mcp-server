import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from "electron";
import * as path from "path";
import * as fs from "fs";

// ── Config ─────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_URL = "https://ferramentas-memory-mcp-server.m5mfeg.easypanel.host";

interface Config { serverUrl: string }

function getConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config;
    }
  } catch {}
  // Cria config padrão na primeira execução
  const cfg: Config = { serverUrl: DEFAULT_URL };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

// ── Estado ─────────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray:       Tray          | null = null;
let isQuitting  = false;
const config    = getConfig();
const SERVER_URL = config.serverUrl;

// ── Tray ───────────────────────────────────────────────────────────────────────
function createTray(): void {
  // Ícone roxo 16x16 gerado como nativeImage
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA" +
    "bklEQVQ4T2NkIBIwEqmOgWoGKCsrJ4D5H4D4AxCfAeIgIP4FJgcDaABUAxiBWH8g/gfE" +
    "J4D4CogNBhiJNACXAciABCA+BsS3gHgbEL+FGYDNAJgBuAyAGQAzAJsBMAOwGQAzAJsB" +
    "MAOwGQAzAJsBMANAAADkABVlEQAAAABJRU5ErkJggg=="
  );

  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const menu = Menu.buildFromTemplate([
    { label: "Memory MCP", enabled: false },
    { type: "separator" },
    { label: "Abrir",            click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Recarregar",       click: () => mainWindow?.webContents.reload() },
    { label: "Abrir no Browser", click: () => shell.openExternal(SERVER_URL) },
    { type: "separator" },
    { label: "Configuracoes (config.json)", click: () => shell.openPath(CONFIG_PATH) },
    { type: "separator" },
    { label: "Sair", click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip("Memory MCP — " + SERVER_URL);
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── Janela principal ───────────────────────────────────────────────────────────
function createWindow(): void {
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

  mainWindow.loadURL(SERVER_URL);

  // Links externos abrem no browser do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Fechar = ir para tray (não sair do app)
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Servidor offline → tela de erro amigável
  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    const cfgPath = CONFIG_PATH.replace(/\\/g, "\\\\");
    mainWindow?.loadURL(`data:text/html,<!DOCTYPE html>
<html>
<body style="background:%230a0a0f;color:%23fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;text-align:center;padding:20px">
  <div style="font-size:48px">&#129504;</div>
  <div style="font-size:20px;font-weight:600">Memory MCP</div>
  <div style="color:%23ef4444;font-size:13px">Servidor inacessivel</div>
  <div style="color:%23555;font-size:11px;max-width:400px">${SERVER_URL}</div>
  <div style="color:%23444;font-size:10px">Erro ${code}: ${desc}</div>
  <button onclick="location.reload()" style="margin-top:12px;padding:10px 24px;background:%236366f1;border:none;border-radius:8px;color:%23fff;cursor:pointer;font-size:14px;font-weight:500">
    Tentar novamente
  </button>
  <div style="color:%23333;font-size:10px;margin-top:8px">
    Verifique o EasyPanel ou edite: ${cfgPath}
  </div>
</body>
</html>`);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  await app.whenReady();

  // Instância única
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // macOS — oculta ícone do dock (vira menu bar app)
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  createTray();
  createWindow();

  app.on("activate", () => { mainWindow?.show(); });

  // No Windows/Linux, fechar a janela não sai do app — fica no tray
  app.on("window-all-closed", () => {
    if (isQuitting) app.quit();
  });
}

app.on("before-quit", () => { isQuitting = true; });
main().catch(console.error);
