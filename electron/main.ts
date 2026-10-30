import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ID = "com.uptimeempire.app";

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LOG_FILES = 5;
const LOG_LEVELS = new Set(["info", "warn", "error"]);

let mainWindow: BrowserWindow | null = null;

function logsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

/** Ротация: app.log → app.log.1 → … → app.log.4 (DESIGN.md, разд. 19). */
function rotateLog(file: string): void {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_BYTES) return;

  for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
    const from = index === 1 ? file : `${file}.${index - 1}`;
    const to = `${file}.${index}`;
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch {
      // Не смогли переименовать — просто продолжим писать в текущий файл.
    }
  }
}

function writeLog(level: unknown, message: unknown): void {
  const safeLevel = typeof level === "string" && LOG_LEVELS.has(level) ? level : "info";
  const text = String(message ?? "").slice(0, 4000);
  const line = `${new Date().toISOString()} [${safeLevel}] ${text}\n`;

  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    const file = path.join(logsDir(), "app.log");
    rotateLog(file);
    fs.appendFileSync(file, line, "utf8");
  } catch {
    // Логи не должны ронять игру.
  }
}

function isAllowedUrl(url: string): boolean {
  if (url.startsWith("file://")) return true;
  return Boolean(DEV_SERVER_URL) && url.startsWith(DEV_SERVER_URL as string);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: "#06090f",
    autoHideMenuBar: true,
    title: "Uptime Empire",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Внешние ссылки и переходы запрещены: игра не обращается в сеть (GAME.md, правило 14).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      writeLog("warn", `Заблокирован переход на ${url}`);
    }
  });

  // F11 — полный экран на уровне окна, из интерфейса это недоступно.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
  });

  ipcMain.on("log:write", (_event, level: unknown, message: unknown) => {
    writeLog(level, message);
  });

  ipcMain.handle("log:open-folder", async () => {
    const dir = logsDir();
    await fs.promises.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });

  process.on("uncaughtException", (error) => {
    writeLog("error", `uncaughtException: ${error.stack ?? error.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    writeLog("error", `unhandledRejection: ${String(reason)}`);
  });

  void app.whenReady().then(() => {
    writeLog("info", `Старт Uptime Empire ${app.getVersion()} (${process.platform})`);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
