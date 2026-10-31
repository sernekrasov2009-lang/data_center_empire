import type { Language } from "../i18n/language";
import type { Speed } from "../data";
import { GAME_SPEEDS } from "../data";
import type { WindowMode } from "../platform/api";
import { sanitizeHotkeys, type HotkeysSettings } from "./hotkeys";

export type { WindowMode };

export type AutosaveMode = "never" | "month" | "5min";
export type AnimationsMode = "on" | "reduced" | "off";
export type NumberFormat = "short" | "full";
export type HintsMode = "all" | "important" | "off";

export const SETTINGS_VERSION = 1;

export interface GameSettings {
  language: Language;
  defaultSpeed: Exclude<Speed, 0>;
  autosave: AutosaveMode;
  /** Автопауза при событии с серьёзным ущербом (появится вместе с событиями). */
  autosaveOnCritical: boolean;
  confirmExpensive: boolean;
  confirmDangerous: boolean;
  numberFormat: NumberFormat;
  hints: HintsMode;
}

export interface VideoSettings {
  mode: WindowMode;
  /** Индекс монитора из списка main-процесса. */
  monitor: number;
  vsync: boolean;
  /** 0 — без ограничения. */
  fpsLimit: 30 | 60 | 120 | 0;
  /** Масштаб интерфейса, %. */
  uiScale: number;
  /** Масштаб шрифта, %. */
  fontScale: number;
  animations: AnimationsMode;
}

export interface AudioSettings {
  master: number;
  effects: number;
  hum: number;
  alarms: number;
  muteOnBlur: boolean;
}

export interface AccessibilitySettings {
  colorblind: boolean;
  highContrast: boolean;
  visualAlarms: boolean;
}

/** Размер и положение окна поддерживает main-процесс (DESIGN.md, разд. 19). */
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Settings {
  version: number;
  game: GameSettings;
  video: VideoSettings;
  audio: AudioSettings;
  accessibility: AccessibilitySettings;
  hotkeys: HotkeysSettings;
  window: WindowState;
}

export function createDefaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    game: {
      language: "ru",
      defaultSpeed: 1,
      autosave: "month",
      autosaveOnCritical: true,
      confirmExpensive: true,
      confirmDangerous: true,
      numberFormat: "short",
      hints: "all",
    },
    video: {
      mode: "window",
      monitor: 0,
      vsync: true,
      fpsLimit: 60,
      uiScale: 100,
      fontScale: 100,
      animations: "on",
    },
    audio: {
      master: 60,
      effects: 60,
      hum: 40,
      alarms: 70,
      muteOnBlur: true,
    },
    accessibility: {
      colorblind: false,
      highContrast: false,
      visualAlarms: false,
    },
    hotkeys: sanitizeHotkeys(null),
    window: { width: 1440, height: 900, maximized: false },
  };
}

/** Значения по умолчанию для одной вкладки — кнопка «По умолчанию». */
export function defaultSection<K extends keyof Settings>(section: K): Settings[K] {
  return createDefaultSettings()[section];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function pickInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = pickNumber(value, min, max, fallback);
  return Math.round(number);
}

function pickNumericEnum<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "number" && (allowed as readonly number[]).includes(value) ? (value as T) : fallback;
}

function pickSpeed(value: unknown, fallback: Exclude<Speed, 0>): Exclude<Speed, 0> {
  return typeof value === "number" && (GAME_SPEEDS as readonly number[]).includes(value)
    ? (value as Exclude<Speed, 0>)
    : fallback;
}

/**
 * Приводит содержимое settings.json к текущей схеме. Неизвестные поля
 * отбрасываются, испорченные значения заменяются значениями по умолчанию.
 */
export function mergeSettings(raw: unknown): { settings: Settings; issues: string[] } {
  const defaults = createDefaultSettings();
  const issues: string[] = [];

  if (raw === null || raw === undefined) {
    return { settings: defaults, issues };
  }
  if (!isRecord(raw)) {
    return { settings: defaults, issues: ["settings: ожидался объект, взяты значения по умолчанию"] };
  }

  const game = isRecord(raw.game) ? raw.game : {};
  const video = isRecord(raw.video) ? raw.video : {};
  const audio = isRecord(raw.audio) ? raw.audio : {};
  const accessibility = isRecord(raw.accessibility) ? raw.accessibility : {};
  const windowState = isRecord(raw.window) ? raw.window : {};

  const settings: Settings = {
    version: SETTINGS_VERSION,
    game: {
      language: pickEnum(game.language, ["ru", "en"], defaults.game.language) as Language,
      defaultSpeed: pickSpeed(game.defaultSpeed, defaults.game.defaultSpeed),
      autosave: pickEnum(game.autosave, ["never", "month", "5min"], defaults.game.autosave),
      autosaveOnCritical: pickBoolean(game.autosaveOnCritical, defaults.game.autosaveOnCritical),
      confirmExpensive: pickBoolean(game.confirmExpensive, defaults.game.confirmExpensive),
      confirmDangerous: pickBoolean(game.confirmDangerous, defaults.game.confirmDangerous),
      numberFormat: pickEnum(game.numberFormat, ["short", "full"], defaults.game.numberFormat),
      hints: pickEnum(game.hints, ["all", "important", "off"], defaults.game.hints),
    },
    video: {
      mode: pickEnum(video.mode, ["window", "borderless", "fullscreen"], defaults.video.mode),
      monitor: pickInteger(video.monitor, 0, 15, defaults.video.monitor),
      vsync: pickBoolean(video.vsync, defaults.video.vsync),
      fpsLimit: pickNumericEnum(video.fpsLimit, [30, 60, 120, 0], defaults.video.fpsLimit),
      uiScale: pickInteger(video.uiScale, 75, 200, defaults.video.uiScale),
      fontScale: pickInteger(video.fontScale, 85, 150, defaults.video.fontScale),
      animations: pickEnum(video.animations, ["on", "reduced", "off"], defaults.video.animations),
    },
    audio: {
      master: pickInteger(audio.master, 0, 100, defaults.audio.master),
      effects: pickInteger(audio.effects, 0, 100, defaults.audio.effects),
      hum: pickInteger(audio.hum, 0, 100, defaults.audio.hum),
      alarms: pickInteger(audio.alarms, 0, 100, defaults.audio.alarms),
      muteOnBlur: pickBoolean(audio.muteOnBlur, defaults.audio.muteOnBlur),
    },
    accessibility: {
      colorblind: pickBoolean(accessibility.colorblind, defaults.accessibility.colorblind),
      highContrast: pickBoolean(accessibility.highContrast, defaults.accessibility.highContrast),
      visualAlarms: pickBoolean(accessibility.visualAlarms, defaults.accessibility.visualAlarms),
    },
    hotkeys: sanitizeHotkeys(raw.hotkeys),
    window: {
      x: typeof windowState.x === "number" ? windowState.x : undefined,
      y: typeof windowState.y === "number" ? windowState.y : undefined,
      width: pickInteger(windowState.width, 1280, 10000, defaults.window.width),
      height: pickInteger(windowState.height, 720, 10000, defaults.window.height),
      maximized: pickBoolean(windowState.maximized, defaults.window.maximized),
    },
  };

  if (typeof raw.version === "number" && raw.version !== SETTINGS_VERSION) {
    issues.push(`settings: версия ${raw.version} приведена к ${SETTINGS_VERSION}`);
  }

  return { settings, issues };
}
