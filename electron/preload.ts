import { contextBridge, ipcRenderer } from "electron";
import type { AppVersions, LogLevel, SaveBridge, SettingsBridge, UptimeApi } from "../src/platform/api";

function readArg(prefix: string): string {
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

const versions: AppVersions = {
  app: readArg("--app-version=") || "0.0.0",
  electron: process.versions.electron ?? "",
  chrome: process.versions.chrome ?? "",
  node: process.versions.node ?? "",
};

const settings: SettingsBridge = {
  read: () => ipcRenderer.invoke("settings:read"),
  write: (value: unknown) => ipcRenderer.invoke("settings:write", value),
  monitors: () => ipcRenderer.invoke("settings:monitors"),
  applyWindow: (options) => ipcRenderer.invoke("settings:apply-window", options),
};

const saves: SaveBridge = {
  list: () => ipcRenderer.invoke("save:list"),
  read: (slot) => ipcRenderer.invoke("save:read", slot),
  write: (slot, data) => ipcRenderer.invoke("save:write", slot, data),
  remove: (slot) => ipcRenderer.invoke("save:remove", slot),
  exportFile: (data, suggestedName) => ipcRenderer.invoke("save:export", data, suggestedName),
  importFile: () => ipcRenderer.invoke("save:import"),
};

/**
 * Единственный мост между интерфейсом и системой. Каналы ограничены группами
 * save:* / settings:* / log:* (GAME.md, правило 14).
 */
const api: UptimeApi = {
  isElectron: true,
  platform: process.platform,
  versions,
  writeLog: (level: LogLevel, message: string) => {
    ipcRenderer.send("log:write", level, String(message).slice(0, 4000));
  },
  openLogsFolder: async () => {
    await ipcRenderer.invoke("log:open-folder");
  },
  settings,
  saves,
  quit: () => {
    ipcRenderer.send("app:quit");
  },
};

contextBridge.exposeInMainWorld("uptime", api);
