import { describe, expect, it } from "vitest";
import { dayNumber, DAYS_PER_MONTH, getGameDate, HOURS_PER_DAY } from "../src/sim";

describe("игровой календарь", () => {
  it("стартует с года 1, месяца 1, дня 1, 00:00", () => {
    expect(getGameDate(0)).toEqual({
      totalHours: 0,
      totalDays: 0,
      year: 1,
      month: 1,
      dayOfMonth: 1,
      hourOfDay: 0,
    });
  });

  it("переходит на следующие сутки в 24:00", () => {
    const date = getGameDate(HOURS_PER_DAY);
    expect(date.dayOfMonth).toBe(2);
    expect(date.hourOfDay).toBe(0);
    expect(date.totalDays).toBe(1);
    expect(dayNumber(HOURS_PER_DAY)).toBe(2);
  });

  it("месяц — 30 суток", () => {
    const lastHourOfMonth = DAYS_PER_MONTH * HOURS_PER_DAY - 1;
    expect(getGameDate(lastHourOfMonth)).toMatchObject({ year: 1, month: 1, dayOfMonth: 30, hourOfDay: 23 });
    expect(getGameDate(lastHourOfMonth + 1)).toMatchObject({ year: 1, month: 2, dayOfMonth: 1, hourOfDay: 0 });
  });

  it("год — 12 месяцев", () => {
    const hoursPerYear = DAYS_PER_MONTH * 12 * HOURS_PER_DAY;
    expect(getGameDate(hoursPerYear)).toMatchObject({ year: 2, month: 1, dayOfMonth: 1, hourOfDay: 0 });
  });

  it("не уходит в минус и не выдаёт NaN", () => {
    const date = getGameDate(-100);
    expect(date.totalHours).toBe(0);
    expect(Number.isFinite(date.month)).toBe(true);
  });
});
