import {
  RESEARCH_IDS,
  SERVICE_RESEARCH,
  getResearch,
  researchData,
  type ResearchId,
} from "../data";
import { roundMoney } from "./components";
import { HOURS_PER_DAY } from "./core/time";
import type { GameState, ResearchState } from "./types";
import type { ServiceId } from "../data";

/**
 * Исследования (этап 11, DESIGN.md §9). Деньги + игровое время:
 * старт стоит денег, завершение — через N игровых дней.
 */

export type ResearchErrorCode =
  | "projectNotFound"
  | "alreadyDone"
  | "alreadyActive"
  | "prerequisitesNotMet"
  | "tooManyActive"
  | "notEnoughMoney";

export interface ResearchFailure {
  code: ResearchErrorCode;
  params?: Record<string, string | number>;
}

export type ResearchResult<T> = ({ ok: true } & T) | { ok: false; failure: ResearchFailure };

export interface ResearchEvent {
  kind: "researchStarted" | "researchCompleted" | "researchCancelled";
  ref?: string;
  amount?: number;
}

export function createResearch(): ResearchState {
  return { completed: [], active: [], nextActiveId: 1 };
}

export function cloneResearch(research: ResearchState): ResearchState {
  return {
    completed: research.completed.slice(),
    active: research.active.map((entry) => ({ ...entry })),
    nextActiveId: research.nextActiveId,
  };
}

/** Постоянные модификаторы от завершённых исследований. */
export function researchBonuses(state: GameState): {
  density: number;
  ddosReduction: number;
  cooling: number;
  pueReduction: number;
  hackMitigation: number;
  repairSpeed: number;
} {
  let density = 0;
  let ddosReduction = 0;
  let cooling = 0;
  let pueReduction = 0;
  let hackMitigation = 0;
  let repairSpeed = 0;
  for (const id of state.research.completed) {
    const project = researchData.projects.find((candidate) => candidate.id === id);
    if (!project) continue;
    density += project.densityBonus ?? 0;
    ddosReduction += project.ddosReduction ?? 0;
    cooling += project.coolingBonus ?? 0;
    pueReduction += project.pueReduction ?? 0;
    hackMitigation += project.hackMitigation ?? 0;
    repairSpeed += project.repairSpeedBonus ?? 0;
  }
  return { density, ddosReduction, cooling, pueReduction, hackMitigation, repairSpeed };
}

/** Открыта ли услуга (стартовая или через завершённое исследование). */
export function isServiceUnlocked(state: GameState, serviceId: ServiceId): boolean {
  const required = SERVICE_RESEARCH[serviceId];
  if (required === undefined) return true;
  return state.research.completed.includes(required as ResearchId);
}

/** Доступно ли исследование к запуску (пререквизиты завершены, не активно/не сделано). */
export function researchAvailable(state: GameState, id: ResearchId): boolean {
  if (state.research.completed.includes(id)) return false;
  if (state.research.active.some((entry) => entry.id === id)) return false;
  return getResearch(id).prerequisites.every((prerequisite) =>
    state.research.completed.includes(prerequisite),
  );
}

/** Запуск исследования: списывает деньги, ставит дедлайн. */
export function startResearch(
  state: GameState,
  id: ResearchId,
): ResearchResult<{ state: GameState; cost: number }> {
  const project = getResearch(id);
  if (!RESEARCH_IDS.includes(id)) {
    return { ok: false, failure: { code: "projectNotFound", params: { id } } };
  }
  if (state.research.completed.includes(id)) {
    return { ok: false, failure: { code: "alreadyDone" } };
  }
  if (state.research.active.some((entry) => entry.id === id)) {
    return { ok: false, failure: { code: "alreadyActive" } };
  }
  if (!project.prerequisites.every((p) => state.research.completed.includes(p))) {
    return { ok: false, failure: { code: "prerequisitesNotMet" } };
  }
  if (state.research.active.length >= researchData.rules.maxActive) {
    return { ok: false, failure: { code: "tooManyActive", params: { max: researchData.rules.maxActive } } };
  }
  if (state.money < project.cost) {
    return { ok: false, failure: { code: "notEnoughMoney", params: { total: project.cost } } };
  }

  const next: GameState = {
    ...state,
    money: roundMoney(state.money - project.cost),
    research: cloneResearch(state.research),
  };
  next.research.active.push({
    id,
    startedAtHour: next.time.hour,
    completesAtHour: next.time.hour + project.days * HOURS_PER_DAY,
  });
  return { ok: true, state: next, cost: project.cost };
}

/** Отмена активного исследования с возвратом cancelRefundMult × стоимости. */
export function cancelResearch(
  state: GameState,
  id: ResearchId,
): ResearchResult<{ state: GameState; refund: number }> {
  const project = getResearch(id);
  const entry = state.research.active.find((candidate) => candidate.id === id);
  if (!entry) {
    return { ok: false, failure: { code: "projectNotFound", params: { id } } };
  }

  const refund = roundMoney(project.cost * researchData.rules.cancelRefundMult);
  const next: GameState = {
    ...state,
    money: roundMoney(state.money + refund),
    research: cloneResearch(state.research),
  };
  next.research.active = next.research.active.filter((candidate) => candidate.id !== id);
  return { ok: true, state: next, refund };
}

/**
 * Суточный тик исследований: завершает активные по дедлайну.
 * Вызывается из движка на границе суток; state мутируется.
 */
export function tickResearch(state: GameState): ResearchEvent[] {
  const events: ResearchEvent[] = [];
  const finished: ResearchId[] = [];

  for (const entry of state.research.active) {
    if (state.time.hour >= entry.completesAtHour) {
      finished.push(entry.id);
    }
  }

  for (const id of finished) {
    state.research.active = state.research.active.filter((entry) => entry.id !== id);
    state.research.completed.push(id);
    events.push({ kind: "researchCompleted", ref: id });

    // Разблокированная услуга добавляется в список с дефолтами.
    const project = researchData.projects.find((candidate) => candidate.id === id);
    const unlocked = project?.unlocksService;
    if (unlocked && !state.services.services.some((service) => service.id === unlocked)) {
      state.services = {
        ...state.services,
        services: [
          ...state.services.services,
          { id: unlocked, priceMult: 1, enabled: false, clientLimit: 0 },
        ],
      };
    }
  }

  return events;
}
