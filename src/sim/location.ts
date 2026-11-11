import {
  economy as economyData,
  getCooling,
  getLocationDefinition,
  locationData,
  type CoolingOption,
} from "../data";
import { buildNoiseDb, buildPowerW, noiseSum, roundMoney } from "./components";
import { getGameDate } from "./core/time";
import type { GameState, HardwareBuild, LocationState } from "./types";

export type LocationErrorCode =
  | "buildNotFound"
  | "buildNotReady"
  | "slotInvalid"
  | "slotBusy"
  | "coolingNotFound"
  | "notEnoughMoney"
  | "internetPlanNotFound"
  | "planNotAvailable"
  | "alreadyInsulated"
  | "powerNotOff"
  | "notOverheated"
  | "locationNotFound"
  | "locationNotAdjacent"
  | "alreadyMoving"
  | "alreadyOwned";

export interface LocationFailure {
  code: LocationErrorCode;
  params?: Record<string, string | number>;
}

export type LocationResult<T> = ({ ok: true } & T) | { ok: false; failure: LocationFailure };

export type LocationEventKind =
  | "breakerTripped"
  | "serversShutdown"
  | "serversRestarted"
  | "noiseComplaint"
  | "noiseFine"
  | "neighborsShutdown"
  | "locationMoved";

export interface LocationEvent {
  kind: LocationEventKind;
  amount?: number;
  ref?: string;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function cloneLocation(location: LocationState): LocationState {
  return { ...location, ownedCooling: location.ownedCooling.slice() };
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    rng: { ...state.rng },
    time: { ...state.time },
    location: cloneLocation(state.location),
    hardware: {
      ...state.hardware,
      parts: state.hardware.parts.map((part) => ({ ...part })),
      builds: state.hardware.builds.map((build) => ({
        ...build,
        parts: build.parts.map((part) => ({ ...part })),
      })),
      orders: state.hardware.orders.map((order) => ({
        ...order,
        lines: order.lines.map((line) => ({ ...line })),
      })),
      usedLots: state.hardware.usedLots.map((lot) => ({ ...lot })),
    },
  };
}

/** Наружная температура: сезонная кривая плюс суточный ход с пиком около 15:00. */
export function outsideTempFor(hour: number): number {
  const date = getGameDate(Math.max(0, hour));
  const { monthlyBaseC, dailyAmplitudeC } = locationData.climate;
  const base = monthlyBaseC[date.month - 1] ?? 15;
  const phase = Math.cos(((date.hourOfDay - 15) / 24) * Math.PI * 2);
  return round1(base + dailyAmplitudeC * phase);
}

/** Комнатная температура по DESIGN.md: T_room = T_outside + P_heat / C. */
export function roomTempFor(outsideTempC: number, heatW: number, coolingId: string): number {
  const cooling = getCooling(coolingId);
  const raw = outsideTempC + Math.max(0, heatW) / cooling.conductanceWPerK;
  return round1(Math.max(locationData.climate.minRoomTempC, raw));
}

/** Начальное состояние домашней локации. */
export function createLocation(loadW = economyData.start.itLoadW): LocationState {
  const definition = getLocationDefinition(economyData.start.location);
  const outsideTempC = outsideTempFor(0);
  return {
    id: definition.id,
    coolingId: definition.defaultCoolingId,
    ownedCooling: [definition.defaultCoolingId],
    internetPlanId: definition.defaultInternetPlanId,
    powerOff: "none",
    overloadHours: 0,
    irritation: 0,
    lastComplaintHour: -locationData.noise.minComplaintGapHours,
    lastFineHour: -locationData.noise.minComplaintGapHours,
    insulated: false,
    upsOwned: false,
    stabilizerOwned: false,
    movingUntilHour: null,
    outsideTempC,
    roomTempC: roomTempFor(outsideTempC, loadW, definition.defaultCoolingId),
  };
}

export function getLocation(state: GameState) {
  return getLocationDefinition(state.location.id);
}

export function getSelectedCooling(state: GameState): CoolingOption {
  return getCooling(state.location.coolingId);
}

/** Серверы физически могут работать: автомат не выбит, аварии нет. */
export function serversRunning(state: GameState): boolean {
  return state.location.powerOff === "none";
}

/** Сборки, которые стоят в слотах. */
export function placedBuilds(state: GameState): HardwareBuild[] {
  return state.hardware.builds
    .filter((build) => build.slot !== null)
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
}

/** Сборки, которые работают прямо сейчас. */
export function activeBuilds(state: GameState): HardwareBuild[] {
  if (!serversRunning(state)) return [];
  return state.hardware.builds.filter((build) => build.status === "ready" && build.slot !== null);
}

/** ИТ-нагрузка работающих серверов, Вт. */
export function hardwareLoadW(state: GameState): number {
  return activeBuilds(state).reduce((sum, build) => sum + buildPowerW(build), 0);
}

/** Потребление охлаждения, Вт. При выбитом автомате цепь обесточена полностью. */
export function coolingPowerW(state: GameState): number {
  if (state.location.powerOff === "breaker") return 0;
  return getSelectedCooling(state).powerW;
}

/** Полное потребление из сети: ИТ-нагрузка × PUE плюс явное охлаждение. */
export function totalPowerDrawW(state: GameState): number {
  const pue = economyData.electricity.pue[getLocation(state).id];
  return hardwareLoadW(state) * pue + coolingPowerW(state);
}

/** Ночной интервал, когда у соседей действует строгий лимит шума. */
export function isNight(hour: number): boolean {
  const { nightStartHour, nightEndHour } = locationData.noise;
  const hourOfDay = getGameDate(Math.max(0, hour)).hourOfDay;
  if (nightStartHour === nightEndHour) return true;
  if (nightStartHour > nightEndHour) {
    return hourOfDay >= nightStartHour || hourOfDay < nightEndHour;
  }
  return hourOfDay >= nightStartHour && hourOfDay < nightEndHour;
}

export function noiseLimitFor(hour: number): number {
  return isNight(hour) ? locationData.noise.nightLimitDb : locationData.noise.dayLimitDb;
}

/** Шум у соседей: серверы и охлаждение по логарифмической сумме минус изоляция. */
export function currentNoiseDb(state: GameState): number {
  const values = activeBuilds(state).map(buildNoiseDb);
  const cooling = getSelectedCooling(state);
  if (cooling.noiseDb > 0 && state.location.powerOff !== "breaker") values.push(cooling.noiseDb);
  const total = noiseSum(values);
  const reduction = state.location.insulated ? locationData.insulation.reductionDb : 0;
  return round1(Math.max(0, total - reduction));
}

/** Первый свободный слот или null, если места нет. */
export function firstFreeSlot(state: GameState): number | null {
  const definition = getLocation(state);
  const used = new Set(
    state.hardware.builds
      .filter((build) => build.slot !== null)
      .map((build) => build.slot as number),
  );
  for (let slot = 0; slot < definition.slots; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/**
 * Ставит сборку в первый свободный слот. Мутирует переданную сборку — вызывается
 * из tickHardware, когда состояние уже склонировано.
 */
export function assignFreeSlot(state: GameState, build: HardwareBuild): boolean {
  if (build.slot !== null) return true;
  const slot = firstFreeSlot(state);
  if (slot === null) return false;
  build.slot = slot;
  return true;
}

/** Перемещение сервера в слот или снятие со слота. */
export function setBuildSlot(
  state: GameState,
  buildId: number,
  slot: number | null,
): LocationResult<{ state: GameState }> {
  const build = state.hardware.builds.find((candidate) => candidate.id === buildId);
  if (!build) return { ok: false, failure: { code: "buildNotFound" } };
  if (build.status !== "ready") return { ok: false, failure: { code: "buildNotReady" } };

  const definition = getLocation(state);
  if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot >= definition.slots)) {
    return { ok: false, failure: { code: "slotInvalid", params: { slots: definition.slots } } };
  }

  const next = cloneState(state);
  const target = next.hardware.builds.find((candidate) => candidate.id === buildId);
  if (!target) return { ok: false, failure: { code: "buildNotFound" } };

  if (slot !== null) {
    for (const other of next.hardware.builds) {
      if (other.id !== buildId && other.slot === slot) other.slot = null;
    }
  }
  target.slot = slot;
  return { ok: true, state: next };
}

/** Смена охлаждения. Новый вариант покупается один раз. */
export function setCooling(
  state: GameState,
  coolingId: string,
): LocationResult<{ state: GameState; cost: number }> {
  const option = locationData.cooling.find((candidate) => candidate.id === coolingId);
  if (!option) return { ok: false, failure: { code: "coolingNotFound" } };
  if (state.location.coolingId === coolingId) {
    return { ok: true, state, cost: 0 };
  }

  const owned = state.location.ownedCooling.includes(coolingId);
  const cost = owned ? 0 : option.price;
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next = cloneState(state);
  next.money = roundMoney(next.money - cost);
  next.location.coolingId = coolingId;
  if (!owned) next.location.ownedCooling.push(coolingId);
  return { ok: true, state: next, cost };
}

/** Смена тарифа интернета в пределах доступных локации. */
export function setInternetPlan(
  state: GameState,
  planId: string,
): LocationResult<{ state: GameState }> {
  const definition = getLocation(state);
  if (!definition.internetPlans.includes(planId)) {
    return { ok: false, failure: { code: "planNotAvailable", params: { plan: planId } } };
  }
  if (state.location.internetPlanId === planId) {
    return { ok: true, state };
  }

  const next = cloneState(state);
  next.location.internetPlanId = planId;
  return { ok: true, state: next };
}

/** Шумоизоляция комнаты покупается один раз. */
export function buyInsulation(state: GameState): LocationResult<{ state: GameState; cost: number }> {
  if (state.location.insulated) {
    return { ok: false, failure: { code: "alreadyInsulated" } };
  }
  const cost = locationData.insulation.price;
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next = cloneState(state);
  next.money = roundMoney(next.money - cost);
  next.location.insulated = true;
  return { ok: true, state: next, cost };
}

/** ИБП покупается один раз и держит блэкауты до 4 часов (этап 9). */
export function buyUps(state: GameState): LocationResult<{ state: GameState; cost: number }> {
  if (state.location.upsOwned) {
    return { ok: false, failure: { code: "alreadyOwned" } };
  }
  const cost = locationData.ups.price;
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next = cloneState(state);
  next.money = roundMoney(next.money - cost);
  next.location.upsOwned = true;
  return { ok: true, state: next, cost };
}

/** Стабилизатор напряжения гасит «скачок напряжения» (этап 9). */
export function buyStabilizer(state: GameState): LocationResult<{ state: GameState; cost: number }> {
  if (state.location.stabilizerOwned) {
    return { ok: false, failure: { code: "alreadyOwned" } };
  }
  const cost = locationData.stabilizer.price;
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next = cloneState(state);
  next.money = roundMoney(next.money - cost);
  next.location.stabilizerOwned = true;
  return { ok: true, state: next, cost };
}

/**
 * Переезд в новую локацию (DESIGN.md §4.1). Серверы переезжают вместе
 * с игроком и автоматически расставляются по новым слотам; 24 часа
 * простоя на перекладку. Охлаждение и тариф — дефолты новой локации.
 */
export function moveLocation(
  state: GameState,
  locationId: string,
): LocationResult<{ state: GameState; cost: number }> {
  const definition = locationData.locations.find((candidate) => candidate.id === locationId);
  if (!definition) {
    return { ok: false, failure: { code: "locationNotFound", params: { plan: locationId } } };
  }
  if (state.location.id === locationId) {
    return { ok: false, failure: { code: "locationNotFound" } };
  }
  // Переезд доступен только на следующую локацию (дом → гараж).
  const order = ["home", "garage", "colo", "datacenter"];
  const currentIndex = order.indexOf(state.location.id);
  const targetIndex = order.indexOf(definition.id);
  if (targetIndex !== currentIndex + 1) {
    return { ok: false, failure: { code: "locationNotAdjacent", params: { plan: locationId } } };
  }
  if (state.location.movingUntilHour !== null) {
    return { ok: false, failure: { code: "alreadyMoving" } };
  }

  const cost = locationData.moving.price;
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next = cloneState(state);
  next.money = roundMoney(next.money - cost);
  next.location.id = definition.id;
  next.location.coolingId = definition.defaultCoolingId;
  next.location.ownedCooling = [definition.defaultCoolingId];
  next.location.internetPlanId = definition.defaultInternetPlanId;
  next.location.powerOff = "moving";
  next.location.movingUntilHour = next.time.hour + locationData.moving.downtimeHours;
  next.location.insulated = false;
  next.location.irritation = 0;
  next.location.overloadHours = 0;
  // Серверы снимаются со старых слотов: tickLocation расставит по новым.
  next.hardware.builds = next.hardware.builds.map((build) => ({ ...build, slot: null }));
  return { ok: true, state: next, cost };
}

/** Ручной сброс автомата после перегруза. */
export function resetBreaker(state: GameState): LocationResult<{ state: GameState }> {
  if (state.location.powerOff !== "breaker") {
    return { ok: false, failure: { code: "powerNotOff" } };
  }
  const next = cloneState(state);
  next.location.powerOff = "none";
  next.location.overloadHours = 0;
  return { ok: true, state: next };
}

/** Ручной запуск серверов после аварийного отключения или требования соседей. */
export function restartServers(state: GameState): LocationResult<{ state: GameState }> {
  if (state.location.powerOff !== "overheat" && state.location.powerOff !== "neighbors") {
    return { ok: false, failure: { code: "powerNotOff" } };
  }
  if (
    state.location.powerOff === "overheat" &&
    state.location.roomTempC >= locationData.climate.throttleC
  ) {
    return { ok: false, failure: { code: "notOverheated" } };
  }

  const next = cloneState(state);
  next.location.powerOff = "none";
  return { ok: true, state: next };
}

/**
 * Один игровой час локации: температура, автомат, аварийное отключение,
 * шум и раздражение соседей.
 */
export function tickLocation(state: GameState): { state: GameState; events: LocationEvent[] } {
  const next: GameState = {
    ...state,
    location: cloneLocation(state.location),
  };
  const events: LocationEvent[] = [];
  const hour = next.time.hour;
  const definition = getLocation(next);
  const climate = locationData.climate;
  const noiseSpec = locationData.noise;

  const load = hardwareLoadW(next);
  next.location.outsideTempC = outsideTempFor(hour);
  next.location.roomTempC = roomTempFor(next.location.outsideTempC, load, next.location.coolingId);

  // Переезд закончился: серверы автоматически занимают слоты новой локации.
  if (next.location.powerOff === "moving" && next.location.movingUntilHour !== null) {
    if (hour >= next.location.movingUntilHour) {
      next.location.powerOff = "none";
      next.location.movingUntilHour = null;
      for (const build of next.hardware.builds) {
        if (build.status === "ready") assignFreeSlot(next, build);
      }
      events.push({ kind: "locationMoved" });
    }
    return { state: next, events };
  }

  if (next.location.powerOff === "none") {
    if (load > definition.powerCapacityW) {
      next.location.overloadHours += 1;
      if (next.location.overloadHours > locationData.breakerGraceHours) {
        next.location.powerOff = "breaker";
        next.location.overloadHours = 0;
        events.push({ kind: "breakerTripped", amount: load });
      }
    } else {
      next.location.overloadHours = 0;
    }

    if (next.location.powerOff === "none" && next.location.roomTempC > climate.shutdownC) {
      next.location.powerOff = "overheat";
      events.push({
        kind: "serversShutdown",
        amount: next.location.roomTempC,
        ref: "overheat",
      });
    }
  }

  const noise = currentNoiseDb(next);
  const limit = isNight(hour) ? noiseSpec.nightLimitDb : noiseSpec.dayLimitDb;

  if (isNight(hour) && noise > limit) {
    next.location.irritation += (noise - limit) * noiseSpec.irritationPerDbHour;
  } else {
    next.location.irritation -= noiseSpec.irritationDecayPerHour;
  }
  next.location.irritation = Math.min(100, Math.max(0, next.location.irritation));

  if (next.location.irritation >= noiseSpec.shutdownAt && next.location.powerOff === "none") {
    next.location.powerOff = "neighbors";
    events.push({ kind: "neighborsShutdown", amount: round1(next.location.irritation) });
    next.location.irritation = noiseSpec.fineAt;
  } else if (
    next.location.irritation >= noiseSpec.fineAt &&
    hour - next.location.lastFineHour >= noiseSpec.minComplaintGapHours
  ) {
    next.location.lastFineHour = hour;
    next.money = roundMoney(next.money - noiseSpec.fineAmount);
    events.push({ kind: "noiseFine", amount: noiseSpec.fineAmount });
    next.location.irritation = Math.max(0, next.location.irritation - noiseSpec.fineAt / 2);
  } else if (
    next.location.irritation >= noiseSpec.complaintAt &&
    hour - next.location.lastComplaintHour >= noiseSpec.minComplaintGapHours
  ) {
    next.location.lastComplaintHour = hour;
    events.push({ kind: "noiseComplaint", amount: noise });
  }

  return { state: next, events };
}
