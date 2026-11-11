import { economy as economyData, getDifficulty, getElectricityTariff, getInternetPlan } from "../data";
import { getLocation, locationRentPerMonth, totalPowerDrawW } from "./location";
import { monthlyPayroll } from "./staff";
import { accrueRevenueHour, closeMonthRevenue, projectedMonthlyRevenue } from "./services";
import { nextFloat } from "./core/rng";
import { HOURS_PER_DAY, HOURS_PER_MONTH, getGameDate } from "./core/time";
import type { EconomyState, ExpenseBreakdown, GameState, MonthlyReport } from "./types";

/** Сколько месяцев вперёд считается прогноз денег (DESIGN.md, разд. 12.2). */
export const FORECAST_MONTHS = 3;

export function createEconomy(): EconomyState {
  return {
    accrual: { electricity: 0, internet: 0, rent: 0, staff: 0 },
    reports: [],
    lifetime: { revenue: 0, expenses: 0 },
    electricityPriceMult: 1,
    lowMoneyWarned: false,
  };
}

/** Цена кВт·ч с учётом годового дрейфа. */
export function electricityPricePerKwh(priceMult: number): number {
  return getElectricityTariff(economyData.start.electricityTariffId).pricePerKwh * priceMult;
}

/** Тариф локации: дом — бытовой, гараж — коммерческий, colo — промышленный. */
export function locationElectricityTariffId(state: GameState): string {
  const id = getLocation(state).id;
  if (id === "home") return "home";
  if (id === "colo" || id === "datacenter") return "industrial";
  return "commercial";
}

/**
 * Стоимость электричества за один игровой час: ИТ-нагрузка × PUE локации
 * плюс явное потребление охлаждения.
 */
export function hourlyElectricityCost(
  state: GameState,
  priceMult = state.economy.electricityPriceMult,
): number {
  const eventMult = state.world.electricityPriceEventMult;
  const price = getElectricityTariff(locationElectricityTariffId(state)).pricePerKwh * priceMult;
  return (totalPowerDrawW(state) / 1000) * price * eventMult;
}

/** Полный месяц электричества при текущей цене (для прогноза и подсказок). */
export function monthElectricityCost(
  state: GameState,
  priceMult = state.economy.electricityPriceMult,
): number {
  return hourlyElectricityCost(state, priceMult) * HOURS_PER_MONTH;
}

/** Постоянные месячные расходы: интернет по выбранному тарифу и аренда локации. */
export function fixedMonthlyCosts(
  state: GameState,
): { internet: number; rent: number; staff: number } {
  const plan = getInternetPlan(state.location.internetPlanId);
  return {
    internet: plan.pricePerMonth,
    rent: locationRentPerMonth(state),
    staff: monthlyPayroll(state),
  };
}

/** Итоговый прогноз счёта за полный месяц при заданном множителе цены. */
export function projectedMonthlyExpenses(
  state: GameState,
  priceMult = state.economy.electricityPriceMult,
): ExpenseBreakdown & { total: number } {
  const fixed = fixedMonthlyCosts(state);
  const electricity = monthElectricityCost(state, priceMult);
  return {
    electricity,
    internet: fixed.internet,
    rent: fixed.rent,
    staff: fixed.staff,
    total: electricity + fixed.internet + fixed.rent + fixed.staff,
  };
}

/** Прогноз дохода за полный месяц при текущих клиентах и цене. */
export function projectedMonthlyIncome(state: GameState): number {
  return projectedMonthlyRevenue(state);
}

/** Начисляет электричество и выручку за один прошедший час. */
export function accrueHour(state: GameState): GameState {
  const withRevenue = accrueRevenueHour(state);
  const cost = hourlyElectricityCost(withRevenue);
  return {
    ...withRevenue,
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
  const fixed = fixedMonthlyCosts(state);
  const closed = getGameDate(Math.max(0, hour - 1));
  const revenue = closeMonthRevenue(state.services);
  const expenses: ExpenseBreakdown = {
    electricity: state.economy.accrual.electricity,
    internet: fixed.internet,
    rent: fixed.rent,
    staff: fixed.staff,
  };
  const totalExpenses =
    expenses.electricity + expenses.internet + expenses.rent + expenses.staff;
  const moneyAfter = state.money + revenue.revenue - totalExpenses;
  const report: MonthlyReport = {
    hour,
    year: closed.year,
    month: closed.month,
    revenue: revenue.revenue,
    expenses,
    totalExpenses,
    net: revenue.revenue - totalExpenses,
    moneyAfter,
  };

  const historySize = economyData.reports.historySize;
  const reports = [...state.economy.reports, report].slice(-historySize);
  const lowMoney = moneyAfter < economyData.bankruptcy.warningAt && !state.economy.lowMoneyWarned;

  return {
    state: {
      ...state,
      services: revenue.services,
      money: moneyAfter,
      economy: {
        ...state.economy,
        accrual: { electricity: 0, internet: 0, rent: 0, staff: 0 },
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

/** Прогноз денег на N месяцев вперёд при текущем счёте и доходе. */
export function cashForecast(state: GameState, months = FORECAST_MONTHS): { month: number; money: number }[] {
  const bill = projectedMonthlyExpenses(state).total;
  const income = projectedMonthlyIncome(state);
  const result: { month: number; money: number }[] = [];
  for (let index = 1; index <= months; index += 1) {
    result.push({ month: index, money: state.money + (income - bill) * index });
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
