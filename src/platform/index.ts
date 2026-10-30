import type { LogLevel, UptimeApi } from "./api";

export type { LogLevel, UptimeApi, AppVersions } from "./api";

declare global {
  interface Window {
    uptime?: UptimeApi;
  }
}

/**
 * Заглушка для запуска интерфейса в обычном браузере (`vite`), а также для тестов.
 * В Electron мост всегда есть, поэтому приложение работает через реальный API.
 */
const browserFallback: UptimeApi = {
  isElectron: false,
  platform: "browser",
  versions: { app: "0.0.0-dev", electron: "", chrome: "", node: "" },
  writeLog: (level: LogLevel, message: string) => {
    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    sink(`[uptime] ${message}`);
  },
  openLogsFolder: async () => undefined,
};

export const platform: UptimeApi =
  typeof window !== "undefined" && window.uptime ? window.uptime : browserFallback;
