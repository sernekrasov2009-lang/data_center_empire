export type LogLevel = "info" | "warn" | "error";

export interface AppVersions {
  app: string;
  electron: string;
  chrome: string;
  node: string;
}

/**
 * Контракт моста preload → интерфейс. Должен совпадать с объектом,
 * который выставляет electron/preload.ts.
 */
export interface UptimeApi {
  isElectron: boolean;
  platform: string;
  versions: AppVersions;
  writeLog: (level: LogLevel, message: string) => void;
  openLogsFolder: () => Promise<void>;
}
