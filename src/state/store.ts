import { create } from "zustand";
import { balance } from "../data";
import type { DifficultyId } from "../data";
import type { Language } from "../i18n/language";
import { platform } from "../platform";
import type { MonitorInfo } from "../platform/api";
import { buildSaveMeta } from "../save/meta";
import { SaveError, buildEnvelope, parseSave } from "../save/migrate";
import type { SaveMeta, SaveSlotId } from "../save/types";
import {
  advanceTicks,
  createGame,
  getGameDate,
  setPaused,
  setSpeed as applySpeed,
  togglePause as applyTogglePause,
  type GameState,
  type SimEvent,
  type Speed,
} from "../sim";
import { withBinding, type HotkeyAction } from "./hotkeys";
import { createDefaultSettings, mergeSettings, type Settings } from "./settings";

export type Screen = "menu" | "game";
export type Overlay = "newGame" | "slots" | "pause" | "settings" | null;
export type SlotMode = "save" | "load";
export type ToastKind = "info" | "warn" | "error";

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

export interface PerfStats {
  fps: number;
  simMs: number;
  simMsAvg: number;
  ticksPerSecond: number;
}

export interface Toast {
  id: number;
  key: string;
  params?: Record<string, string | number>;
  kind: ToastKind;
}

export interface ConfirmRequest {
  titleKey: string;
  textKey: string;
  params?: Record<string, string | number>;
  confirmKey?: string;
  danger?: boolean;
  action: () => void;
}

interface NewGameRequest {
  difficulty: DifficultyId;
  companyName: string;
  seed: number;
}

export type { NewGameRequest };

interface GameStore {
  screen: Screen;
  overlay: Overlay;
  returnTo: Overlay;
  slotMode: SlotMode;

  settings: Settings;
  settingsReady: boolean;
  monitors: MonitorInfo[];

  game: GameState;
  events: SimEvent[];
  dirty: boolean;
  saves: SaveMeta[];
  savesBusy: boolean;

  debugVisible: boolean;
  perf: PerfStats;
  confirm: ConfirmRequest | null;
  toast: Toast | null;

  boot: () => Promise<void>;

  newGame: (request: NewGameRequest) => void;
  continueGame: () => Promise<void>;
  goToMenu: () => void;

  openNewGame: () => void;
  openSlots: (mode: SlotMode) => void;
  openPause: () => void;
  openSettings: (returnTo?: Overlay) => void;
  closeOverlay: () => void;
  resume: () => void;

  saveSlot: (slot: SaveSlotId) => Promise<void>;
  loadSlot: (slot: SaveSlotId) => Promise<void>;
  removeSlot: (slot: SaveSlotId) => Promise<void>;
  quickSave: () => Promise<void>;
  quickLoad: () => Promise<void>;
  exportSave: () => Promise<void>;
  importSave: () => Promise<void>;
  refreshSaves: () => Promise<void>;

  requestConfirm: (request: ConfirmRequest) => void;
  resolveConfirm: (accepted: boolean) => void;
  notify: (key: string, params?: Record<string, string | number>, kind?: ToastKind) => void;
  dismissToast: () => void;

  updateSettings: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void;
  resetSection: <K extends keyof Settings>(section: K) => void;
  setHotkey: (action: HotkeyAction, slot: 0 | 1, binding: string | null) => void;
  resetHotkeys: () => void;
  toggleLanguage: () => void;

  setSpeed: (speed: Speed) => void;
  togglePause: () => void;
  advance: (realMs: number) => void;
  setPerf: (patch: Partial<PerfStats>) => void;
  toggleDebug: () => void;
}

const initialPerf: PerfStats = { fps: 0, simMs: 0, simMsAvg: 0, ticksPerSecond: 0 };

let frameAccumulatorMs = 0;
let ticksPerSecondAvg = 0;
let autosaveClockMs = 0;
let autosaveBusy = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

function eventsNewestFirst(game: GameState): SimEvent[] {
  return game.events.slice().reverse();
}

function describeSaveError(error: unknown): string {
  if (error instanceof SaveError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export const useGameStore = create<GameStore>((set, get) => {
  function notify(key: string, params?: Record<string, string | number>, kind: ToastKind = "info"): void {
    toastId += 1;
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: toastId, key, params, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 4000);
  }

  function persistSettingsSoon(settings: Settings): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void platform.settings.write(settings).catch((error: unknown) => {
        platform.writeLog("error", `settings write failed: ${String(error)}`);
        notify("toast.settingsError", undefined, "error");
      });
    }, 300);
  }

  function applyGame(next: GameState, events?: SimEvent[]): void {
    set({
      game: next,
      events: events ?? eventsNewestFirst(next),
      screen: "game",
      overlay: null,
      returnTo: null,
      dirty: true,
    });
  }

  async function autosave(): Promise<void> {
    const { screen, game, settingsReady } = get();
    if (!settingsReady || screen !== "game" || autosaveBusy) return;
    autosaveBusy = true;
    try {
      const meta = buildSaveMeta("autosave", game, platform.versions.app);
      await platform.saves.write("autosave", buildEnvelope(meta, game));
      set({ saves: await platform.saves.list() });
    } catch (error) {
      platform.writeLog("warn", `autosave failed: ${String(error)}`);
    } finally {
      autosaveBusy = false;
    }
  }

  function startLoadedGame(data: unknown, slot: SaveSlotId): boolean {
    try {
      const parsed = parseSave(data, slot);
      autosaveClockMs = 0;
      applyGame(setPaused(parsed.game, true));
      if (parsed.migratedFrom !== null) {
        notify("toast.migrated", { version: parsed.migratedFrom }, "warn");
      } else {
        notify("toast.loaded");
      }
      set({ dirty: false });
      return true;
    } catch (error) {
      notify("toast.saveBroken", { reason: describeSaveError(error) }, "error");
      return false;
    }
  }

  return {
    screen: "menu",
    overlay: null,
    returnTo: null,
    slotMode: "load",

    settings: createDefaultSettings(),
    settingsReady: false,
    monitors: [],

    game: createGame(),
    events: [],
    dirty: false,
    saves: [],
    savesBusy: false,

    debugVisible: false,
    perf: initialPerf,
    confirm: null,
    toast: null,

    boot: async () => {
      if (get().settingsReady) return;

      const [rawSettings, monitors, saves] = await Promise.all([
        platform.settings.read().catch(() => null),
        platform.settings.monitors().catch(() => []),
        platform.saves.list().catch(() => []),
      ]);

      const { settings, issues } = mergeSettings(rawSettings);
      if (issues.length > 0) platform.writeLog("warn", issues.join("; "));

      document.documentElement.lang = settings.game.language;
      set({ settings, monitors, saves, settingsReady: true });

      // Нормализуем settings.json: недостающие поля получают значения по умолчанию.
      void platform.settings.write(settings).catch((error: unknown) => {
        platform.writeLog("warn", `settings normalize failed: ${String(error)}`);
      });
    },

    newGame: ({ difficulty, companyName, seed }) => {
      const { settings } = get();
      const game = createGame({ difficulty, companyName, seed });
      autosaveClockMs = 0;
      set({
        game: setPaused(applySpeed(game, settings.game.defaultSpeed), true),
        events: [],
        screen: "game",
        overlay: null,
        returnTo: null,
        dirty: true,
      });
    },

    continueGame: async () => {
      const saves = get().saves.slice().sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
      const newest = saves[0];
      if (!newest) {
        notify("toast.noSaves", undefined, "warn");
        return;
      }
      await get().loadSlot(newest.slot);
    },

    goToMenu: () => {
      set({ screen: "menu", overlay: null, returnTo: null, dirty: false });
      frameAccumulatorMs = 0;
    },

    openNewGame: () => set({ overlay: "newGame", returnTo: null }),
    openSlots: (mode) => set({ overlay: "slots", slotMode: mode, returnTo: get().overlay }),
    openPause: () => {
      const { screen, game } = get();
      if (screen !== "game") return;
      frameAccumulatorMs = 0;
      set({ overlay: "pause", returnTo: null, game: setPaused(game, true) });
    },
    openSettings: (returnTo = null) => set({ overlay: "settings", returnTo }),
    closeOverlay: () => set({ overlay: get().returnTo, returnTo: null }),
    resume: () => {
      const { game } = get();
      frameAccumulatorMs = 0;
      set({ overlay: null, returnTo: null, game: setPaused(game, false) });
    },

    saveSlot: async (slot) => {
      const { game } = get();
      set({ savesBusy: true });
      try {
        const meta = buildSaveMeta(slot, game, platform.versions.app);
        await platform.saves.write(slot, buildEnvelope(meta, game));
        await get().refreshSaves();
        set({ dirty: false });
        notify("toast.saved");
      } catch (error) {
        platform.writeLog("error", `save failed: ${String(error)}`);
        notify("toast.saveError", undefined, "error");
      } finally {
        set({ savesBusy: false });
      }
    },

    loadSlot: async (slot) => {
      set({ savesBusy: true });
      try {
        const result = await platform.saves.read(slot);
        if (!result) {
          notify("toast.saveNotFound", undefined, "warn");
          return;
        }
        if (result.recovered) notify("toast.saveRecovered", undefined, "warn");
        startLoadedGame(result.data, slot);
      } catch (error) {
        notify("toast.saveBroken", { reason: describeSaveError(error) }, "error");
      } finally {
        set({ savesBusy: false });
      }
    },

    removeSlot: async (slot) => {
      set({ savesBusy: true });
      try {
        await platform.saves.remove(slot);
        await get().refreshSaves();
        notify("toast.deleted");
      } finally {
        set({ savesBusy: false });
      }
    },

    quickSave: async () => {
      if (get().screen !== "game") return;
      await get().saveSlot("quicksave");
    },

    quickLoad: async () => {
      await get().loadSlot("quicksave");
    },

    exportSave: async () => {
      const { game } = get();
      const meta = buildSaveMeta("quicksave", game, platform.versions.app);
      const date = getGameDate(game.time.hour);
      const name = `${game.companyName.replace(/[\\/:*?"<>|]/g, "_")}-y${date.year}m${date.month}d${date.dayOfMonth}.json`;
      try {
        const result = await platform.saves.exportFile(buildEnvelope(meta, game), name);
        if (result.ok) notify("toast.exported", { path: result.path ?? "" });
        else if (!result.canceled) notify("toast.exportError", undefined, "error");
      } catch {
        notify("toast.exportError", undefined, "error");
      }
    },

    importSave: async () => {
      try {
        const result = await platform.saves.importFile();
        if (!result.ok || result.data === undefined) {
          if (!result.canceled) notify("toast.importError", undefined, "error");
          return;
        }
        if (startLoadedGame(result.data, "quicksave")) notify("toast.imported");
      } catch {
        notify("toast.importError", undefined, "error");
      }
    },

    refreshSaves: async () => {
      try {
        set({ saves: await platform.saves.list() });
      } catch {
        // Список слотов не критичен для игры.
      }
    },

    requestConfirm: (request) => set({ confirm: request }),
    resolveConfirm: (accepted) => {
      const request = get().confirm;
      set({ confirm: null });
      if (accepted && request) request.action();
    },
    notify,
    dismissToast: () => set({ toast: null }),

    updateSettings: (section, patch) => {
      const current = get().settings;
      const nextSection = Object.assign({}, current[section], patch) as Settings[typeof section];
      const next: Settings = { ...current, [section]: nextSection };

      if (section === "game" && typeof patch === "object" && patch !== null && "language" in patch) {
        document.documentElement.lang = next.game.language;
      }

      set({ settings: next });
      persistSettingsSoon(next);

      if (section === "video" && ("mode" in patch || "monitor" in patch)) {
        void platform.settings
          .applyWindow({ mode: next.video.mode, monitor: next.video.monitor })
          .catch(() => undefined);
      }
    },

    resetSection: (section) => {
      const defaults = createDefaultSettings();
      const next: Settings = { ...get().settings, [section]: defaults[section] };
      set({ settings: next });
      persistSettingsSoon(next);
      if (section === "game") document.documentElement.lang = next.game.language;
      if (section === "video") {
        void platform.settings
          .applyWindow({ mode: next.video.mode, monitor: next.video.monitor })
          .catch(() => undefined);
      }
    },

    setHotkey: (action, slot, binding) => {
      const settings = get().settings;
      const next: Settings = { ...settings, hotkeys: withBinding(settings.hotkeys, action, slot, binding) };
      set({ settings: next });
      persistSettingsSoon(next);
    },

    resetHotkeys: () => {
      const defaults = createDefaultSettings();
      const next: Settings = { ...get().settings, hotkeys: defaults.hotkeys };
      set({ settings: next });
      persistSettingsSoon(next);
    },

    toggleLanguage: () => {
      const current = get().settings.game.language;
      const next: Language = current === "ru" ? "en" : "ru";
      get().updateSettings("game", { language: next });
    },

    setSpeed: (speed: Speed) => {
      if (get().screen !== "game") return;
      frameAccumulatorMs = 0;
      set({ game: applySpeed(get().game, speed) });
    },

    togglePause: () => {
      if (get().screen !== "game") return;
      frameAccumulatorMs = 0;
      set({ game: applyTogglePause(get().game) });
    },

    advance: (realMs: number) => {
      const { game, screen, overlay, settings, dirty } = get();
      // Открытый диалог останавливает время, но не меняет флаг паузы.
      if (screen !== "game" || overlay !== null || game.time.paused || game.time.speed === 0) {
        frameAccumulatorMs = 0;
        return;
      }

      const frameMs = Math.min(Math.max(realMs, 0), balance.limits.maxFrameMs);
      frameAccumulatorMs += frameMs;

      const hoursPerSecond = balance.time.hoursPerRealSecond * game.time.speed;
      if (hoursPerSecond <= 0) return;

      const due = (frameAccumulatorMs / 1000) * hoursPerSecond;
      const ticks = Math.min(Math.floor(due), balance.limits.maxTicksPerFrame);
      if (ticks <= 0) return;

      frameAccumulatorMs = Math.max(0, frameAccumulatorMs - (ticks / hoursPerSecond) * 1000);

      const started = performance.now();
      const result = advanceTicks(game, ticks);
      const elapsed = performance.now() - started;

      const instantRate = frameMs > 0 ? ticks / (frameMs / 1000) : 0;
      ticksPerSecondAvg = ticksPerSecondAvg === 0 ? instantRate : ticksPerSecondAvg * 0.85 + instantRate * 0.15;

      const perf = get().perf;
      const newEvents = result.events.slice().reverse();

      set({
        game: result.state,
        events: newEvents.length > 0 ? [...newEvents, ...get().events].slice(0, balance.limits.eventLogSize) : get().events,
        dirty: dirty || ticks > 0,
        perf: {
          ...perf,
          simMs: elapsed,
          simMsAvg: perf.simMsAvg === 0 ? elapsed : perf.simMsAvg * 0.9 + elapsed * 0.1,
          ticksPerSecond: ticksPerSecondAvg,
        },
      });

      if (settings.game.autosave === "month" && result.events.some((event) => event.kind === "monthClosed")) {
        void autosave();
      }
      if (settings.game.autosave === "5min") {
        autosaveClockMs += frameMs;
        if (autosaveClockMs >= AUTOSAVE_INTERVAL_MS) {
          autosaveClockMs = 0;
          void autosave();
        }
      }
    },

    setPerf: (patch) => set({ perf: { ...get().perf, ...patch } }),
    toggleDebug: () => set({ debugVisible: !get().debugVisible }),
  };
});

/** Для тестов и не-React кода. */
export const gameStore = useGameStore;
