import { describe, expect, it } from "vitest";
import { balance, GAME_SPEEDS, validateBalance, type BalanceFile } from "../src/data";
import { hoursPerRealSecond, realMsPerHour } from "../src/sim";

describe("balance.json", () => {
  it("проходит валидацию", () => {
    expect(validateBalance(balance)).toEqual([]);
  });

  it("темпит время по дизайну (DESIGN.md, разд. 1)", () => {
    // ×1: сутки 60 с, месяц 30 мин.
    expect(hoursPerRealSecond(1)).toBeCloseTo(0.4, 10);
    expect((24 / hoursPerRealSecond(1)) * 1000).toBeCloseTo(60_000, 5);
    expect((720 / hoursPerRealSecond(1)) * 1000).toBeCloseTo(1_800_000, 5);
    // ×5: месяц 6 мин.
    expect((720 / hoursPerRealSecond(5)) * 1000).toBeCloseTo(360_000, 5);
    // ×60: сутки 1 с, месяц 30 с.
    expect((24 / hoursPerRealSecond(60)) * 1000).toBeCloseTo(1_000, 5);
    expect((720 / hoursPerRealSecond(60)) * 1000).toBeCloseTo(30_000, 5);
  });

  it("один час на ×1 занимает 2,5 реальных секунды", () => {
    expect(realMsPerHour(1)).toBeCloseTo(2500, 6);
  });

  it("содержит все четыре скорости из дизайна", () => {
    expect([...balance.time.speeds].sort((a, b) => a - b)).toEqual([...GAME_SPEEDS]);
  });

  it("ловит испорченные данные", () => {
    const broken: BalanceFile = {
      ...balance,
      time: { ...balance.time, speeds: [1, 5, 20], hoursPerDay: 12 },
      start: { money: -1, seed: -5 },
      limits: { ...balance.limits, eventLogSize: 0 },
    };
    const errors = validateBalance(broken);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.join("\n")).toContain("time.speeds");
    expect(errors.join("\n")).toContain("start.money");
  });
});
