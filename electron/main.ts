import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { MonitorInfo, WindowApplyOptions, WindowMode } from "../src/platform/api";
import { SAVE_SLOTS, isSaveSlotId, type SaveMeta, type SaveSlotId } from "../src/save/types";

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ID = "com.uptimeempire.app";

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LOG_FILES = 5;
const LOG_LEVELS = new Set(["info", "warn", "error"]);

const MAX_SAVE_BYTES = 32 * 1024 * 1024;
const BACKUP_COUNT = 3;

const MIN_WIDTH = 1280;
const MIN_HEIGHT = 720;

let mainWindow: BrowserWindow | null = null;
let settingsCache: Record<string, unknown> = {};
let boundsTimer: NodeJS.Timeout | null = null;

/* ── Пути ─────────────────────────────────────────────────────────── */

function logsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

function savesDir(): string {
  return path.join(app.getPath("userData"), "saves");
}

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function saveFile(slot: SaveSlotId): string {
  return path.join(savesDir(), `${slot}.save`);
}

function metaFile(slot: SaveSlotId): string {
  return path.join(savesDir(), `${slot}.meta.json`);
}

/* ── Логи ─────────────────────────────────────────────────────────── */

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

/* ── Атомарная запись ─────────────────────────────────────────────── */

function writeAtomic(file: string, data: Buffer | string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/* ── Настройки ────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettingsSync(): Record<string, unknown> {
  try {
    const text = fs.readFileSync(settingsFile(), "utf8");
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) return parsed;
    writeLog("warn", "settings.json: ожидался объект, взяты значения по умолчанию");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      writeLog("warn", `settings.json не прочитан: ${String(error)}`);
    }
  }
  return {};
}

function persistSettings(): void {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    writeAtomic(settingsFile(), `${JSON.stringify(settingsCache, null, 2)}\n`);
  } catch (error) {
    writeLog("error", `Не удалось записать settings.json: ${String(error)}`);
  }
}

function liveWindowState(): Record<string, unknown> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return isRecord(settingsCache.window) ? settingsCache.window : { width: MIN_WIDTH, height: MIN_HEIGHT, maximized: false };
  }
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(MIN_WIDTH, bounds.width),
    height: Math.max(MIN_HEIGHT, bounds.height),
    maximized: mainWindow.isMaximized(),
  };
}

function captureWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  settingsCache = { ...settingsCache, window: liveWindowState() };
}

function scheduleBoundsPersist(): void {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    captureWindowState();
    persistSettings();
  }, 600);
}

function settingsVideo(): Record<string, unknown> {
  return isRecord(settingsCache.video) ? settingsCache.video : {};
}

function startupWindowOptions(): {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
  mode: WindowMode;
  monitor: number;
} {
  const stored = isRecord(settingsCache.window) ? settingsCache.window : {};
  const video = settingsVideo();
  const modeRaw = video.mode;
  const mode: WindowMode =
    modeRaw === "borderless" || modeRaw === "fullscreen" || modeRaw === "window" ? modeRaw : "window";
  const monitor = typeof video.monitor === "number" ? video.monitor : 0;

  const width = typeof stored.width === "number" ? Math.max(MIN_WIDTH, stored.width) : 1440;
  const height = typeof stored.height === "number" ? Math.max(MIN_HEIGHT, stored.height) : 900;
  const x = typeof stored.x === "number" ? stored.x : undefined;
  const y = typeof stored.y === "number" ? stored.y : undefined;
  const maximized = stored.maximized === true;

  return { width, height, x, y, maximized, mode, monitor };
}

/* ── Окно ─────────────────────────────────────────────────────────── */

function isAllowedUrl(url: string): boolean {
  if (url.startsWith("file://")) return true;
  return Boolean(DEV_SERVER_URL) && url.startsWith(DEV_SERVER_URL as string);
}

function displayCenter(index: number): { x: number; y: number } | null {
  const displays = screen.getAllDisplays();
  const display = displays[index] ?? displays[0];
  if (!display) return null;
  const { x, y, width, height } = display.workArea;
  return { x: Math.round(x + (width - MIN_WIDTH) / 2), y: Math.round(y + (height - MIN_HEIGHT) / 2) };
}

function applyWindowMode(options: WindowApplyOptions): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const mode = options.mode;

  if (mode === "fullscreen" || mode === "borderless") {
    mainWindow.setFullScreen(true);
    return;
  }

  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);

  const center = displayCenter(Number.isFinite(options.monitor) ? options.monitor : 0);
  if (center) {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: center.x,
      y: center.y,
      width: Math.max(MIN_WIDTH, bounds.width),
      height: Math.max(MIN_HEIGHT, bounds.height),
    });
  }
  mainWindow.focus();
}

function createWindow(): void {
  const options = startupWindowOptions();

  mainWindow = new BrowserWindow({
    width: options.width,
    height: options.height,
    ...(options.x !== undefined && options.y !== undefined ? { x: options.x, y: options.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: options.mode !== "borderless",
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

  if (options.maximized) mainWindow.maximize();
  if (options.mode === "fullscreen" || options.mode === "borderless") mainWindow.setFullScreen(true);

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

  mainWindow.on("resize", scheduleBoundsPersist);
  mainWindow.on("move", scheduleBoundsPersist);
  mainWindow.on("maximize", scheduleBoundsPersist);
  mainWindow.on("unmaximize", scheduleBoundsPersist);
  mainWindow.on("close", () => {
    captureWindowState();
    persistSettings();
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

/* ── Сохранения ───────────────────────────────────────────────────── */

function rotateBackups(slot: SaveSlotId): void {
  const file = saveFile(slot);
  for (let index = BACKUP_COUNT; index >= 1; index -= 1) {
    const from = index === 1 ? file : `${file}.bak${index - 1}`;
    const to = `${file}.bak${index}`;
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch {
      writeLog("warn", `Резервная копия ${to} не создана`);
    }
  }
}

function sanitizeMeta(raw: unknown, slot: SaveSlotId): SaveMeta | null {
  if (!isRecord(raw)) return null;
  const meta = raw as Partial<SaveMeta>;
  return {
    slot,
    companyName: typeof meta.companyName === "string" ? meta.companyName : "",
    difficulty: typeof meta.difficulty === "string" ? meta.difficulty : "normal",
    day: typeof meta.day === "number" ? meta.day : 0,
    year: typeof meta.year === "number" ? meta.year : 1,
    month: typeof meta.month === "number" ? meta.month : 1,
    dayOfMonth: typeof meta.dayOfMonth === "number" ? meta.dayOfMonth : 1,
    hourOfDay: typeof meta.hourOfDay === "number" ? meta.hourOfDay : 0,
    money: typeof meta.money === "number" ? meta.money : 0,
    savedAt: typeof meta.savedAt === "string" ? meta.savedAt : new Date(0).toISOString(),
    saveVersion: typeof meta.saveVersion === "number" ? meta.saveVersion : 1,
    gameVersion: typeof meta.gameVersion === "string" ? meta.gameVersion : "0.0.0",
  };
}

function readSaveFile(file: string): unknown | null {
  try {
    const raw = fs.readFileSync(file);
    if (raw.length > MAX_SAVE_BYTES) {
      writeLog("warn", `Сохранение ${path.basename(file)} больше ${MAX_SAVE_BYTES} байт`);
      return null;
    }
    const json = zlib.gunzipSync(raw).toString("utf8");
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/* ── Жизненный цикл ───────────────────────────────────────────────── */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  settingsCache = readSettingsSync();

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

  ipcMain.on("app:quit", () => {
    app.quit();
  });

  ipcMain.handle("settings:read", () => settingsCache);

  ipcMain.handle("settings:write", (_event, incoming: unknown) => {
    if (!isRecord(incoming)) {
      writeLog("warn", "settings:write получил не объект");
      return;
    }
    captureWindowState();
    settingsCache = { ...incoming, window: liveWindowState() };
    persistSettings();
  });

  ipcMain.handle("settings:monitors", (): MonitorInfo[] => {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => ({
      index,
      label: display.label || `Display ${index + 1}`,
      primary: display.id === primaryId,
      width: display.workArea.width,
      height: display.workArea.height,
    }));
  });

  ipcMain.handle("settings:apply-window", (_event, options: unknown) => {
    if (!isRecord(options)) return;
    const mode: WindowMode =
      options.mode === "fullscreen" || options.mode === "borderless" || options.mode === "window" ? options.mode : "window";
    const monitor = typeof options.monitor === "number" ? options.monitor : 0;
    applyWindowMode({ mode, monitor });
  });

  ipcMain.handle("save:list", (): SaveMeta[] => {
    try {
      const entries = fs.readdirSync(savesDir());
      const metas: SaveMeta[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".meta.json")) continue;
        const slot = entry.slice(0, -".meta.json".length);
        if (!isSaveSlotId(slot)) continue;
        try {
          const raw: unknown = JSON.parse(fs.readFileSync(path.join(savesDir(), entry), "utf8"));
          const meta = sanitizeMeta(raw, slot);
          if (meta) metas.push(meta);
        } catch {
          writeLog("warn", `Метаданные ${entry} не прочитаны`);
        }
      }
      return metas.sort((a, b) => SAVE_SLOTS.indexOf(a.slot) - SAVE_SLOTS.indexOf(b.slot));
    } catch {
      return [];
    }
  });

  ipcMain.handle("save:read", (_event, slot: unknown) => {
    if (!isSaveSlotId(slot)) return null;
    const candidates = [saveFile(slot), `${saveFile(slot)}.bak1`, `${saveFile(slot)}.bak2`, `${saveFile(slot)}.bak3`];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index] as string;
      if (!fs.existsSync(candidate)) continue;
      const data = readSaveFile(candidate);
      if (data !== null) {
        if (index > 0) writeLog("warn", `Слот ${slot}: прочитана резервная копия ${candidate}`);
        return { data, recovered: index > 0 };
      }
    }
    return null;
  });

  ipcMain.handle("save:write", (_event, slot: unknown, data: unknown) => {
    if (!isSaveSlotId(slot)) throw new Error("Неверный слот сохранения");
    if (!isRecord(data)) throw new Error("Пустые данные сохранения");

    const json = JSON.stringify(data);
    if (json.length > MAX_SAVE_BYTES) throw new Error("Сохранение слишком большое");

    fs.mkdirSync(savesDir(), { recursive: true });
    const compressed = zlib.gzipSync(Buffer.from(json, "utf8"));
    rotateBackups(slot);
    writeAtomic(saveFile(slot), compressed);

    if (isRecord(data.meta)) {
      writeAtomic(metaFile(slot), `${JSON.stringify(data.meta, null, 2)}\n`);
    }
    writeLog("info", `Сохранение записано: ${slot} (${(compressed.length / 1024).toFixed(1)} КБ)`);
  });

  ipcMain.handle("save:remove", (_event, slot: unknown) => {
    if (!isSaveSlotId(slot)) return;
    const files = [saveFile(slot), metaFile(slot)];
    for (let index = 1; index <= BACKUP_COUNT; index += 1) files.push(`${saveFile(slot)}.bak${index}`);
    for (const file of files) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Файла могло не быть.
      }
    }
  });

  ipcMain.handle("save:export", async (_event, data: unknown, suggestedName: unknown) => {
    if (!mainWindow) return { ok: false };
    const name = typeof suggestedName === "string" && suggestedName.trim() ? suggestedName : "uptime-save.json";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Экспорт сохранения",
      defaultPath: path.join(app.getPath("documents"), name),
      filters: [{ name: "Uptime Empire save", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    try {
      writeAtomic(result.filePath, `${JSON.stringify(data, null, 2)}\n`);
      return { ok: true, path: result.filePath };
    } catch (error) {
      writeLog("error", `Экспорт не удался: ${String(error)}`);
      return { ok: false };
    }
  });

  ipcMain.handle("save:import", async () => {
    if (!mainWindow) return { ok: false };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Импорт сохранения",
      properties: ["openFile"],
      filters: [{ name: "Uptime Empire save", extensions: ["json"] }],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false, canceled: true };

    try {
      const stats = fs.statSync(file);
      if (stats.size > MAX_SAVE_BYTES) return { ok: false, error: "Файл слишком большой" };
      const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ok: true, data: raw };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  process.on("uncaughtException", (error) => {
    writeLog("error", `uncaughtException: ${error.stack ?? error.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    writeLog("error", `unhandledRejection: ${String(reason)}`);
  });

  void app.whenReady().then(() => {
    writeLog("info", `Старт Uptime Empire ${app.getVersion()} (${process.platform})`);
    persistSettings();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    captureWindowState();
    persistSettings();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
