import { contextBridge, ipcRenderer } from "electron";
import type { AppVersions, LogLevel, UptimeApi } from "../src/platform/api";

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

/**
 * Единственный мост между интерфейсом и системой. Каналы ограничены группами
 * save:* / settings:* / log:* (GAME.md, правило 14); пока реализованы только log:*.
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
};

contextBridge.exposeInMainWorld("uptime", api);
