import { describe, expect, it } from "vitest";
import { advanceTicks, botDay, createGame, summarizeDay } from "../src/sim";

/** Прогон ботом: сутки-тик + botDay, как в tools/balance-sim.mjs. */
function runBot(seed: number, days: number) {
  let state = createGame({ seed, difficulty: "normal" });
  let orderCount = 0;
  let buildCount = 0;
  let blocker = null as string | null;
  const summaries: ReturnType<typeof summarizeDay>[] = [];
  for (let day = 1; day <= days; day += 1) {
    state = advanceTicks(state, 24).state;
    const bot = botDay(state);
    state = bot.state;
    for (const decision of bot.decisions) {
      if (decision.kind === "orderServer") orderCount += 1;
      if (decision.kind === "buildServer") buildCount += 1;
    }
    if (bot.blocker) blocker = bot.blocker;
    summaries.push(summarizeDay(state, day));
  }
  return { state, orderCount, buildCount, blocker, summaries };
}

describe("balance-sim (бот)", () => {
  it("30 дней: не падает, деньги валидны, клиенты не отрицательные", () => {
    const { state, summaries } = runBot(1337, 30);
    for (const row of summaries) {
      expect(Number.isFinite(row.money)).toBe(true);
      expect(row.clients).toBeGreaterThanOrEqual(0);
      expect(row.servers).toBeGreaterThanOrEqual(1);
    }
    expect(state.gameOver).toBeNull();
    expect(summaries.at(-1)!.clients).toBeGreaterThan(0);
  });

  it("180 дней: бот покупает серверы и добирает клиентов", () => {
    const { orderCount, buildCount, summaries } = runBot(1337, 180);
    expect(orderCount).toBeGreaterThanOrEqual(1);
    expect(buildCount).toBeGreaterThanOrEqual(1);
    const last = summaries.at(-1)!;
    expect(last.clients).toBeGreaterThanOrEqual(50);
    expect(last.money).toBeGreaterThan(0);
    // С честными тарифами (гараж = commercial $0,09) бот успевает переехать
    // в гараж и набрать больше серверов; потолок — 12 слотов гаража.
    expect(last.servers).toBeLessThanOrEqual(12);
  });

  it("после заполнения слотов бот честно сообщает причину застоя", () => {
    const { blocker, summaries } = runBot(1337, 120);
    const last = summaries.at(-1)!;
    if (last.servers >= 2) {
      expect(blocker).toContain("слотов");
    }
  });

  it("разные seed дают воспроизводимые и живые прогоны", () => {
    const a = runBot(42, 60);
    const b = runBot(42, 60);
    const c = runBot(777, 60);
    expect(a.summaries.at(-1)!.money).toBe(b.summaries.at(-1)!.money);
    expect(c.summaries.at(-1)!.clients).toBeGreaterThan(0);
  });
});
