import { describe, expect, it } from "vitest";
import { balance } from "../src/data";
import { advanceTicks, createGame, setSpeed, togglePause } from "../src/sim";

describe("игровой цикл", () => {
  it("новая игра стартует на паузе со стартовыми деньгами", () => {
    const state = createGame();
    expect(state.time.paused).toBe(true);
    expect(state.time.speed).toBe(1);
    expect(state.time.hour).toBe(0);
    expect(state.money).toBe(balance.start.money);
    expect(state.seed).toBe(balance.start.seed);
  });

  it("не мутирует исходное состояние", () => {
    const state = createGame();
    const result = advanceTicks(state, 24);

    expect(state.time.hour).toBe(0);
    expect(state.stats.ticks).toBe(0);
    expect(state.events).toHaveLength(0);

    expect(result.state.time.hour).toBe(24);
    expect(result.state.stats.ticks).toBe(24);
  });

  it("тик равен игровому часу", () => {
    const result = advanceTicks(createGame(), 5);
    expect(result.ticks).toBe(5);
    expect(result.state.time.hour).toBe(5);
    expect(result.state.stats.ticks).toBe(5);
  });

  it("закрывает месяц на 30-е сутки и начинает новый день", () => {
    const result = advanceTicks(createGame(), 720);
    const kinds = result.state.events.map((event) => event.kind);

    expect(kinds.filter((kind) => kind === "dayStarted")).toHaveLength(30);
    expect(kinds.filter((kind) => kind === "monthClosed")).toHaveLength(1);

    const last = result.state.events[result.state.events.length - 1];
    const beforeLast = result.state.events[result.state.events.length - 2];
    expect(last).toMatchObject({ kind: "dayStarted", hour: 720 });
    expect(beforeLast).toMatchObject({ kind: "monthClosed", hour: 720 });
  });

  it("закрывает год на 12-м месяце", () => {
    const hoursPerYear = 30 * 12 * 24;
    const result = advanceTicks(createGame(), hoursPerYear);
    const kinds = result.state.events.map((event) => event.kind);
    expect(kinds.filter((kind) => kind === "yearClosed")).toHaveLength(1);
  });

  it("держит размер журнала событий в пределах лимита", () => {
    const result = advanceTicks(createGame(), 720 * 3);
    expect(result.state.events.length).toBeLessThanOrEqual(balance.limits.eventLogSize);
    expect(result.state.nextEventId).toBeGreaterThan(balance.limits.eventLogSize);
  });

  it("ноль тиков не меняет состояние", () => {
    const state = createGame();
    const result = advanceTicks(state, 0);
    expect(result.state).toBe(state);
    expect(result.ticks).toBe(0);
  });

  it("переключает скорости и паузу", () => {
    const running = setSpeed(createGame(), 20);
    expect(running.time.speed).toBe(20);
    expect(running.time.paused).toBe(false);

    const paused = togglePause(running);
    expect(paused.time.paused).toBe(true);
    expect(paused.time.speed).toBe(20);

    const resumed = togglePause(paused);
    expect(resumed.time.paused).toBe(false);

    const zero = setSpeed(running, 0);
    expect(zero.time.paused).toBe(true);
    expect(togglePause(zero)).toBe(zero);
  });

  it("даёт одинаковый результат при одинаковом seed", () => {
    const a = advanceTicks(createGame({ seed: 99 }), 100);
    const b = advanceTicks(createGame({ seed: 99 }), 100);
    expect(a.state).toEqual(b.state);
  });
});
