import {
  staffData,
  economy,
  findComponent,
  locationData,
  servicesData,
  getResearch,
  type ResearchId,
} from "../data";
import { buildStats, validateBuild } from "./components";
import { placeNewOrder, previewNewOrder, startBuild } from "./hardware";
import {
  buyRack,
  firstFreeSlot,
  getLocation,
  locationPowerCapacityW,
  locationSlots,
  placedBuilds,
  returnRack,
  setBuildSlot,
  totalPowerDrawW,
} from "./location";
import { resolveTickets } from "./reputation";
import {
  toggleService,
} from "./services";
import {
  buyInsulation,
  buyUps,
  moveLocation,
  restartServers,
  setCooling,
} from "./location";
import { fireStaff, hireStaff, monthlyPayroll, staffCapByRevenue } from "./staff";
import { researchAvailable, startResearch } from "./research";
import { projectedMonthlyExpenses, projectedMonthlyIncome } from "./economy";
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

/**
 * Маржинальный месячный доход от заполнения нового сервера текущими услугами.
 * Поправка на фактическую заполненность: новый сервер заполняется как
 * существующие (среднее число клиентов на сервер против полной ёмкости).
 * Без неё бот строил «мёртвые» серверы и тонул в аренде/электричестве
 * при малом числе клиентов (DECISIONS 75).
 */
function marginalMonthlyRevenue(state: GameState, recipe: BotRecipe): number {
  const stats = recipeStats(recipe);
  const servers = placedBuilds(state).length;
  const avgClientsPerServer =
    servers > 0 ? state.services.clients.length / servers : 0;
  // Сколько клиентов каждой услуги влезает на сервер, считаем по узкому месту.
  let monthly = 0;
  let capacitySum = 0;
  for (const service of state.services.services) {
    if (!service.enabled) continue;
    const definition = servicesData.services.find((candidate) => candidate.id === service.id)!;
    const byCores = Math.floor(stats.cores / definition.coresPerClient);
    const byRam = Math.floor(stats.ramGb / definition.ramGbPerClient);
    const byDisk = Math.floor(stats.storageGb / definition.storageGbPerClient);
    const capacity = Math.max(0, Math.min(byCores, byRam, byDisk));
    monthly += capacity * definition.pricePerMonth * service.priceMult;
    capacitySum += capacity;
  }
  // Заполненность 0,25–1: первый сервер считаем четвертью ёмкости,
  // дальше — по факту (полная ёмкость и полный клиентский поток редко сходятся).
  const fill = servers > 0 ? Math.min(1, avgClientsPerServer / Math.max(1, capacitySum)) : 0.25;
  return monthly * Math.max(0.25, fill);
}

/** Полные месячные расходы, добавляемые сервером: электричество по PUE. */
function serverMonthlyCost(recipe: BotRecipe, hoursPerMonth: number, pricePerKwh: number, pue: number): number {
  return (recipePower(recipe) / 1000) * pue * hoursPerMonth * pricePerKwh;
}

export interface BotDecision {
  kind: "enableService" | "orderServer" | "buildServer" | "wait" | "warn" | "moveLocation";
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
  const hasServer = placedBuilds(next).length > 0;
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

  // 2.5 Переезд в гараж, когда домашние слоты закончились (DECISIONS 50).
  // Копим moving.price + резерв $300 на кануне переезда.
  if (next.location.id === "home") {
    const slot = firstFreeSlot(next);
    const powerFull = totalPowerDrawW(next) >= getLocation(next).powerCapacityW * 0.85;
    if ((slot === null || powerFull) && next.money >= locationData.moving.price + 300) {
      const result = moveLocation(next, "garage");
      if (result.ok) {
        next = result.state;
        decisions.push({
          kind: "moveLocation",
          detail: `переезд в гараж, $${result.cost}, 24 ч простоя`,
        });
      } else {
        decisions.push({ kind: "warn", detail: `переезд не удался: ${result.failure.code}` });
      }
    }
  }

  // 2.6 В гараже: покупаем ИБП, чтобы блэкауты не рвали аптайм.
  if (next.location.id === "garage" && !next.location.upsOwned) {
    if (next.money >= locationData.ups.price + 300) {
      const result = buyUps(next);
      if (result.ok) {
        next = result.state;
        decisions.push({ kind: "wait", detail: `куплен ИБП, $${result.cost}` });
      }
    }
  }

  // 2.6.1 Colo (этап 12): гараж заполнен — переезжаем.
  // Потолок гаража (12 слотов, ~$2200/мес из-за оттока по SLA) не даёт
  // выручке вырасти, поэтому порог не по выручке, а по деньгам: стоимость
  // переезда + запас на ~3 месяца colo-счетов (~$1000/мес).
  if (next.location.id === "garage") {
    const slot = firstFreeSlot(next);
    const powerFull = totalPowerDrawW(next) >= locationPowerCapacityW(next) * 0.85;
    if (
      (slot === null || powerFull) &&
      next.money >= locationData.moving.toColo.price + 5000
    ) {
      const result = moveLocation(next, "colo");
      if (result.ok) {
        next = result.state;
        decisions.push({
          kind: "moveLocation",
          detail: `переезд в colo, $${result.cost}, 48 ч простоя`,
        });
      } else {
        decisions.push({ kind: "warn", detail: `переезд в colo не удался: ${result.failure.code}` });
      }
    }
  }

  // 2.6.2 В colo: держим охлаждение CRAC и докупаем стойки по мере роста.
  if (next.location.id === "colo") {
    if (next.location.coolingId !== "crac" && next.money >= 5000 + 500) {
      const result = setCooling(next, "crac");
      if (result.ok && result.cost > 0) {
        next = result.state;
        decisions.push({ kind: "wait", detail: `куплен CRAC, $${result.cost}` });
      }
    }
    const slot = firstFreeSlot(next);
    // Стойку докупаем, только когда слоты почти кончились: аренда $500/мес
    // за пустую стойку топит экономику при оттоке клиентов (DECISIONS 75).
    const usedSlots = next.hardware.builds.filter((build) => build.slot !== null).length;
    const totalSlots = locationSlots(next);
    if (
      slot === null &&
      usedSlots >= totalSlots &&
      next.location.ownedRacks < locationData.rack.maxRacks &&
      next.money >= locationData.rack.rentPerMonth * 4
    ) {
      const result = buyRack(next);
      if (result.ok) {
        next = result.state;
        decisions.push({ kind: "wait", detail: `арендована стойка, $${result.cost}` });
      }
    }
  }

  // 2.7 Шум: без изоляции в гараже штрафы $50 съедают всю прибыль.
  // Изоляция −8 дБ возвращает шум под ночной лимит.
  if (!next.location.insulated && next.money >= locationData.insulation.price + 300) {
    const result = buyInsulation(next);
    if (result.ok) {
      next = result.state;
      decisions.push({ kind: "wait", detail: `куплена шумоизоляция, $${result.cost}` });
    }
  }

  // 2.8 Перегрев: с ростом числа серверов вентилятора мало — покупаем сплит.
  // При активном перегреве покупаем из любых денег: иначе вечный цикл
  // shutdown → рестарт → shutdown и потеря всех клиентов (DECISIONS 75).
  const overheated = next.location.powerOff === "overheat";
  if (
    next.location.coolingId === "fan" &&
    (overheated || next.money >= 650 + 300)
  ) {
    const result = setCooling(next, "split");
    if (result.ok && result.cost > 0) {
      next = result.state;
      decisions.push({ kind: "wait", detail: `куплен сплит-кондиционер, $${result.cost}` });
    }
  }

  // 2.9 Аварийное отключение из-за перегрева: ждём остывания и включаем обратно.
  // Если охлаждение не держит нагрузку — сначала копим на апгрейд (сплит),
  // иначе рестарт уходит в вечный цикл shutdown → restart (DECISIONS 75).
  const needCoolingUpgrade =
    next.location.coolingId === "fan" && next.location.roomTempC >= 35;
  if (next.location.powerOff === "overheat" && !needCoolingUpgrade) {
    const result = restartServers(next);
    if (result.ok) {
      next = result.state;
      decisions.push({ kind: "wait", detail: "серверы перезапущены после перегрева" });
    }
  }

  // 2.9.1 Антикризис (DECISIONS 75): ушли в минус, а прогноз выручки не
  // покрывает месячный счёт — снимаем серверы без клиентов со слотов:
  // электричество падает сразу, клиенты не страдают. Порог строго
  // отрицательный, иначе правило срезает нормальный рост.
  {
    const expenses = projectedMonthlyExpenses(next).total;
    const income = projectedMonthlyIncome(next);
    if (next.money < 0 && income < expenses) {
      // Персонал: увольняем самого дорогого, если компенсация по карману.
      const payroll = next.staff.employees.length;
      if (payroll > 0) {
        const dearest = next.staff.employees
          .slice()
          .sort((left, right) => right.level - left.level)[0]!;
        const fire = fireStaff(next, dearest.id);
        if (fire.ok) {
          next = fire.state;
          decisions.push({ kind: "wait", detail: `уволен ${dearest.roleId} (антикризис)` });
        }
      }
      const idle = next.hardware.builds
        .filter((build) => build.slot !== null)
        .filter((build) => !next.services.clients.some((client) => client.buildId === build.id));
      const victim = idle.at(-1);
      if (victim) {
        const result = setBuildSlot(next, victim.id, null);
        if (result.ok) {
          next = result.state;
          decisions.push({ kind: "wait", detail: `сервер #${victim.id} снят со слота (антикризис)` });
        }
      }
      // Стойка: вернуть лишнюю, если её слоты свободны (аренда падает).
      if (next.location.id === "colo" && next.location.ownedRacks > 1) {
        const back = returnRack(next);
        if (back.ok) {
          next = back.state;
          decisions.push({ kind: "wait", detail: "стойка возвращена арендодателю (антикризис)" });
        }
      }
    }
  }

  // 2.10 Персонал (этап 10): нанимаем по приоритету, пока месячная выручка
  // покрывает зарплаты (каждые $1200 выручки — один сотрудник).
  const staffCap = staffCapByRevenue(next);
  const hireRevenue = next.economy.reports.at(-1)?.revenue ?? 0;
  if (next.staff.employees.length < staffCap) {
    const priority = ["support", "sales", "sysadmin", "network", "electrician", "security"];
    const currentPayroll = monthlyPayroll(next);
    for (const roleId of priority) {
      if (next.staff.employees.some((employee) => employee.roleId === roleId)) continue;
      const role = staffData.roles.find((candidate) => candidate.id === roleId)!;
      // Нанимаем, только если суммарный фонд оплаты после найма не
      // превысит 40% месячной выручки: иначе персонал топит счёт при
      // падении выручки (осцилляция SLA-оттока, DECISIONS 75).
      if (currentPayroll + role.salaryPerMonth > hireRevenue * 0.4) continue;
      if (next.money < Math.round(role.salaryPerMonth * staffData.hiring.feeMult)) continue;
      const result = hireStaff(next, roleId);
      if (result.ok) {
        next = result.state;
        decisions.push({ kind: "wait", detail: `нанят ${role.id}, $${result.cost}` });
      }
      break;
    }
  }

  // 2.11 Исследования (этап 11): по приоритету, после выручки $700/мес и с запасом.
  // Порог опущен с $1000: рост выручки упирается в слоты/тепло гаража, а
  // virtualization (+20% ёмкости услуг) ускоряет выход на colo (этап 12).
  // Пока копим на проект — серверы не заказываем (иначе деньги всегда
  // уходят в железо и исследования не стартуют никогда).
  let savingForResearch = false;
  const researchPriority: ResearchId[] = [
    "virtualization",
    "raidBackups",
    "monitoring",
    "ddosProtection",
  ];
  const lastRevenue = next.economy.reports.at(-1)?.revenue ?? 0;
  if (lastRevenue >= 700) {
    for (const id of researchPriority) {
      if (!researchAvailable(next, id)) continue;
      const project = getResearch(id);
      // Запускаем, только если остаётся резерв в половину стоимости.
      if (next.money < project.cost * 1.5) {
        savingForResearch = true;
        break;
      }
      const result = startResearch(next, id);
      if (result.ok) {
        next = result.state;
        decisions.push({ kind: "wait", detail: `исследование ${id}, $${result.cost}` });
      }
      break;
    }
  }

  // 3. Заказ нового сервера, если окупается и есть место/мощность.
  if (savingForResearch) {
    blocker = "копим на исследование";
  } else {
    const ordered = tryOrderServer(next, decisions);
    next = ordered.state;
    if (ordered.blocker !== null) blocker = ordered.blocker;
  }

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
      blocker: `нет свободных слотов (локация «${getLocation(next).id}»: ${locationSlots(next)})`,
    };
  }

  // Автомат: заказываем сервер только если ИТ-нагрузка после добавления
  // не превысит ёмкость с запасом (PUE 1,8 умножается в экономике).
  const locationId = getLocation(next).id as "home" | "garage" | "colo";
  const pue = economy.electricity.pue[locationId]; // 1,8 дом / 1,6 гараж / 1,5 colo
  const tariffId = locationId === "home" ? "home" : locationId === "colo" ? "industrial" : "commercial";
  const pricePerKwh = economy.electricity.tariffs.find(
    (t: { id: string; pricePerKwh: number }) => t.id === tariffId,
  )!.pricePerKwh;
  const hoursPerMonth = 720; // 24 ч × 30 дн
  const capacity = locationPowerCapacityW(next);
  const currentDraw = totalPowerDrawW(next);

  // Тепло (DECISIONS 75): без сплита серверы перегреются. Летом вентилятор
  // (C=40) держит до shutdownC 55 °C при +21 К: 34 °C наружная + 21 К
  // = 840 Вт. Оставляем запас 10%: дальше копим на сплит ($650).
  const maxHeatW = 750;
  const fanOnly = next.location.coolingId === "fan" || next.location.coolingId === "window";
  if (fanOnly && currentDraw + recipePower(RECIPES[0]!) > maxHeatW) {
    return {
      state: next,
      blocker: "охлаждение fan/window не держит больше серверов — копим на сплит",
    };
  }

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
    // Оставляем резерв на полный месячный счёт: электричество + интернет +
    // аренда (в colo — со стойками) + зарплаты. Фиксированных $200 в colo
    // не хватает — бот заказывал серверы и банкротился (DECISIONS 75).
    const billReserve = projectedMonthlyExpenses(next).total;
    if (next.money - cost < billReserve) {
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
    if (moneyBlocked) return { state: next, blocker: "не хватает денег (резерв = месячный счёт)" };
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
    servers: placedBuilds(state).length,
    reputation: Math.round(state.reputation.value * 100) / 100,
    uptimePct: Math.round(uptimePct * 10) / 10,
  };
}
