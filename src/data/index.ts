import rawBalance from "./balance.json";

/** Скорости игры. 0 — пауза (DESIGN.md, разд. 1). */
export type Speed = 0 | 1 | 5 | 20 | 60;

export interface BalanceTime {
  /** Сколько игровых часов проходит за 1 реальную секунду на скорости ×1. */
  hoursPerRealSecond: number;
  hoursPerDay: number;
  daysPerMonth: number;
  /** Доступные множители скорости, без паузы. */
  speeds: number[];
}

export interface BalanceStart {
  money: number;
  seed: number;
}

export interface BalanceLimits {
  /** Предохранитель: сколько тиков максимум считать за один кадр. */
  maxTicksPerFrame: number;
  /** Кадр длиннее этого значения обрезается (сон ОС, перетаскивание окна). */
  maxFrameMs: number;
  eventLogSize: number;
}

export interface BalanceFile {
  version: number;
  time: BalanceTime;
  start: BalanceStart;
  limits: BalanceLimits;
}

export const balance = rawBalance as BalanceFile;

export const GAME_SPEEDS: readonly Exclude<Speed, 0>[] = [1, 5, 20, 60];

/**
 * Проверка данных баланса. Возвращает список ошибок, пустой список — данные валидны.
 * Используется тестом, чтобы правки JSON не ломали симуляцию молча.
 */
export function validateBalance(data: BalanceFile): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }

  const { time } = data;
  if (!(time.hoursPerRealSecond > 0)) {
    errors.push("time.hoursPerRealSecond: должно быть > 0");
  }
  if (time.hoursPerDay !== 24) {
    errors.push("time.hoursPerDay: по дизайну всегда 24");
  }
  if (time.daysPerMonth !== 30) {
    errors.push("time.daysPerMonth: по дизайну всегда 30");
  }
  const speeds = [...time.speeds].sort((a, b) => a - b);
  if (speeds.join(",") !== GAME_SPEEDS.join(",")) {
    errors.push(`time.speeds: ожидается [${GAME_SPEEDS.join(", ")}], получено [${speeds.join(", ")}]`);
  }

  if (!Number.isFinite(data.start.money) || data.start.money <= 0) {
    errors.push("start.money: должно быть > 0");
  }
  if (!Number.isInteger(data.start.seed) || data.start.seed < 0) {
    errors.push("start.seed: ожидается целое неотрицательное число");
  }

  const { limits } = data;
  if (!Number.isInteger(limits.maxTicksPerFrame) || limits.maxTicksPerFrame < 24) {
    errors.push("limits.maxTicksPerFrame: ожидается целое ≥ 24 (сутки на скорости ×60)");
  }
  if (!(limits.maxFrameMs > 0) || limits.maxFrameMs > 1000) {
    errors.push("limits.maxFrameMs: ожидается 0 < ms ≤ 1000");
  }
  if (!Number.isInteger(limits.eventLogSize) || limits.eventLogSize < 10) {
    errors.push("limits.eventLogSize: ожидается целое ≥ 10");
  }

  return errors;
}
