import { describe, expect, it } from "vitest";
import { eventsData, validateEvents } from "../src/data";
import {
  advanceTicks,
  createGame,
  hourlyElectricityCost,
  rollDailyEvents,
  tickWorldEvents,
  type GameState,
} from "../src/sim";

/** Состояние с работающими серверами и клиентами. */
function runningState(seed = 1337): GameState {
  let state = createGame({ seed });
  state = advanceTicks(state, 24).state;
  const starter = state.hardware.builds[0]!;
  state.services.clients.push({
    id: 1,
    serviceId: "landing",
    buildId: starter.id,
    sinceHour: 24,
    pricePerMonth: 4,
  });
  state.services.nextClientId = 2;
  for (const service of state.services.services) service.enabled = true;
  state.services.services = [...state.services.services];
  return state;
}

describe("events.json", () => {
  it("проходит валидацию", () => {
    expect(validateEvents(eventsData)).toEqual([]);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(eventsData);
    broken.blackout.chancePerDay = 0.5;
    broken.ddos.maxHours = 0;
    broken.electricityPriceSpike.priceMult = 1;
    const errors = validateEvents(broken);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("мировые события", () => {
  it("стабильный seed даёт одинаковую последовательность", () => {
    let a = runningState(42);
    let b = runningState(42);
    a = rollDailyEvents(a, 1) && a;
    b = rollDailyEvents(b, 1) && b;
    expect(a.world.active.length).toBe(b.world.active.length);
    expect(a.location.powerOff).toBe(b.location.powerOff);
  });

  it("блэкаут отключает питание и возвращается по истечении", () => {
    let state = runningState();
    state.world.active.push({
      id: state.world.nextActiveEventId,
      kind: "blackout",
      startedAtHour: state.time.hour,
      endAtHour: state.time.hour + 3,
    });
    state.world.nextActiveEventId += 1;
    state.location.powerOff = "blackout";

    const hour1 = tickWorldEvents(state);
    expect(state.world.active).toHaveLength(1);
    expect(hour1).toHaveLength(0);

    state.time.hour = state.time.hour + 3;
    const hour2 = tickWorldEvents(state);
    expect(state.world.active).toHaveLength(0);
    expect(state.location.powerOff).toBe("none");
    expect(hour2.some((event) => event.kind === "blackoutEnded")).toBe(true);
  });

  it("блэкаут в advanceTicks останавливает выручку и возвращает её", () => {
    const state = runningState();
    // Выручка за час: клиент $4/мес = $4/720 в час.
    const injected = structuredClone(state);
    injected.location.powerOff = "blackout";
    const during = advanceTicks(injected, 1);
    expect(during.state.services.lastHourRevenue).toBe(0);

    const after = advanceTicks(state, 1);
    expect(after.state.services.lastHourRevenue).toBeGreaterThan(0);
    expect(after.state.services.monthRevenue).toBeGreaterThan(0);
  });

  it("скачок цены электричества повышает стоимость и истекает", () => {
    const state = runningState();
    const base = hourlyElectricityCost(state);

    const spiky = structuredClone(state);
    spiky.world.electricityPriceEventMult = 1.3;
    spiky.world.electricityPriceEventHoursLeft = 2;
    const spiked = hourlyElectricityCost(spiky);
    expect(spiked / base).toBeCloseTo(1.3, 5);

    let withSpike = structuredClone(state);
    withSpike.world.electricityPriceEventMult = 1.3;
    withSpike.world.electricityPriceEventHoursLeft = 2;
    tickWorldEvents(withSpike);
    tickWorldEvents(withSpike);
    expect(withSpike.world.electricityPriceEventHoursLeft).toBe(0);
    expect(withSpike.world.electricityPriceEventMult).toBe(1);
  });

  it("долгий прогон не ломает состояние и события появляются", () => {
    let state = runningState(999);
    const seen = new Set<string>();
    for (let day = 0; day < 120; day += 1) {
      const result = advanceTicks(state, 24);
      state = result.state;
      for (const event of result.events) seen.add(event.kind);
      expect(Number.isFinite(state.money)).toBe(true);
      expect(state.world.active.length).toBeLessThanOrEqual(3);
    }
    // За 120 дней хотя бы одно мировое событие должно случиться.
    const worldKinds = [
      "blackoutStarted",
      "voltageSpike",
      "ddosStarted",
      "channelFailureStarted",
      "clientHacked",
      "electricityPriceSpiked",
    ];
    expect(worldKinds.some((kind) => seen.has(kind))).toBe(true);
  });
});
