import { describe, expect, it } from "vitest";
import { researchData, validateResearch, type ResearchId } from "../src/data";
import {
  advanceTicks,
  createGame,
  isServiceUnlocked,
  researchBonuses,
  startResearch,
  cancelResearch,
  tickResearch,
  type GameState,
} from "../src/sim";

function withResearch(state: GameState, ids: ResearchId[]): GameState {
  const next = structuredClone(state);
  next.research.completed.push(...ids);
  return next;
}

describe("research.json", () => {
  it("проходит валидацию", () => {
    expect(validateResearch(researchData)).toEqual([]);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(researchData);
    broken.rules.maxActive = 0;
    broken.projects[0]!.cost = 10;
    broken.projects[2]!.days = 0;
    const errors = validateResearch(broken);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("старт и отмена", () => {
  it("списывает деньги и ставит дедлайн", () => {
    const result = startResearch(createGame({ money: 5000 }), "virtualization");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(800);
    expect(result.state.money).toBeCloseTo(4200, 2);
    const entry = result.state.research.active[0]!;
    expect(entry.startedAtHour).toBe(0);
    expect(entry.completesAtHour).toBe(20 * 24); // 20 дней
  });

  it("не пускает без денег и без пререквизитов", () => {
    const poor = startResearch(createGame({ money: 100 }), "raidBackups");
    expect(poor.ok).toBe(false);
    if (poor.ok) return;
    expect(poor.failure.code).toBe("notEnoughMoney");

    const locked = startResearch(createGame({ money: 10000 }), "gameHosting");
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.failure.code).toBe("prerequisitesNotMet");
  });

  it("ограничивает два активных и не дублирует", () => {
    let state = createGame({ money: 20000 });
    const first = startResearch(state, "virtualization");
    state = first.ok ? first.state : state;
    const second = startResearch(state, "raidBackups");
    state = second.ok ? second.state : state;
    expect(state.research.active).toHaveLength(2);

    const third = startResearch(state, "monitoring");
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.failure.code).toBe("tooManyActive");

    const dup = startResearch(state, "virtualization");
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.failure.code).toBe("alreadyActive");
  });

  it("отменяет с возвратом половины", () => {
    let state = createGame({ money: 5000 });
    const started = startResearch(state, "virtualization");
    state = started.ok ? started.state : state;
    const cancelled = cancelResearch(state, "virtualization");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.refund).toBe(400);
    expect(cancelled.state.money).toBeCloseTo(4600, 2);
    expect(cancelled.state.research.active).toHaveLength(0);
  });
});

describe("завершение и эффекты", () => {
  it("завершает по дедлайну и открывает услугу", () => {
    let state = createGame({ money: 5000, seed: 7 });
    const started = startResearch(state, "virtualization");
    state = started.ok ? started.state : state;
    expect(isServiceUnlocked(state, "vps")).toBe(false);

    const after = advanceTicks(state, 20 * 24 + 1);
    expect(after.state.research.completed).toContain("virtualization");
    expect(after.state.research.active).toHaveLength(0);
    expect(after.events.some((event) => event.kind === "researchCompleted")).toBe(true);
    expect(isServiceUnlocked(after.state, "vps")).toBe(true);
    // Услуга добавлена в список с дефолтами и выключена.
    const vps = after.state.services.services.find((service) => service.id === "vps");
    expect(vps).toBeDefined();
    expect(vps!.enabled).toBe(false);
  });

  it("бонусы суммируются по завершённым", () => {
    expect(researchBonuses(createGame()).density).toBe(0);

    const virt = withResearch(createGame(), ["virtualization"]);
    expect(researchBonuses(virt).density).toBeCloseTo(0.3, 5);

    const both = withResearch(createGame(), ["virtualization", "orchestration"]);
    expect(researchBonuses(both).density).toBeCloseTo(0.55, 5);
  });

  it("трямкают tickResearch напрямую", () => {
    let state = createGame({ money: 5000 });
    const started = startResearch(state, "raidBackups");
    state = started.ok ? started.state : state;
    state.time.hour = 15 * 24; // дедлайн прошёл
    const events = tickResearch(state);
    expect(events.map((event) => event.kind)).toEqual(["researchCompleted"]);
    expect(state.research.completed).toContain("raidBackups");
  });

  it("игрок стартует только со стартовыми услугами", () => {
    const state = createGame();
    expect(state.services.services.map((service) => service.id)).toEqual([
      "landing",
      "cms",
      "chatbot",
    ]);
    expect(isServiceUnlocked(state, "vps")).toBe(false);
    expect(isServiceUnlocked(state, "landing")).toBe(true);
  });
});
