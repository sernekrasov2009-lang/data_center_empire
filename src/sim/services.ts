import {
  getService,
  getInternetPlan,
  servicesData,
  type ServiceDefinition,
  type ServiceId,
} from "../data";
import { buildStatsForBuild } from "./components";
import { nextFloat } from "./core/rng";
import { DAYS_PER_MONTH, HOURS_PER_MONTH } from "./core/time";
import { activeBuilds } from "./location";
import type { GameState, HardwareBuild, ServicesState } from "./types";

export type ServiceErrorCode =
  | "serviceNotFound"
  | "invalidPrice"
  | "invalidLimit"
  | "cannotEnable";

export interface ServiceFailure {
  code: ServiceErrorCode;
  params?: Record<string, string | number>;
}

export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; failure: ServiceFailure };

export type ServiceEventKind = "clientsJoined" | "clientsLeft";

export interface ServiceEvent {
  kind: ServiceEventKind;
  amount?: number;
  ref?: string;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMbit(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Репутация компании. Пока константа из services.json; станет динамической на этапе 7. */
export function reputation(): number {
  return servicesData.demand.reputationStart;
}

function clampPriceMult(mult: number): number {
  return Math.min(
    servicesData.demand.priceMaxMult,
    Math.max(servicesData.demand.priceMinMult, mult),
  );
}

/** Начальное состояние услуг: рыночная цена, всё выключено, без клиентов. */
export function createServices(): ServicesState {
  return {
    services: servicesData.services.map((service) => ({
      id: service.id,
      priceMult: 1,
      enabled: false,
      clientLimit: 0,
    })),
    clients: [],
    monthRevenue: 0,
    lastHourRevenue: 0,
    nextClientId: 1,
  };

}

export function cloneServices(services: ServicesState): ServicesState {
  return {
    services: services.services.map((service) => ({ ...service })),
    clients: services.clients.map((client) => ({ ...client })),
    monthRevenue: services.monthRevenue,
    lastHourRevenue: services.lastHourRevenue,
    nextClientId: services.nextClientId,
  };
}

/** Суточный спрос λ для услуги по DESIGN.md, разд. 5.2. */
export function dailyDemand(state: GameState, serviceId: ServiceId): number {
  const definition = getService(serviceId);
  const entry = state.services.services.find((service) => service.id === serviceId);
  if (!entry || !entry.enabled) return 0;

  const { priceElasticity, reputationStart } = servicesData.demand;
  const ratio = entry.priceMult; // P / P_рынок
  const priceFactor = Math.pow(ratio, -priceElasticity);
  const reputationFactor = Math.pow(reputationStart, 1.5);
  return definition.baseDemandPerDay * reputationFactor * priceFactor;
}

/**
 * Пуассоновская выборка через seeded RNG (Knuth). Для малых λ точна,
 * больших в этой игре не бывает: даже λ=50 даёт верное распределение.
 */
function samplePoisson(rng: GameState["rng"], lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let product = nextFloat(rng);
  while (product > limit) {
    k += 1;
    product *= nextFloat(rng);
  }
  return k;
}

interface FreeCapacity {
  cores: number;
  ramGb: number;
  storageGb: number;
  mbit: number;
}

/** Свободные ресурсы по серверам (best-fit: меньше остаток — лучше). */
function freeCapacityPerBuild(state: GameState): Map<number, FreeCapacity> {
  const plan = getInternetPlan(state.location.internetPlanId);
  const usedMbit = state.services.clients.reduce(
    (sum, client) => sum + getService(client.serviceId).mbitPerClient,
    0,
  );
  const totalMbit = Math.max(0, plan.speedMbit - usedMbit);

  const map = new Map<number, FreeCapacity>();
  for (const build of activeBuilds(state)) {
    const stats = buildStatsForBuild(build);
    const used = { cores: 0, ramGb: 0, storageGb: 0 };
    for (const client of state.services.clients) {
      if (client.buildId !== build.id) continue;
      const definition = getService(client.serviceId);
      used.cores += definition.coresPerClient;
      used.ramGb += definition.ramGbPerClient;
      used.storageGb += definition.storageGbPerClient;
    }
    map.set(build.id, {
      cores: stats.cores - used.cores,
      ramGb: stats.ramGb - used.ramGb,
      storageGb: stats.storageGb - used.storageGb,
      mbit: totalMbit,
    });
  }
  return map;
}

function fits(definition: ServiceDefinition, free: FreeCapacity): boolean {
  return (
    free.cores >= definition.coresPerClient &&
    free.ramGb >= definition.ramGbPerClient &&
    free.storageGb >= definition.storageGbPerClient &&
    free.mbit >= definition.mbitPerClient
  );
}

function bestBuildId(definition: ServiceDefinition, free: Map<number, FreeCapacity>): number | null {
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [buildId, capacity] of free) {
    if (!fits(definition, capacity)) continue;
    // Best-fit: наименьший нормированный остаток после размещения клиента.
    const score =
      (capacity.cores - definition.coresPerClient) +
      (capacity.ramGb - definition.ramGbPerClient) / 8 +
      (capacity.storageGb - definition.storageGbPerClient) / 500;
    if (score < bestScore) {
      bestScore = score;
      best = buildId;
    }
  }
  return best;
}

/**
 * Суточный тик услуг: приток по Пуассону, отток, размещение по серверам.
 * Вызывается из движка на границе суток; state уже склонирован и мутируется.
 */
export function tickServices(state: GameState): { state: GameState; events: ServiceEvent[] } {
  const events: ServiceEvent[] = [];
  const services = cloneServices(state.services);
  state.services = services;

  // Отток: часть клиентов уходит каждый месяц; за цену выше рынка — дополнительный.
  const dailyChurnBase = servicesData.churn.baseMonthly / DAYS_PER_MONTH;
  const survivors: typeof services.clients = [];
  const leavers: number[] = [];
  for (const client of services.clients) {
    const entry = services.services.find((service) => service.id === client.serviceId);
    const pricePenaltyFrom = servicesData.churn.pricePenaltyFrom;
    const extra =
      entry && entry.priceMult > pricePenaltyFrom
        ? servicesData.churn.pricePenaltyMonthly / DAYS_PER_MONTH
        : 0;
    if (nextFloat(state.rng) < dailyChurnBase + extra) {
      leavers.push(client.id);
    } else {
      survivors.push(client);
    }
  }
  if (leavers.length > 0) {
    services.clients = survivors;
    events.push({ kind: "clientsLeft", amount: leavers.length });
  }

  // Приток по каждой услуге, если серверы работают.
  for (const entry of services.services) {
    if (!entry.enabled) continue;
    const definition = getService(entry.id);
    const lambda = dailyDemand(state, entry.id);
    let arrivals = samplePoisson(state.rng, lambda);

    // Лимит клиентов и ограничения репутации: приток не выше половины базы спроса в день.
    if (arrivals > 0 && lambda > 0) {
      arrivals = Math.min(arrivals, Math.max(1, Math.ceil(lambda)));
    }

    const limit = entry.clientLimit;
    const currentCount = services.clients.filter((client) => client.serviceId === entry.id).length;
    const room = limit > 0 ? Math.max(0, limit - currentCount) : Number.POSITIVE_INFINITY;
    arrivals = Math.min(arrivals, room);

    let joined = 0;
    while (arrivals > 0) {
      const free = freeCapacityPerBuild(state);
      const buildId = bestBuildId(definition, free);
      if (buildId === null) break;
      const capacity = free.get(buildId);
      if (!capacity) break;

      services.clients.push({
        id: services.nextClientId,
        serviceId: entry.id,
        buildId,
        sinceHour: state.time.hour,
        pricePerMonth: roundMoney(definition.pricePerMonth * entry.priceMult),
      });
      services.nextClientId += 1;
      arrivals -= 1;
      joined += 1;

      // Локальная пометка занятости, чтобы следующие клиенты шли на реальный остаток.
      capacity.cores -= definition.coresPerClient;
      capacity.ramGb -= definition.ramGbPerClient;
      capacity.storageGb -= definition.storageGbPerClient;
      capacity.mbit -= definition.mbitPerClient;
    }
    if (joined > 0) {
      events.push({ kind: "clientsJoined", amount: joined, ref: entry.id });
    }
  }

  return { state, events };
}

/**
 * Начисляет выручку за один игровой час. Простой (powerOff) — без дохода.
 * Возвращает новое состояние; вызывается из accrueHour в economy.ts.
 */
export function accrueRevenueHour(state: GameState): GameState {
  const running = state.location.powerOff === "none";
  const clients = running ? state.services.clients : [];
  const perHour = clients.reduce(
    (sum, client) => sum + client.pricePerMonth / HOURS_PER_MONTH,
    0,
  );
  const rounded = roundMoney(perHour);
  return {
    ...state,
    services: {
      ...state.services,
      monthRevenue: roundMoney(state.services.monthRevenue + rounded),
      lastHourRevenue: rounded,
    },
  };
}

/** Месячная выручка при текущих клиентах (для прогноза). */
export function projectedMonthlyRevenue(state: GameState): number {
  return roundMoney(
    state.services.clients.reduce((sum, client) => sum + client.pricePerMonth, 0),
  );
}

/** Выручка за текущий месяц переносятся в отчёт и обнуляется. */
export function closeMonthRevenue(services: ServicesState): { revenue: number; services: ServicesState } {
  return {
    revenue: services.monthRevenue,
    services: { ...services, monthRevenue: 0, lastHourRevenue: 0 },
  };
}

/* ── Действия игрока ─────────────────────────────────────────────── */

export function setServicePrice(state: GameState, serviceId: ServiceId, priceMult: number): ServiceResult<{ state: GameState; priceMult: number }> {
  const entry = state.services.services.find((service) => service.id === serviceId);
  if (!entry) return { ok: false, failure: { code: "serviceNotFound" } };
  if (!Number.isFinite(priceMult) || priceMult <= 0) {
    return { ok: false, failure: { code: "invalidPrice" } };
  }
  const clamped = clampPriceMult(priceMult);
  const services = cloneServices(state.services);
  const target = services.services.find((service) => service.id === serviceId);
  if (!target) return { ok: false, failure: { code: "serviceNotFound" } };
  target.priceMult = clamped;

  // Новая цена действует для новых клиентов; старые платят по цене подписки.
  return { ok: true, state: { ...state, services }, priceMult: clamped };
}

export function toggleService(state: GameState, serviceId: ServiceId): ServiceResult<{ state: GameState }> {
  const entry = state.services.services.find((service) => service.id === serviceId);
  if (!entry) return { ok: false, failure: { code: "serviceNotFound" } };

  const services = cloneServices(state.services);
  const target = services.services.find((service) => service.id === serviceId)!;
  const nextEnabled = !target.enabled;
  if (nextEnabled) {
    // Нельзя включить услугу, если нет ни одного работающего сервера.
    if (activeBuilds(state).length === 0) {
      return { ok: false, failure: { code: "cannotEnable" } };
    }
  }
  target.enabled = nextEnabled;
  return { ok: true, state: { ...state, services } };
}

export function setServiceLimit(state: GameState, serviceId: ServiceId, limit: number): ServiceResult<{ state: GameState; limit: number }> {
  const entry = state.services.services.find((service) => service.id === serviceId);
  if (!entry) return { ok: false, failure: { code: "serviceNotFound" } };
  if (!Number.isInteger(limit) || limit < 0 || limit > 100000) {
    return { ok: false, failure: { code: "invalidLimit" } };
  }
  const clamped = Math.floor(limit);
  const services = cloneServices(state.services);
  const target = services.services.find((service) => service.id === serviceId)!;
  target.clientLimit = clamped;
  return { ok: true, state: { ...state, services }, limit: clamped };
}

/** Использование ресурсов серверов текущими клиентами (для панели экрана услуг). */
export interface BuildUsage {
  buildId: number;
  clients: number;
  coresUsed: number;
  ramGbUsed: number;
  storageGbUsed: number;
  coresTotal: number;
  ramGbTotal: number;
  storageGbTotal: number;
}

export function buildUsage(state: GameState): BuildUsage[] {
  return activeBuilds(state).map((build) => {
    const stats = buildStatsForBuild(build);
    let coresUsed = 0;
    let ramGbUsed = 0;
    let storageGbUsed = 0;
    let clients = 0;
    for (const client of state.services.clients) {
      if (client.buildId !== build.id) continue;
      const definition = getService(client.serviceId);
      coresUsed += definition.coresPerClient;
      ramGbUsed += definition.ramGbPerClient;
      storageGbUsed += definition.storageGbPerClient;
      clients += 1;
    }
    return {
      buildId: build.id,
      clients,
      coresUsed,
      ramGbUsed,
      storageGbUsed,
      coresTotal: stats.cores,
      ramGbTotal: stats.ramGb,
      storageGbTotal: stats.storageGb,
    };
  });
}

/** Сколько клиентов обслуживается каждой услугой. */
export function clientsByService(state: GameState): Record<ServiceId, number> {
  const result = { landing: 0, cms: 0, chatbot: 0 } as Record<ServiceId, number>;
  for (const client of state.services.clients) {
    result[client.serviceId] = (result[client.serviceId] ?? 0) + 1;
  }
  return result;
}

/** Полоса интернета: занята клиентами, Мбит/с. */
export function usedMbit(state: GameState): number {
  return roundMbit(
    state.services.clients.reduce((sum, client) => sum + getService(client.serviceId).mbitPerClient, 0),
  );
}

/** Серверы, на которых могут размещаться клиенты (экспорт для интерфейса). */
export function serviceCapableBuilds(state: GameState): HardwareBuild[] {
  return activeBuilds(state);
}
