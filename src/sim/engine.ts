import { balance, difficulties, economy as economyData, getDifficulty, type DifficultyId } from "../data";
import { createRng } from "./core/rng";
import { HOURS_PER_DAY, HOURS_PER_MONTH, HOURS_PER_YEAR } from "./core/time";
import { accrueHour, billMonth, createEconomy, driftElectricityPrice } from "./economy";
import { createHardware, driftMarketPrice, refreshUsedMarket, tickHardware } from "./hardware";
import { cloneLocation, createLocation, tickLocation } from "./location";
import type { GameState, SimEvent, Speed } from "./types";

/** Версия структуры GameState. Меняется при миграциях сохранений. */
export const GAME_STATE_VERSION = 5;

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

  const game: GameState = {
    version: GAME_STATE_VERSION,
    seed,
    rng: createRng(seed),
    time: { hour: 0, speed: 1, paused: true },
    money,
    companyName: (options.companyName ?? DEFAULT_COMPANY_NAME).trim() || DEFAULT_COMPANY_NAME,
    difficulty,
    economy: createEconomy(),
    hardware: createHardware(),
    location: createLocation(),
    gameOver: null,
    stats: { ticks: 0 },
    events: [],
    nextEventId: 1,
  };

  // Стартовый б/у рынок формируется сразу, чтобы магазин был непустым на паузе.
  return refreshUsedMarket(game, true).state;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function pushEvent(
  state: GameState,
  events: SimEvent[],
  kind: SimEvent["kind"],
  hour: number,
  amount?: number,
  ref?: string,
): void {
  const event: SimEvent = { id: state.nextEventId, kind, hour };
  if (amount !== undefined) event.amount = amount;
  if (ref !== undefined) event.ref = ref;
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
  if (count === 0 || state.gameOver) {
    return { state, events: [], ticks: 0 };
  }

  let next: GameState = {
    ...state,
    rng: { ...state.rng },
    time: { ...state.time },
    stats: { ...state.stats },
    economy: {
      ...state.economy,
      accrual: { ...state.economy.accrual },
      reports: state.economy.reports.slice(),
      lifetime: { ...state.economy.lifetime },
    },
    location: cloneLocation(state.location),
    events: state.events.slice(),
  };

  const events: SimEvent[] = [];
  const bankruptcyMode = getDifficulty(next.difficulty).bankruptcy;
  let advanced = 0;

  for (let i = 0; i < count; i += 1) {
    next.time.hour += 1;
    next.stats.ticks += 1;
    advanced += 1;
    next = accrueHour(next);

    const hardwareTick = tickHardware(next);
    next = hardwareTick.state;
    for (const event of hardwareTick.events) {
      pushEvent(next, events, event.kind, next.time.hour, event.amount, event.ref);
    }

    const locationTick = tickLocation(next);
    next = locationTick.state;
    for (const event of locationTick.events) {
      pushEvent(next, events, event.kind, next.time.hour, event.amount, event.ref);
    }

    const hour = next.time.hour;
    const monthClosed = hour % HOURS_PER_MONTH === 0;

    if (monthClosed) {
      const bill = billMonth(next, hour);
      next = bill.state;
      pushEvent(next, events, "monthClosed", hour);
      pushEvent(next, events, "billPaid", hour, roundMoney(bill.report.totalExpenses));

      const market = driftMarketPrice(next);
      next = market.state;
      pushEvent(next, events, "marketPriceChanged", hour, market.mult);

      if (bill.lowMoney) {
        pushEvent(next, events, "moneyLow", hour, roundMoney(next.money));
      }
      if (bankruptcyMode === "gameover" && next.money < economyData.bankruptcy.threshold) {
        next.gameOver = { hour, money: next.money };
        next.time = { ...next.time, paused: true };
        pushEvent(next, events, "bankrupted", hour, roundMoney(next.money));
      }
    }

    if (hour % HOURS_PER_YEAR === 0) {
      pushEvent(next, events, "yearClosed", hour);
      if (!next.gameOver) {
        const drift = driftElectricityPrice(next);
        next = drift.state;
        pushEvent(next, events, "electricityPriceChanged", hour, roundMoney(drift.pricePerKwh * 1000) / 1000);
      }
    }

    if (hour % HOURS_PER_DAY === 0) {
      pushEvent(next, events, "dayStarted", hour);
    }

    if (next.gameOver) break;
  }

  return { state: next, events, ticks: advanced };
}

export function setSpeed(state: GameState, speed: Speed): GameState {
  return {
    ...state,
    time: { ...state.time, speed, paused: speed === 0 },
  };
}

export function togglePause(state: GameState): GameState {
  if (state.time.speed === 0 || state.gameOver) return state;
  return {
    ...state,
    time: { ...state.time, paused: !state.time.paused },
  };
}

export function setPaused(state: GameState, paused: boolean): GameState {
  if (state.time.paused === paused) return state;
  if (paused === false && state.gameOver) return state;
  return { ...state, time: { ...state.time, paused } };
}

export function renameCompany(state: GameState, companyName: string): GameState {
  const trimmed = companyName.trim();
  if (!trimmed) return state;
  return { ...state, companyName: trimmed };
}
