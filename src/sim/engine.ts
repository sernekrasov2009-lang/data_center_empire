import { balance, difficulties, getDifficulty, type DifficultyId } from "../data";
import { createRng } from "./core/rng";
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR } from "./core/time";
import type { GameState, SimEvent, Speed } from "./types";

/** Версия структуры GameState. Меняется при миграциях сохранений. */
export const GAME_STATE_VERSION = 2;

export const DEFAULT_COMPANY_NAME = "Uptime Hosting";

export interface NewGameOptions {
  seed?: number;
  money?: number;
  difficulty?: DifficultyId;
  companyName?: string;
}

export interface AdvanceResult {
  state: GameState;
  /** События, произошедшие за этот вызов (в хронологическом порядке). */
  events: SimEvent[];
  ticks: number;
}

export function createGame(options: NewGameOptions = {}): GameState {
  const difficulty = options.difficulty ?? difficulties.defaultMode;
  const seed = options.seed ?? balance.start.seed;
  const money = options.money ?? getDifficulty(difficulty).startMoney;

  return {
    version: GAME_STATE_VERSION,
    seed,
    rng: createRng(seed),
    time: { hour: 0, speed: 1, paused: true },
    money,
    companyName: (options.companyName ?? DEFAULT_COMPANY_NAME).trim() || DEFAULT_COMPANY_NAME,
    difficulty,
    stats: { ticks: 0 },
    events: [],
    nextEventId: 1,
  };
}

function pushEvent(state: GameState, events: SimEvent[], kind: SimEvent["kind"], hour: number): void {
  const event: SimEvent = { id: state.nextEventId, kind, hour };
  state.nextEventId += 1;
  events.push(event);
  state.events.push(event);
  if (state.events.length > balance.limits.eventLogSize) {
    state.events.splice(0, state.events.length - balance.limits.eventLogSize);
  }
}

/**
 * Продвигает симуляцию на заданное число тиков (1 тик = 1 игровой час).
 * Возвращает новое состояние: исходное не мутируется.
 */
export function advanceTicks(state: GameState, ticks: number): AdvanceResult {
  const count = Math.max(0, Math.floor(ticks));
  if (count === 0) {
    return { state, events: [], ticks: 0 };
  }

  const next: GameState = {
    ...state,
    rng: { ...state.rng },
    time: { ...state.time },
    stats: { ...state.stats },
    events: state.events.slice(),
  };

  const events: SimEvent[] = [];

  for (let i = 0; i < count; i += 1) {
    next.time.hour += 1;
    next.stats.ticks += 1;

    const hour = next.time.hour;
    if (hour % HOURS_PER_YEAR === 0) {
      pushEvent(next, events, "yearClosed", hour);
    } else if (hour % HOURS_PER_MONTH === 0) {
      pushEvent(next, events, "monthClosed", hour);
    }
    if (hour % HOURS_PER_DAY === 0) {
      pushEvent(next, events, "dayStarted", hour);
    }
  }

  return { state: next, events, ticks: count };
}

export function setSpeed(state: GameState, speed: Speed): GameState {
  return {
    ...state,
    time: { ...state.time, speed, paused: speed === 0 },
  };
}

export function togglePause(state: GameState): GameState {
  if (state.time.speed === 0) return state;
  return {
    ...state,
    time: { ...state.time, paused: !state.time.paused },
  };
}

export function setPaused(state: GameState, paused: boolean): GameState {
  if (state.time.paused === paused) return state;
  return { ...state, time: { ...state.time, paused } };
}

export function renameCompany(state: GameState, companyName: string): GameState {
  const trimmed = companyName.trim();
  if (!trimmed) return state;
  return { ...state, companyName: trimmed };
}
