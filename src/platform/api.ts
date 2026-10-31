import type { SaveMeta, SaveSlotId } from "../save/types";

export type LogLevel = "info" | "warn" | "error";

export type WindowMode = "window" | "borderless" | "fullscreen";

export interface AppVersions {
  app: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface MonitorInfo {
  index: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface WindowApplyOptions {
  mode: WindowMode;
  monitor: number;
}

/** Настройки: чтение/запись settings.json и управление окном. */
export interface SettingsBridge {
  read: () => Promise<unknown | null>;
  write: (settings: unknown) => Promise<void>;
  monitors: () => Promise<MonitorInfo[]>;
  applyWindow: (options: WindowApplyOptions) => Promise<void>;
}

export interface SaveReadResult {
  data: unknown;
  /** true, если основной файл был испорчен и прочитана резервная копия. */
  recovered: boolean;
}

export interface SaveExportResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
}

export interface SaveImportResult {
  ok: boolean;
  canceled?: boolean;
  data?: unknown;
  error?: string;
}

/** Слоты сохранений: файлы в userData/saves (DESIGN.md, разд. 13). */
export interface SaveBridge {
  list: () => Promise<SaveMeta[]>;
  read: (slot: SaveSlotId) => Promise<SaveReadResult | null>;
  write: (slot: SaveSlotId, data: unknown) => Promise<void>;
  remove: (slot: SaveSlotId) => Promise<void>;
  exportFile: (data: unknown, suggestedName: string) => Promise<SaveExportResult>;
  importFile: () => Promise<SaveImportResult>;
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
  settings: SettingsBridge;
  saves: SaveBridge;
  quit: () => void;
}
