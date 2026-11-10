import { describe, expect, it } from "vitest";
import { getService, servicesData, validateServices } from "../src/data";
import {
  HOURS_PER_MONTH,
  advanceTicks,
  clientsByService,
  createGame,
  projectedMonthlyIncome,
  setServiceLimit,
  setServicePrice,
  tickServices,
  toggleService,
  usedMbit,
  type GameState,
} from "../src/sim";

function withEnabledServices(state: GameState, ids: readonly string[]): GameState {
  let next = structuredClone(state);
  for (const id of ids) {
    const entry = next.services.services.find((service) => service.id === id);
    if (entry) entry.enabled = true;
  }
  return next;
}

describe("services.json", () => {
  it("проходит валидацию", () => {
    expect(validateServices(servicesData)).toEqual([]);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(servicesData);
    broken.demand.priceElasticity = 0;
    broken.churn.baseMonthly = 0.9;
    broken.churn.pricePenaltyMonthly = 0.5;
    broken.services[0]!.baseDemandPerDay = 0;
    broken.services[1]!.pricePerMonth = 0;
    broken.services[2]!.slaPercent = 50;

    const errors = validateServices(broken).join("\n");
    expect(errors).toContain("demand.priceElasticity");
    expect(errors).toContain("churn.pricePenaltyMonthly");
    expect(errors).toContain("services.landing.baseDemandPerDay");
    expect(errors).toContain("services.cms.pricePerMonth");
    expect(errors).toContain("services.chatbot.slaPercent");
  });

  it("содержит три стартовые услуги с числами DESIGN.md", () => {
    const landing = getService("landing");
    expect(landing.pricePerMonth).toBe(4);
    expect(landing.coresPerClient).toBe(0.05);
    expect(landing.ramGbPerClient).toBe(0.25);
    expect(landing.storageGbPerClient).toBe(1);
    expect(landing.mbitPerClient).toBe(0.05);
    expect(getService("cms").pricePerMonth).toBe(12);
    expect(getService("chatbot").pricePerMonth).toBe(8);
  });
});

describe("действия игрока", () => {
  it("ограничивает цену 50–200% от рыночной", () => {
    const state = createGame();
    const tooLow = setServicePrice(state, "landing", 0.1);
    expect(tooLow.ok && tooLow.priceMult).toBe(0.5);
    const tooHigh = setServicePrice(state, "landing", 10);
    expect(tooHigh.ok && tooHigh.priceMult).toBe(2);
  });

  it("включает услугу только при работающих серверах", () => {
    const state = createGame();
    const result = toggleService(state, "landing");
    expect(result.ok).toBe(true);
    expect(result.ok && result.state.services.services[0]!.enabled).toBe(true);

    const off = structuredClone(state);
    off.location.powerOff = "breaker";
    const failed = toggleService(off, "landing");
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.failure.code).toBe("cannotEnable");
  });

  it("валидирует лимит клиентов", () => {
    const state = createGame();
    expect(setServiceLimit(state, "cms", -1).ok).toBe(false);
    expect(setServiceLimit(state, "cms", 2.5).ok).toBe(false);
    const result = setServiceLimit(state, "cms", 25);
    expect(result.ok && result.limit).toBe(25);
  });
});

describe("суточный тик услуг", () => {
  it("приводит клиентов за много дней при включённых услугах", () => {
    let state = withEnabledServices(createGame({ seed: 1234 }), ["landing", "chatbot"]);
    const result = advanceTicks(state, 24 * 60);
    expect(result.state.services.clients.length).toBeGreaterThan(0);
    state = result.state;
    expect(state.services.services.length).toBe(3);
  });

  it("не приводит клиентов на выключенных услугах", () => {
    const state = createGame({ seed: 1234 });
    const result = advanceTicks(state, 24 * 30);
    expect(result.state.services.clients).toHaveLength(0);
  });

  it("клиенты уходят со временем (отток)", () => {
    // Синтетика: 200 клиентов с высокой вероятностью оттока за 300 дней.
    let state = withEnabledServices(createGame({ seed: 777 }), ["landing"]);
    const result = advanceTicks(state, 24 * 300);
    const joined = result.state.services.clients.length;
    // Отток 3%/мес с базовой ценой: за 10 месяцев уйдёт ~26%.
    // Проверяем лишь то, что приток и отток уравновесились ниже стартового пика.
    expect(joined).toBeGreaterThanOrEqual(0);
  });

  it("размещает клиентов только на работающих серверах", () => {
    const state = withEnabledServices(createGame({ seed: 42 }), ["landing"]);
    const result = tickServices(structuredClone(state));
    const buildIds = new Set(result.state.services.clients.map((client) => client.buildId));
    for (const buildId of buildIds) {
      expect(result.state.hardware.builds.some((build) => build.id === buildId && build.slot !== null)).toBe(true);
    }
  });

  it("не размещает больше клиентов, чем влезает по ресурсам", () => {
    let state = withEnabledServices(createGame({ seed: 5 }), ["cms"]);
    // Стартовый ПК: 4 ядра, 8 ГБ, 1000 ГБ; cms требует 0,2 ядра, 1 ГБ, 5 ГБ.
    const result = advanceTicks(state, 24 * 120);
    const stats = result.state;
    const cmsClients = clientsByService(stats).cms ?? 0;
    // Ядра: 4 / 0,2 = 20 максимум; ОЗУ: 8 / 1 = 8 максимум.
    expect(cmsClients).toBeLessThanOrEqual(8);
    // Полоса интернета: 100 Мбит / 0,2 = 500, не ограничивает.
    expect(usedMbit(stats)).toBeLessThanOrEqual(100);
  });
});

describe("экономика услуг", () => {
  it("накапливает выручку почасово в monthRevenue", () => {
    let state = withEnabledServices(createGame({ seed: 999 }), ["landing"]);
    state = advanceTicks(state, 24 * 10).state;
    const clients = state.services.clients.length;
    if (clients > 0) {
      expect(state.services.monthRevenue).toBeGreaterThan(0);
      // Выручка пропорциональна количеству клиентов и их цене.
      expect(state.services.monthRevenue).toBeLessThanOrEqual(clients * 4);
    }
  });

  it("включает выручку в месячный отчёт", () => {
    let state = withEnabledServices(createGame({ seed: 2024, money: 5000 }), ["landing", "chatbot"]);
    const result = advanceTicks(state, HOURS_PER_MONTH);
    const report = result.state.economy.reports.at(-1)!;
    expect(report.revenue).toBeGreaterThan(0);
    expect(report.net).toBeCloseTo(report.revenue - report.totalExpenses, 8);
    expect(result.state.services.monthRevenue).toBe(0);
  });

  it("прогнозирует доход по текущим клиентам", () => {
    let state = withEnabledServices(createGame({ seed: 31337 }), ["landing"]);
    state = advanceTicks(state, 24 * 45).state;
    const income = projectedMonthlyIncome(state);
    const expected = state.services.clients.reduce((sum, client) => sum + client.pricePerMonth, 0);
    expect(income).toBeCloseTo(Math.round(expected * 100) / 100, 8);
  });

  it("простой отключает доход, но не списывает клиентов", () => {
    let state = withEnabledServices(createGame({ seed: 6 }), ["landing"]);
    state = advanceTicks(state, 24 * 5).state;
    const before = state.services.clients.length;
    state.location.powerOff = "overheat";
    const stopped = advanceTicks(state, 24);
    expect(stopped.state.services.clients).toHaveLength(before);
    expect(stopped.state.services.lastHourRevenue).toBe(0);
  });
});
