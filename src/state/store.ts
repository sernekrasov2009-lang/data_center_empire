import { create } from "zustand";
import { balance, findComponent } from "../data";
import type { DifficultyId, ServiceId } from "../data";
import type { Language } from "../i18n/language";
import { platform } from "../platform";
import type { MonitorInfo } from "../platform/api";
import { buildSaveMeta } from "../save/meta";
import { SaveError, buildEnvelope, parseSave } from "../save/migrate";
import type { SaveMeta, SaveSlotId } from "../save/types";
import {
  advanceTicks,
  buyInsulation as applyBuyInsulation,
  buyStabilizer as applyBuyStabilizer,
  buyUps as applyBuyUps,
  buyUsedLot as applyBuyUsedLot,
  cancelOrder as applyCancelOrder,
  createGame,
  getGameDate,
  placeNewOrder as applyNewOrder,
  resolveTickets as applyResolveTickets,
  previewNewOrder,
  resetBreaker as applyResetBreaker,
  restartServers as applyRestartServers,
  returnOrder as applyReturnOrder,
  setBuildSlot as applySetBuildSlot,
  setCooling as applySetCooling,
  setInternetPlan as applySetInternetPlan,
  setServiceLimit as applySetServiceLimit,
  moveLocation as applyMoveLocation,
  setServicePrice as applySetServicePrice,
  toggleService as applyToggleService,
  setPaused,
  setSpeed as applySpeed,
  fireStaff as applyFireStaff,
  hireStaff as applyHireStaff,
  startResearch as applyStartResearch,
  cancelResearch as applyCancelResearch,
  startBuild as applyStartBuild,
  togglePause as applyTogglePause,
  type GameState,
  type HardwareFailure,
  type LocationFailure,
  type ServiceFailure,
  type StaffFailure,
  type ResearchFailure,
  type SimEvent,
  type Speed,
} from "../sim";
import { withBinding, type HotkeyAction } from "./hotkeys";
import { createDefaultSettings, mergeSettings, type Settings } from "./settings";
import { formatMoney } from "../ui/format";

export type Screen = "menu" | "game";
export type GameView =
  | "dashboard"
  | "build"
  | "warehouse"
  | "location"
  | "services"
  | "staff"
  | "research";
export type Overlay = "newGame" | "slots" | "pause" | "settings" | "gameOver" | null;
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
  view: GameView;

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
  setView: (view: GameView) => void;

  saveSlot: (slot: SaveSlotId) => Promise<void>;
  loadSlot: (slot: SaveSlotId) => Promise<void>;
  removeSlot: (slot: SaveSlotId) => Promise<void>;
  quickSave: () => Promise<void>;
  quickLoad: () => Promise<void>;
  exportSave: () => Promise<void>;
  importSave: () => Promise<void>;
  refreshSaves: () => Promise<void>;

  placeNewOrder: (componentId: string, quantity: number) => void;
  buyUsedLot: (lotId: number) => void;
  cancelOrder: (orderId: number) => void;
  returnOrder: (orderId: number) => void;
  startBuild: (partIds: number[]) => boolean;
  placeBuild: (buildId: number, slot: number | null) => void;
  setCooling: (coolingId: string) => void;
  setInternetPlan: (planId: string) => void;
  buyInsulation: () => void;
  buyUps: () => void;
  buyStabilizer: () => void;
  moveLocation: (locationId: string) => void;
  hireStaff: (roleId: string) => void;
  fireStaff: (employeeId: number) => void;
  startResearch: (id: string) => void;
  cancelResearch: (id: string) => void;
  resetBreaker: () => void;
  restartServers: () => void;
  setServicePrice: (serviceId: ServiceId, priceMult: number) => void;
  toggleService: (serviceId: ServiceId) => void;
  setServiceLimit: (serviceId: ServiceId, limit: number) => void;
  resolveTickets: () => void;

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
      view: "dashboard",
      dirty: true,
    });
  }

  function notifyFailure(failure: HardwareFailure): void {
    if (failure.code === "invalidBuild" && failure.buildErrors && failure.buildErrors.length > 0) {
      const first = failure.buildErrors[0]!;
      notify(`hardware.error.${first.code}`, first.params, "error");
      return;
    }
    notify(`hardware.error.${failure.code}`, failure.params, "error");
  }

  function notifyLocationFailure(failure: LocationFailure): void {
    notify(`location.error.${failure.code}`, failure.params, "error");
  }

  function notifyServiceFailure(failure: ServiceFailure): void {
    notify(`services.error.${failure.code}`, failure.params, "error");
  }

  function notifyStaffFailure(failure: StaffFailure): void {
    notify(`staff.error.${failure.code}`, failure.params, "error");
  }

  function notifyResearchFailure(failure: ResearchFailure): void {
    notify(`research.error.${failure.code}`, failure.params, "error");
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
      if (parsed.game.gameOver) set({ overlay: "gameOver" });
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
    view: "dashboard",

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
        view: "dashboard",
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
      if (screen !== "game" || game.gameOver) return;
      frameAccumulatorMs = 0;
      set({ overlay: "pause", returnTo: null, game: setPaused(game, true) });
    },
    openSettings: (returnTo = null) => set({ overlay: "settings", returnTo }),
    closeOverlay: () => set({ overlay: get().returnTo, returnTo: null }),
    resume: () => {
      const { game } = get();
      if (game.gameOver) return;
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
      if (get().screen !== "game" || get().game.gameOver) return;
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

    setView: (view) => set({ view }),

    placeNewOrder: (componentId, quantity) => {
      const { game, settings } = get();
      const preview = previewNewOrder(game, componentId, quantity);
      const language = settings.game.language;
      const numberFormat = settings.game.numberFormat;

      const commit = (): void => {
        const result = applyNewOrder(get().game, componentId, quantity);
        if (!result.ok) {
          notifyFailure(result.failure);
          return;
        }
        set({ game: result.state, dirty: true });
        notify("toast.orderPlaced", {
          total: formatMoney(result.order.total, language, numberFormat),
        });
      };

      if (settings.game.confirmExpensive && preview.total > 1000) {
        get().requestConfirm({
          titleKey: "hardware.confirm.title",
          textKey: "hardware.confirm.text",
          params: { total: formatMoney(preview.total, language, numberFormat) },
          action: commit,
        });
        return;
      }
      commit();
    },

    buyUsedLot: (lotId) => {
      const { settings } = get();
      const result = applyBuyUsedLot(get().game, lotId);
      if (!result.ok) {
        notifyFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.lotBought", {
        total: formatMoney(result.order.total, settings.game.language, settings.game.numberFormat),
      });
    },

    cancelOrder: (orderId) => {
      const { settings } = get();
      const result = applyCancelOrder(get().game, orderId);
      if (!result.ok) {
        notifyFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.orderCancelled", {
        refund: formatMoney(result.refund, settings.game.language, settings.game.numberFormat),
      });
    },

    returnOrder: (orderId) => {
      const { settings } = get();
      const result = applyReturnOrder(get().game, orderId);
      if (!result.ok) {
        notifyFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.orderReturned", {
        refund: formatMoney(result.refund, settings.game.language, settings.game.numberFormat),
      });
    },

    startBuild: (partIds) => {
      const result = applyStartBuild(get().game, partIds);
      if (!result.ok) {
        notifyFailure(result.failure);
        return false;
      }
      set({ game: result.state, dirty: true });
      if (result.build.status === "ready") {
        notify("toast.buildReady", { n: result.build.id });
      } else {
        notify("toast.buildStarted", { hours: result.hours });
      }
      return true;
    },

    placeBuild: (buildId, slot) => {
      const result = applySetBuildSlot(get().game, buildId, slot);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
    },

    setCooling: (coolingId) => {
      const { settings } = get();
      const result = applySetCooling(get().game, coolingId);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      if (result.cost > 0) {
        notify("toast.coolingBought", {
          cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
        });
      } else {
        notify("toast.coolingChanged");
      }
    },

    setInternetPlan: (planId) => {
      const result = applySetInternetPlan(get().game, planId);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.planChanged");
    },

    buyInsulation: () => {
      const { settings } = get();
      const result = applyBuyInsulation(get().game);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.insulationBought", {
        cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
      });
    },

    buyUps: () => {
      const { settings } = get();
      const result = applyBuyUps(get().game);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.upsBought", {
        cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
      });
    },

    buyStabilizer: () => {
      const { settings } = get();
      const result = applyBuyStabilizer(get().game);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.stabilizerBought", {
        cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
      });
    },

    moveLocation: (locationId) => {
      const result = applyMoveLocation(get().game, locationId);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.locationMoved", undefined, "info");
    },

    hireStaff: (roleId) => {
      const { settings } = get();
      const result = applyHireStaff(get().game, roleId);
      if (!result.ok) {
        notifyStaffFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.staffHired", {
        cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
      });
    },

    fireStaff: (employeeId) => {
      const { settings } = get();
      const result = applyFireStaff(get().game, employeeId);
      if (!result.ok) {
        notifyStaffFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.staffFired", {
        cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
      });
    },

    startResearch: (id) => {
      const { settings } = get();
      const result = applyStartResearch(get().game, id as never);
      if (!result.ok) {
        notifyResearchFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.researchStarted", {
        cost: formatMoney(result.cost, settings.game.language, settings.game.numberFormat),
      });
    },

    cancelResearch: (id) => {
      const { settings } = get();
      const result = applyCancelResearch(get().game, id as never);
      if (!result.ok) {
        notifyResearchFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.researchCancelled", {
        refund: formatMoney(result.refund, settings.game.language, settings.game.numberFormat),
      });
    },

    resetBreaker: () => {
      const result = applyResetBreaker(get().game);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.breakerReset");
    },

    restartServers: () => {
      const result = applyRestartServers(get().game);
      if (!result.ok) {
        notifyLocationFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.serversRestarted");
    },

    setServicePrice: (serviceId, priceMult) => {
      const result = applySetServicePrice(get().game, serviceId, priceMult);
      if (!result.ok) {
        notifyServiceFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.servicePrice");
    },

    toggleService: (serviceId) => {
      const result = applyToggleService(get().game, serviceId);
      if (!result.ok) {
        notifyServiceFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.serviceToggled");
    },

    setServiceLimit: (serviceId, limit) => {
      const result = applySetServiceLimit(get().game, serviceId, limit);
      if (!result.ok) {
        notifyServiceFailure(result.failure);
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.serviceLimit");
    },

    resolveTickets: () => {
      const result = applyResolveTickets(get().game);
      if (!result.ok) {
        notify("toast.nothingToResolve", undefined, "warn");
        return;
      }
      set({ game: result.state, dirty: true });
      notify("toast.ticketsResolved", { count: result.resolved });
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
      if (screen !== "game" || overlay !== null || game.gameOver || game.time.paused || game.time.speed === 0) {
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

      if (
        !result.state.gameOver &&
        settings.game.autosave === "month" &&
        result.events.some((event) => event.kind === "monthClosed")
      ) {
        void autosave();
      }
      if (!result.state.gameOver && settings.game.autosave === "5min") {
        autosaveClockMs += frameMs;
        if (autosaveClockMs >= AUTOSAVE_INTERVAL_MS) {
          autosaveClockMs = 0;
          void autosave();
        }
      }

      const bill = result.events.find((event) => event.kind === "billPaid");
      if (bill) {
        notify("toast.bill", {
          amount: formatMoney(-(bill.amount ?? 0), settings.game.language, settings.game.numberFormat),
        });
      }

      const arrived = result.events.find((event) => event.kind === "orderArrived");
      if (arrived) {
        notify("toast.orderArrived", {
          total: formatMoney(arrived.amount ?? 0, settings.game.language, settings.game.numberFormat),
        });
      }

      const built = result.events.find((event) => event.kind === "buildCompleted");
      if (built) {
        notify("toast.buildCompleted", {
          total: formatMoney(built.amount ?? 0, settings.game.language, settings.game.numberFormat),
        });
      }

      const failed = result.events.find((event) => event.kind === "partFailed");
      if (failed) {
        const component = failed.ref ? findComponent(failed.ref) : undefined;
        notify("toast.partFailed", { part: component?.name ?? "—" }, "warn");
      }

      const tripped = result.events.find((event) => event.kind === "breakerTripped");
      if (tripped) {
        notify("toast.breakerTripped", { load: Math.round(tripped.amount ?? 0) }, "error");
      }

      const shutdown = result.events.find((event) => event.kind === "serversShutdown");
      if (shutdown) {
        notify("toast.serversShutdown", { temp: (shutdown.amount ?? 0).toFixed(1) }, "error");
      }

      const complaint = result.events.find((event) => event.kind === "noiseComplaint");
      if (complaint) {
        notify("toast.noiseComplaint", { db: (complaint.amount ?? 0).toFixed(1) }, "warn");
      }

      const fine = result.events.find((event) => event.kind === "noiseFine");
      if (fine) {
        notify(
          "toast.noiseFine",
          { amount: formatMoney(fine.amount ?? 0, settings.game.language, settings.game.numberFormat) },
          "error",
        );
      }

      const neighbors = result.events.find((event) => event.kind === "neighborsShutdown");
      if (neighbors) {
        notify("toast.neighborsShutdown", undefined, "error");
      }

      const joined = result.events.find((event) => event.kind === "clientsJoined");
      if (joined) {
        notify("toast.clientsJoined", { count: Math.round(joined.amount ?? 0) });
      }

      const left = result.events.find((event) => event.kind === "clientsLeft");
      if (left) {
        notify("toast.clientsLeft", { count: Math.round(left.amount ?? 0) }, "warn");
      }

      const reputationChanged = result.events.find(
        (event) => event.kind === "reputationChanged",
      );
      if (reputationChanged) {
        const value = Math.round((reputationChanged.amount ?? 0) * 100) / 100;
        const key =
          value > game.reputation.value ? "toast.reputationUp" : "toast.reputationDown";
        notify(key, { value: value.toFixed(2) }, value > game.reputation.value ? "info" : "warn");
      }

      const review = result.events.find((event) => event.kind === "reviewPosted");
      if (review) {
        notify("toast.reviewPosted", { value: (review.amount ?? 0).toFixed(1) });
      }

      const worldToastMap: Record<string, { key: string; kind: ToastKind }> = {
        blackoutStarted: { key: "toast.blackoutStarted", kind: "error" },
        voltageSpike: { key: "toast.voltageSpike", kind: "error" },
        ddosStarted: { key: "toast.ddosStarted", kind: "error" },
        channelFailureStarted: { key: "toast.channelFailureStarted", kind: "error" },
        clientHacked: { key: "toast.clientHacked", kind: "warn" },
        electricityPriceSpiked: { key: "toast.electricityPriceSpiked", kind: "warn" },
        blackoutPrevented: { key: "toast.blackoutPrevented", kind: "info" },
        spikePrevented: { key: "toast.spikePrevented", kind: "info" },
        staffPromoted: { key: "toast.staffPromoted", kind: "info" },
        researchCompleted: { key: "toast.researchCompleted", kind: "info" },
      };
      for (const [kind, toast] of Object.entries(worldToastMap)) {
        if (result.events.some((event) => event.kind === kind)) {
          notify(toast.key, undefined, toast.kind);
        }
      }

      if (result.state.gameOver && !game.gameOver) {
        frameAccumulatorMs = 0;
        set({ overlay: "gameOver", returnTo: null });
      }
    },

    setPerf: (patch) => set({ perf: { ...get().perf, ...patch } }),
    toggleDebug: () => set({ debugVisible: !get().debugVisible }),
  };
});

/** Для тестов и не-React кода. */
export const gameStore = useGameStore;
