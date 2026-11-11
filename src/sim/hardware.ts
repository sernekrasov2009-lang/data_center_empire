import { findComponent, getComponent, getDifficulty, hardware as hardwareData } from "../data";
import { chance, nextFloat, nextInt } from "./core/rng";
import { HOURS_PER_DAY, HOURS_PER_YEAR } from "./core/time";
import {
  buildHours,
  buildValue,
  failureProbability,
  newPartPrice,
  roundMoney,
  validateBuild,
  type BuildError,
} from "./components";
import { assignFreeSlot, serversRunning } from "./location";
import { effectStrength } from "./staff";
import { researchBonuses } from "./research";
import type {
  GameState,
  HardwareBuild,
  HardwareOrder,
  HardwareState,
  PartInstance,
  UsedLot,
} from "./types";

const WEEK_HOURS = HOURS_PER_DAY * 7;

export type HardwareErrorCode =
  | "invalidQuantity"
  | "componentNotFound"
  | "notEnoughMoney"
  | "lotNotFound"
  | "orderNotFound"
  | "orderNotInTransit"
  | "cancelTooLate"
  | "orderNotDelivered"
  | "returnTooLate"
  | "partsUsed"
  | "partNotFound"
  | "invalidBuild";

export interface HardwareFailure {
  code: HardwareErrorCode;
  params?: Record<string, string | number>;
  /** Подробности проверки совместимости для формы сборки. */
  buildErrors?: BuildError[];
}

export type HardwareResult<T> = ({ ok: true } & T) | { ok: false; failure: HardwareFailure };

export type HardwareEventKind =
  | "orderArrived"
  | "buildCompleted"
  | "partFailed"
  | "partRepaired"
  | "usedMarketUpdated";

export interface HardwareEvent {
  kind: HardwareEventKind;
  amount?: number;
  ref?: string;
}

function cloneHardware(hardware: HardwareState): HardwareState {
  return {
    ...hardware,
    parts: hardware.parts.map((part) => ({ ...part })),
    builds: hardware.builds.map((build) => ({
      ...build,
      parts: build.parts.map((part) => ({ ...part })),
    })),
    orders: hardware.orders.map((order) => ({
      ...order,
      lines: order.lines.map((line) => ({ ...line })),
    })),
    usedLots: hardware.usedLots.map((lot) => ({ ...lot })),
  };
}

function cloneGame(state: GameState): GameState {
  return {
    ...state,
    rng: { ...state.rng },
    hardware: cloneHardware(state.hardware),
  };
}

function startingBuild(): HardwareBuild {
  const parts = hardwareData.startBuild.parts.map((componentId) => ({
    componentId,
    condition: "new" as const,
    purchasePrice: getComponent(componentId).price,
    installedAtHour: 0,
    defectAtHour: null,
    broken: false,
    repairDoneHour: null,
  }));

  return {
    id: 1,
    starter: true,
    status: "ready",
    startedAtHour: 0,
    readyAtHour: 0,
    parts,
    slot: 0,
  };
}

/** Начальное состояние железа: старый домашний ПК из стартовых условий. */
export function createHardware(): HardwareState {
  return {
    parts: [],
    builds: [startingBuild()],
    orders: [],
    usedLots: [],
    marketPriceMult: 1,
    lastUsedMarketHour: -1,
    nextPartId: 1,
    nextBuildId: 2,
    nextOrderId: 1,
    nextLotId: 1,
  };
}

export function shippingFor(subtotal: number): number {
  return subtotal >= hardwareData.delivery.freeFrom ? 0 : hardwareData.delivery.fee;
}

export interface NewOrderPreview {
  componentId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  shipping: number;
  total: number;
}

export function previewNewOrder(state: GameState, componentId: string, quantity: number): NewOrderPreview {
  const unitPrice = newPartPrice(componentId, state.hardware.marketPriceMult);
  const subtotal = roundMoney(unitPrice * quantity);
  const shipping = shippingFor(subtotal);
  return {
    componentId,
    quantity,
    unitPrice,
    subtotal,
    shipping,
    total: roundMoney(subtotal + shipping),
  };
}

/** Скрытый дефект б/у детали: час в первые N дней после доставки. */
export function hiddenDefectAtHour(
  rng: GameState["rng"],
  hour: number,
  defectChance = hardwareData.market.usedDefectChance,
): number | null {
  if (!chance(rng, defectChance)) return null;
  const windowHours = hardwareData.market.usedDefectWindowDays * HOURS_PER_DAY;
  return hour + nextInt(rng, 1, windowHours);
}

function makeOrder(
  state: GameState,
  kind: HardwareOrder["kind"],
  line: HardwareOrder["lines"][number],
  orderedAtHour: number,
  arriveAtHour: number,
  lotId: number | null,
): HardwareOrder {
  const subtotal = roundMoney(line.unitPrice * line.quantity);
  const shipping = shippingFor(subtotal);
  return {
    id: state.hardware.nextOrderId,
    kind,
    lines: [line],
    subtotal,
    shipping,
    total: roundMoney(subtotal + shipping),
    status: "inTransit",
    orderedAtHour,
    arriveAtHour,
    deliveredAtHour: null,
    lotId,
  };
}

/** Заказ новых деталей. Деньги списываются сразу. */
export function placeNewOrder(
  state: GameState,
  componentId: string,
  quantity: number,
): HardwareResult<{ state: GameState; order: HardwareOrder; preview: NewOrderPreview }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return { ok: false, failure: { code: "invalidQuantity" } };
  }
  if (!findComponent(componentId)) {
    return { ok: false, failure: { code: "componentNotFound" } };
  }

  const preview = previewNewOrder(state, componentId, quantity);
  if (state.money < preview.total) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: preview.total } } };
  }

  const next = cloneGame(state);
  const days = nextInt(
    next.rng,
    hardwareData.delivery.newDaysMin,
    hardwareData.delivery.newDaysMax,
  );
  const order = makeOrder(
    next,
    "new",
    {
      componentId,
      quantity,
      unitPrice: preview.unitPrice,
      condition: "new",
    },
    next.time.hour,
    next.time.hour + days * HOURS_PER_DAY,
    null,
  );

  next.money = roundMoney(next.money - order.total);
  next.hardware.orders.push(order);
  next.hardware.nextOrderId += 1;
  return { ok: true, state: next, order, preview };
}

/** Покупка конкретного лота б/у рынка. */
export function buyUsedLot(
  state: GameState,
  lotId: number,
): HardwareResult<{ state: GameState; order: HardwareOrder }> {
  const lot = state.hardware.usedLots.find((candidate) => candidate.id === lotId);
  if (!lot) return { ok: false, failure: { code: "lotNotFound" } };

  const total = roundMoney(lot.price + shippingFor(lot.price));
  if (state.money < total) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total } } };
  }

  const next = cloneGame(state);
  next.hardware.usedLots = next.hardware.usedLots.filter((candidate) => candidate.id !== lotId);
  const days = nextInt(
    next.rng,
    hardwareData.delivery.usedDaysMin,
    hardwareData.delivery.usedDaysMax,
  );
  const order = makeOrder(
    next,
    "used",
    {
      componentId: lot.componentId,
      quantity: 1,
      unitPrice: lot.price,
      condition: "used",
    },
    next.time.hour,
    next.time.hour + days * HOURS_PER_DAY,
    lot.id,
  );

  next.money = roundMoney(next.money - order.total);
  next.hardware.orders.push(order);
  next.hardware.nextOrderId += 1;
  return { ok: true, state: next, order };
}

/** Отмена заказа в первые 12 часов: возврат всей суммы. */
export function cancelOrder(
  state: GameState,
  orderId: number,
): HardwareResult<{ state: GameState; refund: number }> {
  const order = state.hardware.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { ok: false, failure: { code: "orderNotFound" } };
  if (order.status !== "inTransit") return { ok: false, failure: { code: "orderNotInTransit" } };
  if (state.time.hour - order.orderedAtHour > hardwareData.delivery.cancelHours) {
    return { ok: false, failure: { code: "cancelTooLate" } };
  }

  const next = cloneGame(state);
  const target = next.hardware.orders.find((candidate) => candidate.id === orderId);
  if (!target) return { ok: false, failure: { code: "orderNotFound" } };
  target.status = "cancelled";
  next.money = roundMoney(next.money + target.total);
  return { ok: true, state: next, refund: target.total };
}

/** Возврат доставленного заказа в течение 3 дней с комиссией 10%. */
export function returnOrder(
  state: GameState,
  orderId: number,
): HardwareResult<{ state: GameState; refund: number }> {
  const order = state.hardware.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { ok: false, failure: { code: "orderNotFound" } };
  if (order.status !== "delivered" || order.deliveredAtHour === null) {
    return { ok: false, failure: { code: "orderNotDelivered" } };
  }
  if (state.time.hour - order.deliveredAtHour > hardwareData.delivery.returnDays * HOURS_PER_DAY) {
    return { ok: false, failure: { code: "returnTooLate" } };
  }

  for (const line of order.lines) {
    const available = state.hardware.parts.filter(
      (part) => part.orderId === order.id && part.componentId === line.componentId,
    ).length;
    if (available < line.quantity) {
      return {
        ok: false,
        failure: { code: "partsUsed", params: { component: getComponent(line.componentId).name } },
      };
    }
  }

  const next = cloneGame(state);
  const target = next.hardware.orders.find((candidate) => candidate.id === orderId);
  if (!target) return { ok: false, failure: { code: "orderNotFound" } };

  for (const line of target.lines) {
    for (let index = 0; index < line.quantity; index += 1) {
      const partIndex = next.hardware.parts.findIndex(
        (part) => part.orderId === target.id && part.componentId === line.componentId,
      );
      if (partIndex >= 0) next.hardware.parts.splice(partIndex, 1);
    }
  }

  const refund = roundMoney(target.subtotal * (1 - hardwareData.delivery.returnFee));
  next.money = roundMoney(next.money + refund);
  target.status = "returned";
  return { ok: true, state: next, refund };
}

/** Сборка сервера из деталей на складе. */
export function startBuild(
  state: GameState,
  partIds: readonly number[],
): HardwareResult<{ state: GameState; build: HardwareBuild; hours: number }> {
  const unique = Array.from(new Set(partIds));
  if (unique.length === 0 || unique.length !== partIds.length) {
    return { ok: false, failure: { code: "invalidBuild" } };
  }

  const parts: PartInstance[] = [];
  for (const id of unique) {
    const part = state.hardware.parts.find((candidate) => candidate.id === id);
    if (!part) return { ok: false, failure: { code: "partNotFound", params: { part: id } } };
    parts.push(part);
  }

  const validation = validateBuild(parts.map((part) => part.componentId));
  if (!validation.ok) {
    return {
      ok: false,
      failure: { code: "invalidBuild", buildErrors: validation.errors },
    };
  }

  const next = cloneGame(state);
  const hours = buildHours(parts.length);
  const build: HardwareBuild = {
    id: next.hardware.nextBuildId,
    starter: false,
    status: hours === 0 ? "ready" : "assembling",
    startedAtHour: next.time.hour,
    readyAtHour: next.time.hour + hours,
    parts: parts.map((part) => ({
      componentId: part.componentId,
      condition: part.condition,
      purchasePrice: part.purchasePrice,
      installedAtHour: next.time.hour,
      defectAtHour: part.defectAtHour,
      broken: false,
      repairDoneHour: null,
    })),
    slot: null,
  };

  if (build.status === "ready") {
    assignFreeSlot(next, build);
  }

  next.hardware.parts = next.hardware.parts.filter((part) => !unique.includes(part.id));
  next.hardware.builds.push(build);
  next.hardware.nextBuildId += 1;
  return { ok: true, state: next, build, hours };
}

function buildUsedLots(state: GameState): HardwareState {
  const hardware = cloneHardware(state.hardware);
  const pool = hardwareData.components.slice();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = nextInt(state.rng, 0, index);
    const current = pool[index];
    pool[index] = pool[swap] as (typeof pool)[number];
    pool[swap] = current as (typeof pool)[number];
  }

  const count = Math.min(hardwareData.market.usedLotsPerWeek, pool.length);
  const lots: UsedLot[] = [];
  for (let index = 0; index < count; index += 1) {
    const component = pool[index];
    if (!component) continue;
    const spread = hardwareData.market.usedDiscountMax - hardwareData.market.usedDiscountMin;
    const discount = hardwareData.market.usedDiscountMin + nextFloat(state.rng) * spread;
    lots.push({
      id: hardware.nextLotId,
      componentId: component.id,
      price: roundMoney(newPartPrice(component.id, hardware.marketPriceMult) * (1 - discount)),
      discount,
      listedAtHour: state.time.hour,
      expiresAtHour: state.time.hour + hardwareData.market.usedLotDays * HOURS_PER_DAY,
    });
    hardware.nextLotId += 1;
  }

  hardware.usedLots = lots;
  hardware.lastUsedMarketHour = state.time.hour;
  return hardware;
}

/**
 * Обновляет б/у рынок раз в неделю. Использует seeded RNG, поэтому набор
 * лотов одинаков при одном seed.
 */
export function refreshUsedMarket(
  state: GameState,
  force = false,
): { state: GameState; generated: boolean } {
  const last = state.hardware.lastUsedMarketHour;
  if (!force && last >= 0 && state.time.hour - last < WEEK_HOURS) {
    return { state, generated: false };
  }

  const next = cloneGame(state);
  next.hardware = buildUsedLots(next);
  return { state: next, generated: true };
}

/** Ежемесячное колебание цен магазина в пределах ±10%. */
export function driftMarketPrice(state: GameState): { state: GameState; mult: number } {
  const next = cloneGame(state);
  const spread = hardwareData.market.priceDriftPerMonth;
  const mult = Math.round((1 + (nextFloat(next.rng) * 2 - 1) * spread) * 1000) / 1000;
  next.hardware.marketPriceMult = mult;
  return { state: next, mult };
}

function repairHoursFor(state: GameState, componentId: string): { hours: number; spare: boolean } {
  const spareIndex = state.hardware.parts.findIndex((part) => part.componentId === componentId);
  if (spareIndex >= 0) {
    state.hardware.parts.splice(spareIndex, 1);
    // Сисадмин (этап 10) и мониторинг (этап 11) ускоряют ремонт.
    const speed = 1 - effectStrength(state, "repairSpeed") - researchBonuses(state).repairSpeed;
    return { hours: Math.max(1, Math.round(hardwareData.repair.hoursWithSpare * speed)), spare: true };
  }
  const speed = 1 - effectStrength(state, "repairSpeed") - researchBonuses(state).repairSpeed;
  return { hours: Math.max(1, Math.round(hardwareData.repair.hoursWithoutSpare * speed)), spare: false };
}

/**
 * Один игровой час железа: доставка, завершение сборки, ремонт, ежедневные
 * отказы и еженедельное обновление б/у рынка.
 */
export function tickHardware(state: GameState): { state: GameState; events: HardwareEvent[] } {
  let next = cloneGame(state);
  const events: HardwareEvent[] = [];
  const hour = next.time.hour;

  for (const order of next.hardware.orders) {
    if (order.status !== "inTransit" || hour < order.arriveAtHour) continue;
    order.status = "delivered";
    order.deliveredAtHour = hour;
    for (const line of order.lines) {
      for (let index = 0; index < line.quantity; index += 1) {
        next.hardware.parts.push({
          id: next.hardware.nextPartId,
          componentId: line.componentId,
          condition: line.condition,
          acquiredHour: hour,
          purchasePrice: line.unitPrice,
          orderId: order.id,
          defectAtHour:
            line.condition === "used" ? hiddenDefectAtHour(next.rng, hour) : null,
        });
        next.hardware.nextPartId += 1;
      }
    }
    events.push({ kind: "orderArrived", amount: order.total, ref: String(order.id) });
  }

  for (const build of next.hardware.builds) {
    if (build.status === "assembling" && hour >= build.readyAtHour) {
      build.status = "ready";
      assignFreeSlot(next, build);
      events.push({ kind: "buildCompleted", amount: buildValue(build), ref: String(build.id) });
    }
  }

  for (const build of next.hardware.builds) {
    if (build.status !== "ready") continue;
    for (const part of build.parts) {
      if (part.broken && part.repairDoneHour !== null && hour >= part.repairDoneHour) {
        part.broken = false;
        part.repairDoneHour = null;
        events.push({ kind: "partRepaired", ref: part.componentId });
      }
    }
  }

  if (hour % HOURS_PER_DAY === 0 && serversRunning(next)) {
    const failureRateMult = getDifficulty(next.difficulty).failureRateMult;
    for (const build of next.hardware.builds) {
      if (build.status !== "ready") continue;
      for (const part of build.parts) {
        if (part.broken) continue;
        const component = getComponent(part.componentId);
        const defectDue = part.defectAtHour !== null && hour >= part.defectAtHour;
        if (!defectDue) {
          const ageYears = Math.max(0, hour - part.installedAtHour) / HOURS_PER_YEAR;
          const probability = failureProbability(
            component,
            part.condition,
            ageYears,
            next.location.roomTempC,
            failureRateMult,
          );
          if (!chance(next.rng, probability)) continue;
        }

        part.broken = true;
        part.defectAtHour = null;
        const repair = repairHoursFor(next, part.componentId);
        part.repairDoneHour = hour + repair.hours;
        events.push({
          kind: "partFailed",
          ref: part.componentId,
          amount: repair.hours,
        });
      }
    }
  }

  const market = refreshUsedMarket(next);
  if (market.generated) {
    next = market.state;
    events.push({ kind: "usedMarketUpdated" });
  }

  return { state: next, events };
}
