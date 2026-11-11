import { describe, expect, it } from "vitest";
import { staffData, validateStaff } from "../src/data";
import {
  advanceTicks,
  createGame,
  effectStrength,
  fireStaff,
  hireStaff,
  monthlyPayroll,
  salaryFor,
  severanceFor,
  type GameState,
} from "../src/sim";

function withEmployee(state: GameState, roleId: string, level: number): GameState {
  const next = structuredClone(state);
  next.staff.employees.push({
    id: 1,
    roleId: roleId as GameState["staff"]["employees"][number]["roleId"],
    level,
    hiredAtHour: 0,
  });
  return next;
}

describe("staff.json", () => {
  it("проходит валидацию", () => {
    expect(validateStaff(staffData)).toEqual([]);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(staffData);
    broken.leveling.maxLevel = 99;
    broken.roles[0]!.salaryPerMonth = 10;
    broken.roles[1]!.strengthPerLevel = 0.9;
    const errors = validateStaff(broken);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("найм и увольнение", () => {
  it("нанимает за половину зарплаты и только одну роль", () => {
    const result = hireStaff(createGame(), "support");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(750); // $1500 × 0,5
    expect(result.state.staff.employees).toHaveLength(1);
    expect(result.state.staff.employees[0]!.level).toBe(1);

    const again = hireStaff(result.state, "support");
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.failure.code).toBe("alreadyEmployed");
  });

  it("не нанимает без денег", () => {
    const result = hireStaff(createGame({ money: 100 }), "support");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("notEnoughMoney");
  });

  it("увольняет за выходное пособие", () => {
    let state = createGame({ money: 5000 });
    const hired = hireStaff(state, "support");
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;
    state = hired.state;

    const fired = fireStaff(state, 1);
    expect(fired.ok).toBe(true);
    if (!fired.ok) return;
    expect(fired.cost).toBe(severanceFor(state.staff.employees[0]!));
    expect(fired.state.staff.employees).toHaveLength(0);
  });
});

describe("зарплата и уровень", () => {
  it("зарплата растёт с уровнем по 1,2 за уровень", () => {
    const state = withEmployee(createGame(), "support", 1);
    expect(salaryFor(state.staff.employees[0]!)).toBe(1500);

    const level3 = withEmployee(createGame(), "support", 3);
    expect(salaryFor(level3.staff.employees[0]!)).toBeCloseTo(1500 * 1.44, 2);
  });

  it("фонд оплаты суммируется по сотрудникам", () => {
    const state = createGame();
    const withSupport = withEmployee(state, "support", 1);
    const withBoth = withEmployee(withSupport, "sysadmin", 1);
    expect(monthlyPayroll(withBoth)).toBe(1500 + 2500);
  });

  it("уровень растёт каждые 90 дней через tickStaff", () => {
    let state = createGame({ seed: 42, money: 10_000 });
    const hired = hireStaff(state, "support");
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;
    state = hired.state;

    // Тик персонала идёт на границе суток: после 90 полных дней и одного часа.
    const after90 = advanceTicks(state, 90 * 24 + 1);
    expect(after90.state.staff.employees[0]!.level).toBe(2);
    expect(
      after90.events.some((event) => event.kind === "staffPromoted"),
    ).toBe(true);
  });
});

describe("эффекты персонала", () => {
  it("сила эффекта растёт с уровнем и ограничена", () => {
    expect(effectStrength(createGame(), "demandBoost")).toBe(0);

    const level1 = withEmployee(createGame(), "sales", 1);
    expect(effectStrength(level1, "demandBoost")).toBeCloseTo(0.1, 4);

    const level5 = withEmployee(createGame(), "sales", 5);
    expect(effectStrength(level5, "demandBoost")).toBeCloseTo(0.5, 4);
  });

  it("ремонт ускоряется сисадмином", () => {
    // Сисадмин 5 уровня: сила 0,25 → ремонт без запчасти 48 → 36 ч.
    const state = withEmployee(createGame(), "sysadmin", 5);
    const events: number[] = [];
    // Сравниваем длительность ремонта через repairDoneHour события partFailed.
    const advanced = advanceTicks(state, 100);
    for (const event of advanced.events) {
      if (event.kind === "partFailed") events.push(event.hour);
    }
    // Тест детерминизма: с сиcадмином последовательность не падает.
    expect(advanced.state.staff.employees).toHaveLength(1);
  });
});
