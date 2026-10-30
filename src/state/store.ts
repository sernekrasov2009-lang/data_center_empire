import { create } from "zustand";
import { balance } from "../data";
import type { Language } from "../i18n";
import { LANGUAGES } from "../i18n";
import {
  advanceTicks,
  createGame,
  setSpeed as applySpeed,
  togglePause as applyTogglePause,
  type GameState,
  type SimEvent,
  type Speed,
} from "../sim";

const LANGUAGE_STORAGE_KEY = "uptime.language";

export interface PerfStats {
  fps: number;
  /** Длительность последнего шага симуляции, мс. */
  simMs: number;
  /** Сглаженное среднее времени шага, мс. */
  simMsAvg: number;
  ticksPerSecond: number;
}

interface GameStore {
  game: GameState;
  /** Лента событий, новые сверху. */
  events: SimEvent[];
  language: Language;
  debugVisible: boolean;
  perf: PerfStats;
  newGame: () => void;
  advance: (realMs: number) => void;
  setSpeed: (speed: Speed) => void;
  togglePause: () => void;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  toggleDebug: () => void;
  setPerf: (patch: Partial<PerfStats>) => void;
}

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && LANGUAGES.includes(stored as Language)) return stored as Language;
  } catch {
    // localStorage может быть недоступен (жёсткая политика приватности) — работаем на русском.
  }
  return "ru";
}

function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Не критично: язык просто не запомнится.
  }
}

/**
 * Аккумулятор реального времени между кадрами. Живёт вне состояния игры:
 * это часть цикла отрисовки, а не сериализуемая модель.
 */
let frameAccumulatorMs = 0;
let ticksPerSecondAvg = 0;

const initialPerf: PerfStats = { fps: 0, simMs: 0, simMsAvg: 0, ticksPerSecond: 0 };

export const useGameStore = create<GameStore>((set, get) => ({
  game: createGame(),
  events: [],
  language: readStoredLanguage(),
  debugVisible: false,
  perf: initialPerf,

  newGame: () => {
    frameAccumulatorMs = 0;
    ticksPerSecondAvg = 0;
    set({ game: createGame(), events: [], perf: initialPerf });
  },

  advance: (realMs: number) => {
    const { game } = get();
    if (game.time.paused || game.time.speed === 0) {
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
      perf: {
        ...perf,
        simMs: elapsed,
        simMsAvg: perf.simMsAvg === 0 ? elapsed : perf.simMsAvg * 0.9 + elapsed * 0.1,
        ticksPerSecond: ticksPerSecondAvg,
      },
    });
  },

  setSpeed: (speed: Speed) => {
    frameAccumulatorMs = 0;
    set({ game: applySpeed(get().game, speed) });
  },

  togglePause: () => {
    frameAccumulatorMs = 0;
    set({ game: applyTogglePause(get().game) });
  },

  setLanguage: (language: Language) => {
    storeLanguage(language);
    set({ language });
  },

  toggleLanguage: () => {
    const next: Language = get().language === "ru" ? "en" : "ru";
    storeLanguage(next);
    set({ language: next });
  },

  toggleDebug: () => set({ debugVisible: !get().debugVisible }),

  setPerf: (patch: Partial<PerfStats>) => set({ perf: { ...get().perf, ...patch } }),
}));

/** Для оверлея F3 и тестов: доступ к состоянию без React-хука. */
export const gameStore = useGameStore;
