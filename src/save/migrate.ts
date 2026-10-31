import { GAME_SPEEDS, DIFFICULTY_IDS, economy as economyData, type DifficultyId } from "../data";
import { DEFAULT_COMPANY_NAME, GAME_STATE_VERSION, createEconomy, createRng } from "../sim";
import type { EconomyState, ExpenseBreakdown, GameState, MonthlyReport, SimEvent } from "../sim";
import { SAVE_FORMAT, type SaveEnvelope, type SaveMeta, type SaveSlotId } from "./types";

/** Ошибка чтения сохранения: показывается игроку понятным текстом. */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asDifficulty(value: unknown): DifficultyId {
  return typeof value === "string" && (DIFFICULTY_IDS as readonly string[]).includes(value)
    ? (value as DifficultyId)
    : "normal";
}

const EVENT_KINDS: readonly SimEvent["kind"][] = [
  "dayStarted",
  "monthClosed",
  "yearClosed",
  "billPaid",
  "electricityPriceChanged",
  "moneyLow",
  "bankrupted",
];

function asEvents(value: unknown): SimEvent[] {
  if (!Array.isArray(value)) return [];
  const events: SimEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const kind = item.kind;
    if (typeof kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(kind)) continue;
    const event: SimEvent = {
      id: asNumber(item.id, 0),
      kind: kind as SimEvent["kind"],
      hour: Math.max(0, Math.floor(asNumber(item.hour, 0))),
    };
    if (typeof item.amount === "number" && Number.isFinite(item.amount)) event.amount = item.amount;
    events.push(event);
  }
  return events;
}

function asExpenses(value: unknown): ExpenseBreakdown {
  const source = isRecord(value) ? value : {};
  return {
    electricity: Math.max(0, asNumber(source.electricity, 0)),
    internet: Math.max(0, asNumber(source.internet, 0)),
    rent: Math.max(0, asNumber(source.rent, 0)),
  };
}

function asReport(value: unknown): MonthlyReport | null {
  if (!isRecord(value)) return null;
  const expenses = asExpenses(value.expenses);
  const totalExpenses = Math.max(0, asNumber(value.totalExpenses, expenses.electricity + expenses.internet + expenses.rent));
  const revenue = asNumber(value.revenue, 0);
  return {
    hour: Math.max(0, Math.floor(asNumber(value.hour, 0))),
    year: Math.max(1, Math.floor(asNumber(value.year, 1))),
    month: Math.min(12, Math.max(1, Math.floor(asNumber(value.month, 1)))),
    revenue,
    expenses,
    totalExpenses,
    net: asNumber(value.net, revenue - totalExpenses),
    moneyAfter: asNumber(value.moneyAfter, 0),
  };
}

function asEconomy(value: unknown): EconomyState {
  if (!isRecord(value)) return createEconomy();

  const reports = Array.isArray(value.reports)
    ? value.reports
        .map(asReport)
        .filter((report): report is MonthlyReport => report !== null)
        .slice(-economyData.reports.historySize)
    : [];

  const lifetime = isRecord(value.lifetime) ? value.lifetime : {};
  const { priceMinMult, priceMaxMult } = economyData.electricity;
  const priceMult = asNumber(value.electricityPriceMult, 1);

  return {
    accrual: asExpenses(value.accrual),
    reports,
    lifetime: {
      revenue: asNumber(lifetime.revenue, 0),
      expenses: Math.max(0, asNumber(lifetime.expenses, 0)),
    },
    electricityPriceMult: Math.min(priceMaxMult, Math.max(priceMinMult, priceMult)),
    lowMoneyWarned: value.lowMoneyWarned === true,
  };
}

function asGameOver(value: unknown): GameState["gameOver"] {
  if (!isRecord(value)) return null;
  return {
    hour: Math.max(0, Math.floor(asNumber(value.hour, 0))),
    money: asNumber(value.money, 0),
  };
}

/**
 * Приводит сохранение любой поддерживаемой версии к текущему GameState.
 * Бросает SaveError, если данные не похожи на сохранение игры.
 */
export function migrateGame(raw: unknown): GameState {
  if (!isRecord(raw)) {
    throw new SaveError("Файл сохранения повреждён: ожидался объект.");
  }

  const version = asNumber(raw.version, 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new SaveError("Файл сохранения повреждён: неизвестная версия.");
  }

  const time = isRecord(raw.time) ? raw.time : null;
  if (!time) {
    throw new SaveError("Файл сохранения повреждён: нет игрового времени.");
  }

  const hour = asNumber(time.hour, Number.NaN);
  if (!Number.isFinite(hour) || hour < 0) {
    throw new SaveError("Файл сохранения повреждён: некорректный игровой час.");
  }

  const rawSpeed = asNumber(time.speed, 1);
  const speed = (GAME_SPEEDS as readonly number[]).includes(rawSpeed) ? rawSpeed : 1;
  const rawRng = isRecord(raw.rng) ? raw.rng : null;

  const game: GameState = {
    version: GAME_STATE_VERSION,
    seed: asNumber(raw.seed, 0) >>> 0,
    rng: rawRng
      ? { seed: asNumber(rawRng.seed, 0) >>> 0, s: asNumber(rawRng.s, 0) >>> 0 }
      : createRng(asNumber(raw.seed, 0)),
    time: {
      hour: Math.floor(hour),
      speed: speed as GameState["time"]["speed"],
      paused: time.paused !== false,
    },
    money: asNumber(raw.money, 0),
    companyName: typeof raw.companyName === "string" && raw.companyName.trim() ? raw.companyName : DEFAULT_COMPANY_NAME,
    difficulty: asDifficulty(raw.difficulty),
    economy: asEconomy(raw.economy),
    gameOver: asGameOver(raw.gameOver),
    stats: { ticks: Math.max(0, Math.floor(isRecord(raw.stats) ? asNumber(raw.stats.ticks, 0) : 0)) },
    events: asEvents(raw.events),
    nextEventId: Math.max(1, Math.floor(asNumber(raw.nextEventId, 1))),
  };

  // Миграция 1 → 2: появились название компании и режим сложности.
  if (version < 2) {
    game.difficulty = "normal";
    game.companyName = DEFAULT_COMPANY_NAME;
  }

  return game;
}

export interface ParsedSave {
  meta: SaveMeta | null;
  game: GameState;
  /** Версия, с которой пришлось мигрировать (если отличается от текущей). */
  migratedFrom: number | null;
}

/** Принимает и конверт, и «голый» GameState (старые сейвы). */
export function parseSave(raw: unknown, fallbackSlot: SaveSlotId = "slot1"): ParsedSave {
  const isEnvelope = isRecord(raw) && raw.format === SAVE_FORMAT && isRecord(raw.game);
  const gameRaw = isEnvelope && isRecord(raw) ? raw.game : raw;

  const game = migrateGame(gameRaw);
  const metaRaw = isEnvelope && isRecord(raw) && isRecord(raw.meta) ? raw.meta : null;
  const meta: SaveMeta | null = metaRaw
    ? {
        slot: (typeof metaRaw.slot === "string" ? metaRaw.slot : fallbackSlot) as SaveSlotId,
        companyName: typeof metaRaw.companyName === "string" ? metaRaw.companyName : game.companyName,
        difficulty: asDifficulty(metaRaw.difficulty),
        day: asNumber(metaRaw.day, 0),
        year: asNumber(metaRaw.year, 1),
        month: asNumber(metaRaw.month, 1),
        dayOfMonth: asNumber(metaRaw.dayOfMonth, 1),
        hourOfDay: asNumber(metaRaw.hourOfDay, 0),
        money: asNumber(metaRaw.money, game.money),
        savedAt: typeof metaRaw.savedAt === "string" ? metaRaw.savedAt : new Date(0).toISOString(),
        saveVersion: asNumber(metaRaw.saveVersion, 1),
        gameVersion: typeof metaRaw.gameVersion === "string" ? metaRaw.gameVersion : "0.0.0",
      }
    : null;

  const migratedFrom = (isRecord(gameRaw) && typeof gameRaw.version === "number" ? gameRaw.version : GAME_STATE_VERSION) <
  GAME_STATE_VERSION
    ? asNumber(isRecord(gameRaw) ? gameRaw.version : 1, 1)
    : null;

  return { meta, game, migratedFrom };
}

export function buildEnvelope(meta: SaveMeta, game: GameState): SaveEnvelope {
  return { format: SAVE_FORMAT, version: GAME_STATE_VERSION, meta, game };
}
