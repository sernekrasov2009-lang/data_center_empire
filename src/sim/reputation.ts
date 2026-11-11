import { getService, reputationData, type ServiceId } from "../data";
import { nextFloat } from "./core/rng";
import { DAYS_PER_MONTH } from "./core/time";
import { activeBuilds, cloneState } from "./location";
import { effectStrength } from "./staff";
import { samplePoisson } from "./services";
import type { GameState, ReputationState, ServiceUptime } from "./types";

export type ReputationEventKind =
  | "ticketsOpened"
  | "ticketsResolved"
  | "reputationChanged"
  | "reviewPosted"
  | "slaMissed";

export interface ReputationEvent {
  kind: ReputationEventKind;
  amount?: number;
  ref?: string;
}

export type ReputationErrorCode = "nothingToResolve";

export interface ReputationFailure {
  code: ReputationErrorCode;
}

export type ReputationResult<T> = ({ ok: true } & T) | { ok: false; failure: ReputationFailure };

/** Стартовое состояние: репутация из данных, месяц пустой, тикетов нет. */
export function createReputation(): ReputationState {
  return {
    value: reputationData.ema.start,
    downtimeHours: 0,
    poorQualityHours: 0,
    hoursWithClients: 0,
    goodHours: 0,
    openTickets: [],
    nextTicketId: 1,
    lastUptime: [],
    lastReviewRating: null,
  };
}

export function cloneReputation(reputation: ReputationState): ReputationState {
  return {
    ...reputation,
    openTickets: reputation.openTickets.map((ticket) => ({ ...ticket })),
    lastUptime: reputation.lastUptime.map((entry) => ({ ...entry })),
  };
}

/** Работающие серверы: слот занят, статус ready, без сломанных деталей. */
export function operationalBuildIds(state: GameState): Set<number> {
  const ids = new Set<number>();
  for (const build of activeBuilds(state)) {
    if (!build.parts.some((part) => part.broken)) ids.add(build.id);
  }
  return ids;
}

/**
 * Один игровой час репутации: копит часы простоя и качества по факту.
 * Вызывается из движка каждый тик; состояние уже склонировано и мутируется.
 */
export function tickReputationHour(state: GameState): void {
  const reputation = state.reputation;
  const clients = state.services.clients;
  if (clients.length === 0) return;

  const operational = operationalBuildIds(state);
  reputation.hoursWithClients += 1;

  // Хоть один клиент без работающего сервера — час простоя компании.
  const degraded = clients.some((client) => !operational.has(client.buildId));
  if (degraded) {
    reputation.downtimeHours += 1;
  }

  // Качество: серверы работают и температура ниже троттлинга.
  const qualityOk =
    state.location.powerOff === "none" &&
    state.location.roomTempC < reputationData.quality.throttleTempC;
  if (qualityOk && !degraded) {
    reputation.goodHours += 1;
  } else {
    reputation.poorQualityHours += 1;
  }
}

/** Доля часов простоя за период с клиентами (для EMA и аптайма на панели). */
function dailyDowntimeShare(state: GameState): number {
  const { hoursWithClients, downtimeHours } = state.reputation;
  if (hoursWithClients === 0) return 0;
  return Math.min(1, downtimeHours / hoursWithClients);
}

/**
 * Суточный тик репутации: EMA по DESIGN.md §6 и новые тикеты
 * (клиенты × ставка/мес + 0,5 × инциденты отказов за день).
 */
export function tickReputationDay(
  state: GameState,
  incidentsPerDay: number,
): ReputationEvent[] {
  const events: ReputationEvent[] = [];
  const reputation = state.reputation;

  const totalClients = state.services.clients.length;
  const downtimeShare = dailyDowntimeShare(state);
  const qualityShare =
    reputation.hoursWithClients > 0
      ? Math.min(1, reputation.goodHours / reputation.hoursWithClients)
      : 1;
  const openTickets = reputation.openTickets.length;
  // Поддержка (этап 10): штраф тикетов слабее — каждые 14 открытых вместо 10.
  const ticketsPerPenalty = 10 + Math.round(effectStrength(state, "supportScore") * 4);
  const supportScore = Math.max(
    0,
    1 - Math.floor(openTickets / ticketsPerPenalty) * reputationData.tickets.scorePenaltyPer10Open,
  );

  const weights = reputationData.ema.weights;
  const dailyScore =
    weights.uptime * (1 - downtimeShare) +
    weights.quality * qualityShare +
    weights.support * supportScore;

  const alpha = 1 / reputationData.ema.windowDays;
  const next = Math.min(
    reputationData.ema.max,
    Math.max(reputationData.ema.min, reputation.value + alpha * (dailyScore - reputation.value)),
  );
  const rounded = Math.round(next * 10000) / 10000;
  if (rounded !== reputation.value) {
    reputation.value = rounded;
    events.push({ kind: "reputationChanged", amount: rounded });
  }

  // Тикеты: базовый поток от числа клиентов плюс 0,5 × инциденты.
  const lambda =
    (totalClients * reputationData.tickets.perClientPerMonth) / DAYS_PER_MONTH +
    reputationData.tickets.perIncidentPerClient * incidentsPerDay;
  if (lambda > 0) {
    const arrived = samplePoisson(state.rng, lambda);
    const room = reputationData.tickets.maxOpen - reputation.openTickets.length;
    const added = Math.min(arrived, Math.max(0, room));
    for (let index = 0; index < added; index += 1) {
      const client =
        state.services.clients.length > 0
          ? state.services.clients[Math.floor(nextFloat(state.rng) * state.services.clients.length)]
          : null;
      reputation.openTickets.push({
        id: reputation.nextTicketId,
        openedHour: state.time.hour,
        clientId: client ? client.id : null,
      });
      reputation.nextTicketId += 1;
    }
    if (added > 0) {
      events.push({ kind: "ticketsOpened", amount: added });
    }
  }

  return events;
}

/**
 * Закрытие месяца: аптайм по услугам, SLA-штраф оттока, отзыв.
 * Накопители месяца обнуляются. События получает движок.
 */
export function closeMonthReputation(state: GameState): {
  events: ReputationEvent[];
  /** Дополнительный месячный отток по услугам из-за нарушения SLA, доля. */
  slaPenalty: Partial<Record<ServiceId, number>>;
} {
  const events: ReputationEvent[] = [];
  const reputation = state.reputation;
  const hoursWithClients = reputation.hoursWithClients;

  const companyUptime = hoursWithClients > 0 ? 1 - reputation.downtimeHours / hoursWithClients : 1;
  const slaPenalty: Partial<Record<ServiceId, number>> = {};
  const uptime: ServiceUptime[] = [];

  for (const entry of state.services.services) {
    const definition = getService(entry.id);
    const clients = state.services.clients.filter((client) => client.serviceId === entry.id);
    if (clients.length === 0) {
      uptime.push({ serviceId: entry.id, uptime: 1 });
      continue;
    }
    const uptimeValue = Math.max(0, Math.min(1, companyUptime));
    uptime.push({ serviceId: entry.id, uptime: uptimeValue });

    // SLA: +1%/мес оттока за каждые 0,1% ниже обещанного аптайма (DESIGN §5.3).
    const deficit = definition.slaPercent / 100 - uptimeValue;
    if (deficit > 0) {
      const points = Math.floor(deficit / 0.001);
      const penalty = points * reputationData.sla.churnPerDailyPoint;
      if (points > 0) {
        slaPenalty[entry.id] = penalty;
        events.push({ kind: "slaMissed", amount: points, ref: entry.id });
      }
    }
  }
  reputation.lastUptime = uptime;

  // Отзыв: рейтинг 1–5 из аптайма и нормированной репутации.
  const avgUptime =
    uptime.length > 0 ? uptime.reduce((sum, entry) => sum + entry.uptime, 0) / uptime.length : 1;
  const normalizedReputation =
    (reputation.value - reputationData.ema.min) / (reputationData.ema.max - reputationData.ema.min);
  const rating = Math.min(
    5,
    Math.max(1, Math.round((1 + 4 * (0.5 * avgUptime + 0.5 * normalizedReputation)) * 10) / 10),
  );
  reputation.lastReviewRating = rating;
  events.push({ kind: "reviewPosted", amount: rating });

  reputation.downtimeHours = 0;
  reputation.poorQualityHours = 0;
  reputation.hoursWithClients = 0;
  reputation.goodHours = 0;

  return { events, slaPenalty };
}

/** Действие игрока: закрыть все открытые тикеты одной кнопкой (DESIGN §15.6). */
export function resolveTickets(
  state: GameState,
): ReputationResult<{ state: GameState; resolved: number }> {
  if (state.reputation.openTickets.length === 0) {
    return { ok: false, failure: { code: "nothingToResolve" } };
  }
  const next = cloneState(state);
  const resolved = next.reputation.openTickets.length;
  next.reputation.openTickets = [];
  return { ok: true, state: next, resolved };
}
