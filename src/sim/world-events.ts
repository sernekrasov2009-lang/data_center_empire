import { eventsData } from "../data";
import { chance, nextFloat, nextInt } from "./core/rng";
import { HOURS_PER_MONTH } from "./core/time";
import type { ActiveEventState, GameState, WorldEventsState } from "./types";

export type WorldEventKind =
  | "blackoutStarted"
  | "blackoutEnded"
  | "voltageSpike"
  | "ddosStarted"
  | "ddosEnded"
  | "channelFailureStarted"
  | "channelFailureEnded"
  | "clientHacked"
  | "electricityPriceSpiked";

export interface WorldEvent {
  kind: WorldEventKind;
  amount?: number;
  ref?: string;
}

/** Стартовое состояние мировых событий: всё спокойно. */
export function createWorldEvents(): WorldEventsState {
  return {
    active: [],
    nextActiveEventId: 1,
    electricityPriceEventMult: 1,
    electricityPriceEventHoursLeft: 0,
  };
}

export function cloneWorldEvents(world: WorldEventsState): WorldEventsState {
  return {
    ...world,
    active: world.active.map((event) => ({ ...event })),
  };
}

/** Месяц «летний» для повышенной вероятности блэкаута: июнь–август. */
function isSummerMonth(month: number): boolean {
  return month >= 6 && month <= 8;
}

function hasActive(world: WorldEventsState, kind: ActiveEventState["kind"]): boolean {
  return world.active.some((event) => event.kind === kind);
}

function startEvent(
  state: GameState,
  kind: ActiveEventState["kind"],
  hours: number,
): ActiveEventState {
  const event: ActiveEventState = {
    id: state.world.nextActiveEventId,
    kind,
    startedAtHour: state.time.hour,
    endAtHour: state.time.hour + hours,
  };
  state.world.nextActiveEventId += 1;
  state.world.active.push(event);
  return event;
}

/**
 * Суточный ролл мировых событий (DESIGN.md §7): блэкаут, скачок
 * напряжения, DDoS, сбой канала, взлом, скачок цены электричества.
 * Роллится только если серверы вообще стоят — иначе не о чем.
 */
export function rollDailyEvents(state: GameState, month: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  const world = state.world;
  const hour = state.time.hour;
  const running = state.hardware.builds.some((build) => build.slot !== null);
  if (!running) return events;

  // Отключение электричества: 0,3%/день, летом 0,6%.
  if (!hasActive(world, "blackout") && state.location.powerOff !== "breaker") {
    const blackoutChance = isSummerMonth(month)
      ? eventsData.blackout.summerChancePerDay
      : eventsData.blackout.chancePerDay;
    if (chance(state.rng, blackoutChance)) {
      const hours = nextInt(
        state.rng,
        eventsData.blackout.minHours,
        eventsData.blackout.maxHours,
      );
      startEvent(state, "blackout", hours);
      state.location.powerOff = "blackout";
      events.push({ kind: "blackoutStarted", amount: hours });
    }
  }

  // Скачок напряжения: ломает БП случайного работающего сервера.
  if (chance(state.rng, eventsData.voltageSpike.chancePerDay)) {
    const psuBuilds = state.hardware.builds
      .filter(
        (build) => build.slot !== null && build.parts.some((part) => part.componentId.startsWith("psu-")),
      )
      .map((build) => ({
        build,
        psu: build.parts.find((part) => part.componentId.startsWith("psu-") && !part.broken),
      }))
      .filter((entry) => entry.psu !== undefined);
    if (psuBuilds.length > 0) {
      const entry = psuBuilds[Math.floor(nextFloat(state.rng) * psuBuilds.length)];
      if (entry) {
      const target = entry.build;
      const psu = entry.psu!;
      if (psu && !psu.broken) {
        psu.broken = true;
        psu.repairDoneHour = hour + 48; // ремонт БП без запчасти: 48 ч
      events.push({ kind: "voltageSpike", ref: String(target.id) });
      }
    }
  }
  }

  // DDoS: 0,5%/день + рост с репутацией выше 0,7.
  if (!hasActive(world, "ddos")) {
    const reputationExcess = Math.max(
      0,
      state.reputation.value - eventsData.ddos.reputationFrom,
    );
    const ddosChance =
      eventsData.ddos.chancePerDay + reputationExcess * 100 * eventsData.ddos.reputationGrowthPerPoint;
    if (chance(state.rng, ddosChance)) {
      const hours = nextInt(state.rng, eventsData.ddos.minHours, eventsData.ddos.maxHours);
      startEvent(state, "ddos", hours);
      events.push({ kind: "ddosStarted", amount: hours });
    }
  }

  // Сбой канала провайдера: 0,4%/день.
  if (!hasActive(world, "channelFailure") && state.location.powerOff === "none") {
    if (chance(state.rng, eventsData.channelFailure.chancePerDay)) {
      const hours = nextInt(
        state.rng,
        eventsData.channelFailure.minHours,
        eventsData.channelFailure.maxHours,
      );
      startEvent(state, "channelFailure", hours);
      state.location.powerOff = "channelFailure";
      events.push({ kind: "channelFailureStarted", amount: hours });
    }
  }

  // Взлом клиента: репутационный удар.
  if (state.services.clients.length > 0 && chance(state.rng, eventsData.clientHacked.chancePerDay)) {
    state.reputation.value = Math.max(
      0.2,
      state.reputation.value - eventsData.clientHacked.reputationHit,
    );
    events.push({ kind: "clientHacked", amount: eventsData.clientHacked.reputationHit });
  }

  // Скачок цены электричества: +30% на 1–3 месяца.
  if (world.electricityPriceEventHoursLeft === 0 && chance(state.rng, eventsData.electricityPriceSpike.chancePerDay)) {
    const months = nextInt(
      state.rng,
      eventsData.electricityPriceSpike.minMonths,
      eventsData.electricityPriceSpike.maxMonths,
    );
    world.electricityPriceEventMult = eventsData.electricityPriceSpike.priceMult;
    world.electricityPriceEventHoursLeft = months * HOURS_PER_MONTH;
    events.push({ kind: "electricityPriceSpiked", amount: months });
  }

  return events;
}

/**
 * Часовой тик мировых событий: снимает истёкшие, возвращает питание,
 * тикает множитель цены электричества.
 */
export function tickWorldEvents(state: GameState): WorldEvent[] {
  const events: WorldEvent[] = [];
  const world = state.world;
  const hour = state.time.hour;

  const remaining: ActiveEventState[] = [];
  for (const event of world.active) {
    if (hour < event.endAtHour) {
      remaining.push(event);
      continue;
    }
    // Событие истекло.
    if (event.kind === "blackout" && state.location.powerOff === "blackout") {
      state.location.powerOff = "none";
      events.push({ kind: "blackoutEnded" });
    } else if (event.kind === "channelFailure" && state.location.powerOff === "channelFailure") {
      state.location.powerOff = "none";
      events.push({ kind: "channelFailureEnded" });
    } else if (event.kind === "ddos") {
      events.push({ kind: "ddosEnded" });
    }
  }
  world.active = remaining;

  if (world.electricityPriceEventHoursLeft > 0) {
    world.electricityPriceEventHoursLeft -= 1;
    if (world.electricityPriceEventHoursLeft === 0) {
      world.electricityPriceEventMult = 1;
    }
  }

  return events;
}
