import {
  findComponent,
  servicesData,
} from "../data";
import { buildStats, validateBuild } from "./components";
import { placeNewOrder, previewNewOrder, startBuild } from "./hardware";
import { activeBuilds, firstFreeSlot, getLocation, totalPowerDrawW } from "./location";
import { resolveTickets } from "./reputation";
import {
  toggleService,
} from "./services";
import type { GameState } from "./types";

/**
 * Бот-стратегия для balance-sim (DESIGN.md, разд. 11). Живёт в src/sim,
 * потому что это чистая логика над игровым состоянием, без React/DOM.
 * Решения принимает раз в сутки, на границе дня.
 */

/** Сервер, который бот умеет собирать: список кодов деталей и цена. */
interface BotRecipe {
  name: string;
  partIds: string[];
}

const RECIPES: readonly BotRecipe[] = [
  {
    // Клон стартового ПК: дешёвый вордпроцессор для мелких услуг.
    name: "budget",
    partIds: ["cpu-vela-4", "mb-vela-a", "ram-pc8", "ram-pc8", "storage-hdd-1t", "psu-300", "case-tower", "nic-1g"],
  },
  {
    // Средний: больше ядер и ОЗУ, всё ещё домашний автомат тянет один.
    name: "mid",
    partIds: ["cpu-vela-8", "mb-vela-b", "ram-pc16", "ram-pc16", "storage-hdd-1t", "psu-550", "case-tower", "nic-1g"],
  },
  {
    // Мощный: 16 ядер, 64 ГБ — максимум для 1,5 кВт только с вентилятором.
    name: "big",
    partIds: ["cpu-orion-16", "mb-orion", "ram-ecc32", "ram-ecc32", "storage-ssd-500", "psu-800", "case-tower", "nic-1g"],
  },
];

function recipePrice(recipe: BotRecipe, marketMult: number): number {
  return Math.round(
    recipe.partIds.reduce((sum, id) => sum + findComponent(id)!.price, 0) * marketMult,
  );
}

function recipePower(recipe: BotRecipe): number {
  return recipe.partIds.reduce((sum, id) => sum + findComponent(id)!.power, 0);
}

function recipeStats(recipe: BotRecipe) {
  return buildStats(recipe.partIds);
}

/** Маржинальный месячный доход от заполнения нового сервера текущими услугами. */
function marginalMonthlyRevenue(state: GameState, recipe: BotRecipe): number {
  const stats = recipeStats(recipe);
  // Сколько клиентов каждой услуги влезает на сервер, считаем по узкому месту.
  let monthly = 0;
  for (const service of state.services.services) {
    if (!service.enabled) continue;
    const definition = servicesData.services.find((candidate) => candidate.id === service.id)!;
    const byCores = Math.floor(stats.cores / definition.coresPerClient);
    const byRam = Math.floor(stats.ramGb / definition.ramGbPerClient);
    const byDisk = Math.floor(stats.storageGb / definition.storageGbPerClient);
    const capacity = Math.max(0, Math.min(byCores, byRam, byDisk));
    monthly += capacity * definition.pricePerMonth * service.priceMult;
  }
  return monthly;
}

/** Полные месячные расходы, добавляемые сервером: электричество по PUE. */
function serverMonthlyCost(recipe: BotRecipe, hoursPerMonth: number, pricePerKwh: number, pue: number): number {
  return (recipePower(recipe) / 1000) * pue * hoursPerMonth * pricePerKwh;
}

export interface BotDecision {
  kind: "enableService" | "orderServer" | "buildServer" | "wait" | "warn";
  detail: string;
}

export interface BotDayResult {
  state: GameState;
  decisions: BotDecision[];
  /** Почему бот сегодня не заказал сервер (null — заказал или ещё рано). */
  blocker: string | null;
}

/**
 * Один день бота. Вызывается после advanceTicks(state, 24), на границе суток.
 * Порядок: услуги → сборка из склада → заказ нового сервера, если окупается.
 */
export function botDay(state: GameState): BotDayResult {
  let next = state;
  const decisions: BotDecision[] = [];
  let blocker: string | null = null;

  // 1. Услуги: включаем по убыванию дохода на ресурс, если есть работающий сервер.
  const hasServer = activeBuilds(next).length > 0;
  if (hasServer) {
    const ranked = servicesData.services
      .slice()
      .sort(
        (left, right) =>
          right.pricePerMonth / right.coresPerClient -
          left.pricePerMonth / left.coresPerClient,
      );
    for (const definition of ranked) {
      const entry = next.services.services.find((service) => service.id === definition.id);
      if (!entry || entry.enabled) continue;
      const result = toggleService(next, definition.id);
      if (result.ok) {
        next = result.state;
        decisions.push({ kind: "enableService", detail: definition.id });
      }
    }
  }

  // 1.5 Поддержка: бот закрывает тикеты каждый день (DESIGN §15.6, вручную).
  const tickets = resolveTickets(next);
  if (tickets.ok) {
    next = tickets.state;
    decisions.push({ kind: "enableService", detail: `закрыто тикетов: ${tickets.resolved}` });
  }

  // 2. Сборка из уже купленных деталей, если набор валиден.
  const built = tryBuildFromWarehouse(next, decisions);
  next = built.state;
  if (built.built) blocker = null;

  // 3. Заказ нового сервера, если окупается и есть место/мощность.
  const ordered = tryOrderServer(next, decisions);
  next = ordered.state;
  if (ordered.blocker !== null) blocker = ordered.blocker;

  return { state: next, decisions, blocker };
}

function tryBuildFromWarehouse(
  state: GameState,
  decisions: BotDecision[],
): { state: GameState; built: boolean } {
  let next = state;
  let built = false;
  for (const recipe of RECIPES) {
    const partIds = matchRecipe(next, recipe);
    if (partIds === null) continue;
    const validation = validateBuild(recipe.partIds);
    if (!validation.ok) continue;
    const result = startBuild(next, partIds);
    if (result.ok) {
      next = result.state;
      decisions.push({ kind: "buildServer", detail: `${recipe.name} (${partIds.length} деталей)` });
      built = true;
      break;
    }
  }
  return { state: next, built };
}

/** Находит на складе детали под рецепт; null — чего-то не хватает. */
function matchRecipe(state: GameState, recipe: BotRecipe): number[] | null {
  const partIds: number[] = [];
  const used = new Set<number>();
  for (const componentId of recipe.partIds) {
    const part = state.hardware.parts.find(
      (candidate) => candidate.componentId === componentId && !used.has(candidate.id),
    );
    if (!part) return null;
    used.add(part.id);
    partIds.push(part.id);
  }
  return partIds;
}

function tryOrderServer(
  state: GameState,
  decisions: BotDecision[],
): { state: GameState; blocker: string | null } {
  let next = state;
  const slot = firstFreeSlot(next);
  if (slot === null) {
    return {
      state: next,
      blocker: `нет свободных слотов (локация «${getLocation(next).id}»: ${getLocation(next).slots})`,
    };
  }

  // Автомат: заказываем сервер только если ИТ-нагрузка после добавления
  // не превысит ёмкость с запасом (PUE 1,8 умножается в экономике).
  const pue = 1.8; // PUE домашней локации из economy.json
  const pricePerKwh = 0.12; // тариф «дом» из economy.json
  const hoursPerMonth = 720; // 24 ч × 30 дн
  const capacity = getLocation(next).powerCapacityW;
  const currentDraw = totalPowerDrawW(next);

  let best: { recipe: BotRecipe; paybackMonths: number; cost: number } | null = null;
  let powerBlocked = false;
  let moneyBlocked = false;
  let paybackBlocked = false;
  for (const recipe of RECIPES) {
    // Ёмкость автомата: новый сервер не должен перегрузить цепь.
    if (currentDraw + recipePower(recipe) > capacity * 0.85) {
      powerBlocked = true;
      continue;
    }
    const cost = recipePrice(recipe, next.hardware.marketPriceMult);
    if (cost > next.money) {
      moneyBlocked = true;
      continue;
    }
    // Оставляем резерв на счёт за месяц.
    if (next.money - cost < 200) {
      moneyBlocked = true;
      continue;
    }

    const revenue = marginalMonthlyRevenue(next, recipe);
    const costMonthly = serverMonthlyCost(recipe, hoursPerMonth, pricePerKwh, pue);
    const net = revenue - costMonthly;
    if (net <= 0) {
      paybackBlocked = true;
      continue;
    }
    const payback = cost / net;
    if (!best || payback < best.paybackMonths) {
      best = { recipe, paybackMonths: payback, cost };
    }
  }

  if (!best) {
    if (powerBlocked) return { state: next, blocker: "не хватает мощности автомата" };
    if (moneyBlocked) return { state: next, blocker: "не хватает денег (с резервом $200)" };
    if (paybackBlocked) return { state: next, blocker: "нет окупаемых рецептов" };
    return { state: next, blocker: "нет доступных рецептов" };
  }

  // Заказываем по одной детали каждого типа (placeNewOrder принимает один компонент за раз).
  let ordered = true;
  for (const componentId of best.recipe.partIds) {
    const preview = previewNewOrder(next, componentId, 1);
    if (preview.total > next.money) {
      ordered = false;
      break;
    }
    const result = placeNewOrder(next, componentId, 1);
    if (result.ok) {
      next = result.state;
    } else {
      ordered = false;
      break;
    }
  }
  if (ordered) {
    decisions.push({
      kind: "orderServer",
      detail: `${best.recipe.name}, окупаемость ${best.paybackMonths.toFixed(1)} мес, $${best.cost}`,
    });
    return { state: next, blocker: null };
  }
  return { state: next, blocker: "заказ сорвался на середине (не хватило денег)" };
}

/** Сводка дня для CSV и консоли. */
export interface DaySummary {
  day: number;
  money: number;
  revenue: number;
  expenses: number;
  clients: number;
  servers: number;
  reputation: number;
  uptimePct: number;
}

export function summarizeDay(state: GameState, day: number): DaySummary {
  const report = state.economy.reports.at(-1);
  const uptimePct =
    state.reputation.hoursWithClients > 0
      ? Math.max(0, (1 - state.reputation.downtimeHours / state.reputation.hoursWithClients) * 100)
      : 100;
  return {
    day,
    money: Math.round(state.money * 100) / 100,
    revenue: report ? Math.round(report.revenue * 100) / 100 : 0,
    expenses: report ? Math.round(report.totalExpenses * 100) / 100 : 0,
    clients: state.services.clients.length,
    servers: activeBuilds(state).length,
    reputation: Math.round(state.reputation.value * 100) / 100,
    uptimePct: Math.round(uptimePct * 10) / 10,
  };
}
