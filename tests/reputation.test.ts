import { describe, expect, it } from "vitest";
import { reputationData, validateReputation } from "../src/data";
import {
  advanceTicks,
  createGame,
  dailyDemand,
  HOURS_PER_MONTH,
  resolveTickets,
  tickReputationDay,
} from "../src/sim";
import type { GameState } from "../src/sim";

/** Включает все услуги и добавляет клиентов на стартовый сервер. */
function stateWithClients(seed = 1337, clients = 20): GameState {
  let state = createGame({ seed });
  state = advanceTicks(state, 24).state; // первый день: сервер уже стоит
  for (const service of state.services.services) {
    service.enabled = true;
  }
  state.services.services = [...state.services.services];
  const starter = state.hardware.builds[0]!;
  for (let index = 0; index < clients; index += 1) {
    const serviceId = ["landing", "cms", "chatbot"][index % 3]!;
    state.services.clients.push({
      id: index + 1,
      serviceId: serviceId as never,
      buildId: starter.id,
      sinceHour: 24,
      pricePerMonth: 4,
    });
  }
  state.services.nextClientId = clients + 1;
  return state;
}

describe("reputation.json", () => {
  it("проходит валидацию", () => {
    expect(validateReputation(reputationData)).toEqual([]);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(reputationData);
    broken.ema.weights.quality = 0.9;
    broken.tickets.perClientPerMonth = 5;
    broken.sla.uptimeReportDays = 28;
    const errors = validateReputation(broken);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("репутация и аптайм", () => {
  it("стартует с 0,7 и растёт при чистой работе", () => {
    expect(createGame().reputation.value).toBeCloseTo(0.7, 5);

    const state = stateWithClients();
    const after = advanceTicks(state, 24 * 10);
    expect(after.state.reputation.value).toBeGreaterThan(0.7);
    expect(after.state.reputation.hoursWithClients).toBeGreaterThan(0);
    expect(after.state.reputation.downtimeHours).toBe(0);
  });

  it("считает часы простоя при сломанной детали", () => {
    const state = stateWithClients();
    // Ломаем процессор стартового сервера: все клиенты без сервиса.
    state.hardware.builds = state.hardware.builds.map((build) => ({
      ...build,
      parts: build.parts.map((part) =>
        part.componentId === "cpu-vela-4" ? { ...part, broken: true } : part,
      ),
    }));
    const after = advanceTicks(state, 24);
    expect(after.state.reputation.downtimeHours).toBeGreaterThan(0);
    expect(after.state.reputation.downtimeHours).toBeLessThanOrEqual(24);
    expect(after.state.reputation.value).toBeLessThan(0.7);
  });

  it("аптайм месяца и SLA-штраф рассчитываются при закрытии месяца", () => {
    const state = stateWithClients();
    // Месяц с 720 часами клиентов и 696 часами работы: аптайм ~0,967.
    // Прогон от часа 24 до 720 закрывает месяц и пересчитывает аптайм
    // по фактическим часам прогона (клиенты есть все 696 часов).
    state.reputation.hoursWithClients = 720;
    state.reputation.downtimeHours = 24;
    state.reputation.goodHours = 696;
    const after = advanceTicks(state, HOURS_PER_MONTH - 24);
    const report = after.state.reputation.lastUptime;
    expect(report.length).toBe(3);
    // Аптайм месяца: 696/720 = 0,9667 ± ноль: ниже SLA 98% → событие slaMissed.
    expect(report.every((entry) => entry.uptime > 0.95 && entry.uptime < 0.99)).toBe(true);
    const missed = after.events.some((event) => event.kind === "slaMissed");
    expect(missed).toBe(true);
    // Отзыв существует и в пределах 1–5.
    expect(after.state.reputation.lastReviewRating).toBeGreaterThanOrEqual(1);
    expect(after.state.reputation.lastReviewRating).toBeLessThanOrEqual(5);
  });

  it("тикеты приходят по числу клиентов и закрываются пакетно", () => {
    const state = stateWithClients(777, 60);
    // 60 клиентов + 2 инцидента: λ = 0,1 + 1,0 — тикеты почти наверняка.
    const events = tickReputationDay(state, 2);
    expect(state.reputation.openTickets.length).toBeGreaterThan(0);
    expect(events.some((event) => event.kind === "ticketsOpened")).toBe(true);

    // Пакетное закрытие: одна кнопка — ноль открытых.
    const resolved = resolveTickets(state);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.state.reputation.openTickets).toHaveLength(0);
      expect(resolved.state.reputation.nextTicketId).toBeGreaterThan(1);

      const empty = resolveTickets(resolved.state);
      expect(empty.ok).toBe(false);
    }

  });

  it("спрос зависит от репутации", () => {
    const low = stateWithClients();
    const high = stateWithClients();
    low.reputation = { ...low.reputation, value: 0.2 };
    high.reputation = { ...high.reputation, value: 1.5 };

    const lowDemand = dailyDemand(low, "landing");
    const highDemand = dailyDemand(high, "landing");
    expect(highDemand).toBeGreaterThan(lowDemand);
    expect(highDemand / lowDemand).toBeCloseTo(Math.pow(1.5 / 0.2, 1.5), 5);
  });
});
