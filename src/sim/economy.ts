import { economy as economyData, getDifficulty, getElectricityTariff, getInternetPlan, type LocationKind } from "../data";
import { hardwareLoadW } from "./components";
import { nextFloat } from "./core/rng";
import { HOURS_PER_DAY, HOURS_PER_MONTH, getGameDate } from "./core/time";
import type { EconomyState, ExpenseBreakdown, GameState, MonthlyReport } from "./types";

/** Сколько месяцев вперёд считается прогноз денег (DESIGN.md, разд. 12.2). */
export const FORECAST_MONTHS = 3;

export function createEconomy(): EconomyState {
  return {
    accrual: { electricity: 0, internet: 0, rent: 0 },
    reports: [],
    lifetime: { revenue: 0, expenses: 0 },
    electricityPriceMult: 1,
    lowMoneyWarned: false,
  };
}

function startLocation(): LocationKind {
  return economyData.start.location;
}

/** Цена кВт·ч с учётом годового дрейфа. */
export function electricityPricePerKwh(priceMult: number): number {
  return getElectricityTariff(economyData.start.electricityTariffId).pricePerKwh * priceMult;
}

/** Стоимость электричества за один игровой час при множителе цены и нагрузке. */
export function hourlyElectricityCost(priceMult = 1, loadW = economyData.start.itLoadW): number {
  const pue = economyData.electricity.pue[startLocation()];
  return (loadW / 1000) * pue * electricityPricePerKwh(priceMult);
}

/** Полный месяц электричества при текущей цене (для прогноза и подсказок). */
export function monthElectricityCost(priceMult = 1, loadW = economyData.start.itLoadW): number {
  return hourlyElectricityCost(priceMult, loadW) * HOURS_PER_MONTH;
}

/** Постоянные месячные расходы: интернет по тарифу и аренда локации. */
export function fixedMonthlyCosts(): { internet: number; rent: number } {
  const plan = getInternetPlan(economyData.start.internetPlanId);
  return { internet: plan.pricePerMonth, rent: economyData.start.rentPerMonth };
}

/** Итоговый прогноз счёта за полный месяц при заданном множителе цены и нагрузке. */
export function projectedMonthlyExpenses(
  priceMult: number,
  loadW = economyData.start.itLoadW,
): ExpenseBreakdown & { total: number } {
  const fixed = fixedMonthlyCosts();
  const electricity = monthElectricityCost(priceMult, loadW);
  return {
    electricity,
    internet: fixed.internet,
    rent: fixed.rent,
    total: electricity + fixed.internet + fixed.rent,
  };
}

/** Начисляет электричество за один прошедший час по текущей нагрузке железа. */
export function accrueHour(state: GameState): GameState {
  const cost = hourlyElectricityCost(state.economy.electricityPriceMult, hardwareLoadW(state));
  return {
    ...state,
    economy: {
      ...state.economy,
      accrual: {
        ...state.economy.accrual,
        electricity: state.economy.accrual.electricity + cost,
      },
    },
  };
}

export interface BillResult {
  state: GameState;
  report: MonthlyReport;
  /** Только что ушли в минус (предупреждение ещё не показывали). */
  lowMoney: boolean;
}

/**
 * Выставляет счёт за закрытый месяц: электричество из начислений плюс
 * интернет и аренда. Отчёт попадает в историю, начисления обнуляются.
 */
export function billMonth(state: GameState, hour: number): BillResult {
  const fixed = fixedMonthlyCosts();
  const expenses: ExpenseBreakdown = {
    electricity: state.economy.accrual.electricity,
    internet: fixed.internet,
    rent: fixed.rent,
  };
  const totalExpenses = expenses.electricity + expenses.internet + expenses.rent;
  const moneyAfter = state.money - totalExpenses;
  const closed = getGameDate(Math.max(0, hour - 1));
  const report: MonthlyReport = {
    hour,
    year: closed.year,
    month: closed.month,
    revenue: 0,
    expenses,
    totalExpenses,
    net: -totalExpenses,
    moneyAfter,
  };

  const historySize = economyData.reports.historySize;
  const reports = [...state.economy.reports, report].slice(-historySize);
  const lowMoney = moneyAfter < economyData.bankruptcy.warningAt && !state.economy.lowMoneyWarned;

  return {
    state: {
      ...state,
      money: moneyAfter,
      economy: {
        ...state.economy,
        accrual: { electricity: 0, internet: 0, rent: 0 },
        reports,
        lifetime: {
          revenue: state.economy.lifetime.revenue + report.revenue,
          expenses: state.economy.lifetime.expenses + totalExpenses,
        },
        // Вернулись в плюс — предупреждение снова сработает при следующем минусе.
        lowMoneyWarned: moneyAfter < economyData.bankruptcy.warningAt,
      },
    },
    report,
    lowMoney,
  };
}

/**
 * Годовой дрейф цены электричества: случайное блуждание в пределах ±20%.
 * Использует seeded RNG, поэтому одинаковый seed даёт одинаковую историю.
 */
export function driftElectricityPrice(state: GameState): { state: GameState; pricePerKwh: number } {
  const { priceDriftPerYear, priceMinMult, priceMaxMult } = economyData.electricity;
  const step = (nextFloat(state.rng) * 2 - 1) * priceDriftPerYear;
  const nextMult = Math.min(priceMaxMult, Math.max(priceMinMult, state.economy.electricityPriceMult * (1 + step)));
  return {
    state: {
      ...state,
      economy: { ...state.economy, electricityPriceMult: nextMult },
    },
    pricePerKwh: electricityPricePerKwh(nextMult),
  };
}

/** Прогноз денег на N месяцев вперёд при текущем счёте и без дохода. */
export function cashForecast(state: GameState, months = FORECAST_MONTHS): { month: number; money: number }[] {
  const bill = projectedMonthlyExpenses(state.economy.electricityPriceMult, hardwareLoadW(state)).total;
  const result: { month: number; money: number }[] = [];
  for (let index = 1; index <= months; index += 1) {
    result.push({ month: index, money: state.money - bill * index });
  }
  return result;
}

export type BankruptcyStatus = "ok" | "negative" | "warning" | "over";

/**
 * Состояние денег для интерфейса. «warning» — минус глубже порога, но режим
 * сложности запрещает конец игры (спокойная); «over» — банкротство.
 */
export function bankruptcyStatus(state: GameState): BankruptcyStatus {
  const mode = getDifficulty(state.difficulty).bankruptcy;
  if (mode === "none") return "ok";
  if (state.gameOver) return "over";
  if (state.money >= economyData.bankruptcy.warningAt) return "ok";
  if (state.money < economyData.bankruptcy.threshold) {
    return mode === "gameover" ? "over" : "warning";
  }
  return "negative";
}

/** Сколько игровых дней осталось до следующего счёта. */
export function daysUntilBill(hour: number): number {
  const elapsed = ((hour % HOURS_PER_MONTH) + HOURS_PER_MONTH) % HOURS_PER_MONTH;
  const left = HOURS_PER_MONTH - elapsed;
  return Math.ceil(left / HOURS_PER_DAY);
}
