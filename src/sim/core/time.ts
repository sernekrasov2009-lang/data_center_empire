import { balance } from "../../data";
import type { GameDate } from "../types";

export const HOURS_PER_DAY = balance.time.hoursPerDay;
export const DAYS_PER_MONTH = balance.time.daysPerMonth;
export const HOURS_PER_MONTH = HOURS_PER_DAY * DAYS_PER_MONTH;
export const HOURS_PER_YEAR = HOURS_PER_MONTH * 12;

/** Игровых часов за одну реальную секунду при данной скорости. */
export function hoursPerRealSecond(speed: number): number {
  return balance.time.hoursPerRealSecond * speed;
}

/** Реальных миллисекунд на один игровой час при данной скорости. */
export function realMsPerHour(speed: number): number {
  const hoursPerSecond = hoursPerRealSecond(speed);
  if (hoursPerSecond <= 0) return Number.POSITIVE_INFINITY;
  return 1000 / hoursPerSecond;
}

export function getGameDate(totalHours: number): GameDate {
  const hours = Math.max(0, Math.floor(totalHours));
  const totalDays = Math.floor(hours / HOURS_PER_DAY);
  return {
    totalHours: hours,
    totalDays,
    year: Math.floor(totalDays / (DAYS_PER_MONTH * 12)) + 1,
    month: (Math.floor(totalDays / DAYS_PER_MONTH) % 12) + 1,
    dayOfMonth: (totalDays % DAYS_PER_MONTH) + 1,
    hourOfDay: hours % HOURS_PER_DAY,
  };
}

/** Номер календарных суток игры (с 1). */
export function dayNumber(totalHours: number): number {
  return Math.floor(Math.max(0, totalHours) / HOURS_PER_DAY) + 1;
}
