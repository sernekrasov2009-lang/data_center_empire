import type { LogLevel, UptimeApi } from "./api";
import type { SaveMeta } from "../save/types";

export type { LogLevel, UptimeApi, AppVersions } from "./api";

declare global {
  interface Window {
    uptime?: UptimeApi;
  }
}

const BROWSER_SETTINGS_KEY = "uptime.settings";
const BROWSER_SAVE_PREFIX = "uptime.save.";

function readJson(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/**
 * Заглушка для запуска интерфейса в обычном браузере (`vite`), а также для тестов.
 * Настройки и слоты хранятся в localStorage, чтобы меню можно было проверить без Electron.
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
  settings: {
    read: async () => readJson(BROWSER_SETTINGS_KEY),
    write: async (value: unknown) => {
      window.localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(value));
    },
    monitors: async () => [
      {
        index: 0,
        label: "Browser",
        primary: true,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    ],
    applyWindow: async () => undefined,
  },
  saves: {
    list: async () => {
      const metas: SaveMeta[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(BROWSER_SAVE_PREFIX)) continue;
        const data = readJson(key);
        if (typeof data === "object" && data !== null && "meta" in data) {
          const meta = (data as { meta?: unknown }).meta;
          if (typeof meta === "object" && meta !== null) {
            metas.push(meta as SaveMeta);
          }
        }
      }
      return metas;
    },
    read: async (slot) => {
      const data = readJson(`${BROWSER_SAVE_PREFIX}${slot}`);
      return data === null ? null : { data, recovered: false };
    },
    write: async (slot, data) => {
      window.localStorage.setItem(`${BROWSER_SAVE_PREFIX}${slot}`, JSON.stringify(data));
    },
    remove: async (slot) => {
      window.localStorage.removeItem(`${BROWSER_SAVE_PREFIX}${slot}`);
    },
    exportFile: async () => ({ ok: false, canceled: true }),
    importFile: async () => ({ ok: false, canceled: true }),
  },
  quit: () => undefined,
};

export const platform: UptimeApi =
  typeof window !== "undefined" && window.uptime ? window.uptime : browserFallback;
