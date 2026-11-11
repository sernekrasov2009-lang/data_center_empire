import { staffData, type StaffEffect } from "../data";
import { roundMoney } from "./components";
import { HOURS_PER_DAY } from "./core/time";
import type { GameState, StaffMember, StaffState } from "./types";

/**
 * Персонал (этап 10, DESIGN.md §8). Чистая логика над GameState:
 * найм/увольнение, рост уровней со стажем, суммарные эффекты по ролям.
 */

export type StaffErrorCode =
  | "roleNotFound"
  | "alreadyEmployed"
  | "notEnoughMoney"
  | "employeeNotFound";

export interface StaffFailure {
  code: StaffErrorCode;
  params?: Record<string, string | number>;
}

export type StaffResult<T> = ({ ok: true } & T) | { ok: false; failure: StaffFailure };

export interface StaffEvent {
  kind: "staffHired" | "staffFired" | "staffPromoted";
  amount?: number;
  ref?: string;
}

export function createStaff(): StaffState {
  return { employees: [], nextEmployeeId: 1 };
}

export function cloneStaff(staff: StaffState): StaffState {
  return {
    employees: staff.employees.map((employee) => ({ ...employee })),
    nextEmployeeId: staff.nextEmployeeId,
  };
}

/** Зарплата сотрудника: базовая × 1,2^(уровень − 1). */
export function salaryFor(employee: StaffMember): number {
  const role = staffData.roles.find((candidate) => candidate.id === employee.roleId)!;
  return roundMoney(
    role.salaryPerMonth * Math.pow(staffData.leveling.salaryPerLevelMult, employee.level - 1),
  );
}

/** Суммарная месячная зарплата всех сотрудников (в счёт за месяц). */
export function monthlyPayroll(state: GameState): number {
  return roundMoney(state.staff.employees.reduce((sum, employee) => sum + salaryFor(employee), 0));
}

/** Взнос при найме, доля месячной зарплаты первого уровня. */
export function hiringFee(roleId: string): number {
  const role = staffData.roles.find((candidate) => candidate.id === roleId);
  return role ? roundMoney(role.salaryPerMonth * staffData.hiring.feeMult) : 0;
}

/** Выходное пособие при увольнении. */
export function severanceFor(employee: StaffMember): number {
  return roundMoney(salaryFor(employee) * staffData.hiring.firingSeveranceMult);
}

/**
 * Суммарная сила эффекта по роли: каждый сотрудник добавляет
 * strengthPerLevel × уровень. Максимум ограничен 0,9, чтобы эффект
 * не «выключал» механику полностью.
 */
export function effectStrength(state: GameState, effect: StaffEffect): number {
  let strength = 0;
  for (const employee of state.staff.employees) {
    const role = staffData.roles.find((candidate) => candidate.id === employee.roleId);
    if (!role || role.effect !== effect) continue;
    strength += role.strengthPerLevel * employee.level;
  }
  return Math.min(0.9, strength);
}

/** Найм: по одному сотруднику на роль, взнос hiring.feeMult × зарплату. */
export function hireStaff(
  state: GameState,
  roleId: string,
): StaffResult<{ state: GameState; cost: number }> {
  const role = staffData.roles.find((candidate) => candidate.id === roleId);
  if (!role) return { ok: false, failure: { code: "roleNotFound", params: { plan: roleId } } };
  if (state.staff.employees.some((employee) => employee.roleId === role.id)) {
    return { ok: false, failure: { code: "alreadyEmployed" } };
  }
  const cost = hiringFee(role.id);
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next: GameState = {
    ...state,
    money: roundMoney(state.money - cost),
    staff: cloneStaff(state.staff),
  };
  next.staff.employees.push({
    id: next.staff.nextEmployeeId,
    roleId: role.id,
    level: 1,
    hiredAtHour: next.time.hour,
  });
  next.staff.nextEmployeeId += 1;
  return { ok: true, state: next, cost };
}

/** Увольнение с выходным пособием firingSeveranceMult × зарплате. */
export function fireStaff(
  state: GameState,
  employeeId: number,
): StaffResult<{ state: GameState; cost: number }> {
  const employee = state.staff.employees.find((candidate) => candidate.id === employeeId);
  if (!employee) return { ok: false, failure: { code: "employeeNotFound" } };

  const cost = severanceFor(employee);
  if (state.money < cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: cost } } };
  }

  const next: GameState = {
    ...state,
    money: roundMoney(state.money - cost),
    staff: cloneStaff(state.staff),
  };
  next.staff.employees = next.staff.employees.filter((candidate) => candidate.id !== employeeId);
  return { ok: true, state: next, cost };
}

/**
 * Суточный тик персонала: рост уровня каждые promotionAfterDays дней
 * работы (сотрудник нанят на уровень 1 и растёт до maxLevel).
 */
export function tickStaff(state: GameState): StaffEvent[] {
  const events: StaffEvent[] = [];
  const { maxLevel, promotionAfterDays } = staffData.leveling;
  const promotionHours = promotionAfterDays * HOURS_PER_DAY;

  for (const employee of state.staff.employees) {
    if (employee.level >= maxLevel) continue;
    const worked = state.time.hour - employee.hiredAtHour;
    const targetLevel = Math.min(maxLevel, 1 + Math.floor(worked / promotionHours));
    if (targetLevel > employee.level) {
      employee.level = targetLevel;
      events.push({ kind: "staffPromoted", ref: employee.roleId, amount: employee.level });
    }
  }
  return events;
}

/** Ограничение числа сотрудников по выручке (для бота). */
export function staffCapByRevenue(state: GameState): number {
  const report = state.economy.reports.at(-1);
  const revenue = report?.revenue ?? 0;
  return Math.max(0, Math.min(staffData.roles.length, Math.floor(revenue / 1200)));
}
