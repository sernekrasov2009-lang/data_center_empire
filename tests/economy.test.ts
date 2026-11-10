import { describe, expect, it } from "vitest";
import { economy, getElectricityTariff, getInternetPlan, validateEconomy } from "../src/data";
import {
  HOURS_PER_MONTH,
  HOURS_PER_YEAR,
  advanceTicks,
  bankruptcyStatus,
  cashForecast,
  createGame,
  daysUntilBill,
  hardwareLoadW,
  hourlyElectricityCost,
  projectedMonthlyExpenses,
  projectedMonthlyIncome,
} from "../src/sim";

describe("economy.json", () => {
  it("проходит валидацию", () => {
    expect(validateEconomy(economy)).toEqual([]);
  });

  it("ссылается на существующие тарифы", () => {
    expect(getElectricityTariff(economy.start.electricityTariffId).pricePerKwh).toBeGreaterThan(0);
    expect(getInternetPlan(economy.start.internetPlanId).speedMbit).toBeGreaterThan(0);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(economy);
    broken.electricity.tariffs[0]!.pricePerKwh = 0;
    broken.electricity.pue.home = 0.5;
    broken.internet.defaultPlanId = "nope";
    broken.start.location = "moon" as never;
    broken.bankruptcy.threshold = 10;
    broken.reports.historySize = 1;

    const errors = validateEconomy(broken).join("\n");
    expect(errors).toContain("pricePerKwh");
    expect(errors).toContain("electricity.pue.home");
    expect(errors).toContain("internet.defaultPlanId");
    expect(errors).toContain("start.location");
    expect(errors).toContain("bankruptcy.threshold");
    expect(errors).toContain("reports.historySize");
  });
});

describe("электричество и счета", () => {
  it("считает почасовую стоимость через PUE", () => {
    const state = createGame();
    const pue = economy.electricity.pue[state.location.id as keyof typeof economy.electricity.pue];
    const price = getElectricityTariff(economy.start.electricityTariffId).pricePerKwh;
    const expected = (hardwareLoadW(state) / 1000) * pue * price;
    expect(hourlyElectricityCost(state, 1)).toBeCloseTo(expected, 10);
  });

  it("строит прогноз полного месячного счёта", () => {
    const state = createGame();
    const internet = getInternetPlan(state.location.internetPlanId).pricePerMonth;
    const projected = projectedMonthlyExpenses(state);
    expect(projected.electricity).toBeCloseTo(hourlyElectricityCost(state, 1) * HOURS_PER_MONTH, 10);
    expect(projected.internet).toBe(internet);
    expect(projected.rent).toBe(0);
    expect(projected.total).toBeCloseTo(projected.electricity + internet, 10);
  });

  it("колит электричество по часам, не трогая деньги до счёта", () => {
    const state = createGame();
    const result = advanceTicks(state, 10);
    expect(result.state.money).toBe(state.money);
    expect(result.state.economy.accrual.electricity).toBeCloseTo(
      hourlyElectricityCost(state) * 10,
      10,
    );
    expect(result.state.economy.reports).toHaveLength(0);
  });

  it("выставляет счёт в конце месяца и пишет отчёт", () => {
    const state = createGame();
    const result = advanceTicks(state, HOURS_PER_MONTH);
    const projected = projectedMonthlyExpenses(state);
    const report = result.state.economy.reports.at(-1)!;

    expect(result.state.money).toBeCloseTo(state.money - projected.total, 8);
    expect(report).toMatchObject({ year: 1, month: 1, revenue: 0 });
    expect(report.totalExpenses).toBeCloseTo(projected.total, 8);
    expect(report.net).toBeCloseTo(-projected.total, 8);
    expect(report.moneyAfter).toBeCloseTo(result.state.money, 8);
    expect(result.state.economy.accrual).toEqual({ electricity: 0, internet: 0, rent: 0 });
    expect(result.state.economy.lifetime.expenses).toBeCloseTo(projected.total, 8);
  });

  it("держит историю отчётов в заданном размере", () => {
    const result = advanceTicks(createGame({ money: 100_000 }), HOURS_PER_MONTH * 26);
    expect(result.state.economy.reports).toHaveLength(economy.reports.historySize);
    expect(result.state.economy.reports.at(-1)!.month).toBe(2);
    expect(result.state.economy.reports.at(-1)!.year).toBe(3);
  });

  it("прогнозирует уменьшение денег на каждый месяц", () => {
    const state = createGame({ money: 1000 });
    const bill = projectedMonthlyExpenses(state).total;
    const income = projectedMonthlyIncome(state);
    const forecast = cashForecast(state);
    expect(forecast).toHaveLength(3);
    forecast.forEach((row) => {
      expect(row.money).toBeCloseTo(1000 + (income - bill) * row.month, 8);
    });
  });

  it("считает дни до следующего счёта", () => {
    expect(daysUntilBill(0)).toBe(30);
    expect(daysUntilBill(HOURS_PER_MONTH - 24)).toBe(1);
    expect(daysUntilBill(HOURS_PER_MONTH - 1)).toBe(1);
    expect(daysUntilBill(HOURS_PER_MONTH)).toBe(30);
  });
});

describe("события экономики и банкротство", () => {
  it("присылает счёт и предупреждение о минусе один раз", () => {
    const result = advanceTicks(createGame({ money: 0 }), HOURS_PER_MONTH * 2);
    const kinds = result.events.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "billPaid")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "moneyLow")).toHaveLength(1);
    expect(result.state.economy.lowMoneyWarned).toBe(true);
  });

  it("меняет тариф раз в год в пределах ±20%", () => {
    const result = advanceTicks(createGame({ seed: 5 }), HOURS_PER_YEAR);
    const priceEvents = result.events.filter((event) => event.kind === "electricityPriceChanged");
    expect(priceEvents).toHaveLength(1);
    expect(priceEvents[0]!.hour).toBe(HOURS_PER_YEAR);
    expect(result.state.economy.electricityPriceMult).toBeGreaterThanOrEqual(
      economy.electricity.priceMinMult,
    );
    expect(result.state.economy.electricityPriceMult).toBeLessThanOrEqual(
      economy.electricity.priceMaxMult,
    );
    expect(priceEvents[0]!.amount).toBeCloseTo(
      getElectricityTariff(economy.start.electricityTariffId).pricePerKwh *
        result.state.economy.electricityPriceMult,
      3,
    );
  });

  it("закрывает декабрь счётом и только потом меняет тариф", () => {
    const result = advanceTicks(createGame({ money: 100_000 }), HOURS_PER_YEAR);
    const tail = result.state.events.slice(-6).map((event) => event.kind);
    expect(tail).toEqual([
      "monthClosed",
      "billPaid",
      "marketPriceChanged",
      "yearClosed",
      "electricityPriceChanged",
      "dayStarted",
    ]);
    expect(result.events.filter((event) => event.kind === "monthClosed")).toHaveLength(12);
  });

  it("на сложной сложности заканчивает игру ниже порога", () => {
    const state = createGame({
      difficulty: "hard",
      money: economy.bankruptcy.threshold + 10,
    });
    const result = advanceTicks(state, HOURS_PER_MONTH);

    expect(result.state.gameOver).not.toBeNull();
    expect(result.state.gameOver?.money).toBeLessThan(economy.bankruptcy.threshold);
    expect(result.state.time.paused).toBe(true);
    expect(bankruptcyStatus(result.state)).toBe("over");
    expect(result.state.events.some((event) => event.kind === "bankrupted")).toBe(true);

    const frozen = advanceTicks(result.state, 100);
    expect(frozen.ticks).toBe(0);
    expect(frozen.state).toBe(result.state);
  });

  it("на спокойной сложности только предупреждает", () => {
    const result = advanceTicks(
      createGame({ difficulty: "calm", money: economy.bankruptcy.threshold - 100 }),
      HOURS_PER_MONTH,
    );
    expect(result.state.gameOver).toBeNull();
    expect(bankruptcyStatus(result.state)).toBe("warning");
    expect(result.state.events.some((event) => event.kind === "bankrupted")).toBe(false);
  });

  it("в песочнице не заканчивает игру", () => {
    const result = advanceTicks(
      createGame({ difficulty: "sandbox", money: economy.bankruptcy.threshold - 100 }),
      HOURS_PER_MONTH,
    );
    expect(result.state.gameOver).toBeNull();
    expect(bankruptcyStatus(result.state)).toBe("ok");
  });
});
