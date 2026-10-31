import rawBalance from "./balance.json";
import rawDifficulties from "./difficulties.json";
import rawEconomy from "./economy.json";

/** Скорости игры. 0 — пауза (DESIGN.md, разд. 1). */
export type Speed = 0 | 1 | 5 | 20 | 60;

export interface BalanceTime {
  /** Сколько игровых часов проходит за 1 реальную секунду на скорости ×1. */
  hoursPerRealSecond: number;
  hoursPerDay: number;
  daysPerMonth: number;
  /** Доступные множители скорости, без паузы. */
  speeds: number[];
}

export interface BalanceStart {
  money: number;
  seed: number;
}

export interface BalanceLimits {
  /** Предохранитель: сколько тиков максимум считать за один кадр. */
  maxTicksPerFrame: number;
  /** Кадр длиннее этого значения обрезается (сон ОС, перетаскивание окна). */
  maxFrameMs: number;
  eventLogSize: number;
}

export interface BalanceFile {
  version: number;
  time: BalanceTime;
  start: BalanceStart;
  limits: BalanceLimits;
}

export const balance = rawBalance as BalanceFile;

export const GAME_SPEEDS: readonly Exclude<Speed, 0>[] = [1, 5, 20, 60];

/**
 * Проверка данных баланса. Возвращает список ошибок, пустой список — данные валидны.
 * Используется тестом, чтобы правки JSON не ломали симуляцию молча.
 */
export function validateBalance(data: BalanceFile): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }

  const { time } = data;
  if (!(time.hoursPerRealSecond > 0)) {
    errors.push("time.hoursPerRealSecond: должно быть > 0");
  }
  if (time.hoursPerDay !== 24) {
    errors.push("time.hoursPerDay: по дизайну всегда 24");
  }
  if (time.daysPerMonth !== 30) {
    errors.push("time.daysPerMonth: по дизайну всегда 30");
  }
  const speeds = [...time.speeds].sort((a, b) => a - b);
  if (speeds.join(",") !== GAME_SPEEDS.join(",")) {
    errors.push(`time.speeds: ожидается [${GAME_SPEEDS.join(", ")}], получено [${speeds.join(", ")}]`);
  }

  if (!Number.isFinite(data.start.money) || data.start.money <= 0) {
    errors.push("start.money: должно быть > 0");
  }
  if (!Number.isInteger(data.start.seed) || data.start.seed < 0) {
    errors.push("start.seed: ожидается целое неотрицательное число");
  }

  const { limits } = data;
  if (!Number.isInteger(limits.maxTicksPerFrame) || limits.maxTicksPerFrame < 24) {
    errors.push("limits.maxTicksPerFrame: ожидается целое ≥ 24 (сутки на скорости ×60)");
  }
  if (!(limits.maxFrameMs > 0) || limits.maxFrameMs > 1000) {
    errors.push("limits.maxFrameMs: ожидается 0 < ms ≤ 1000");
  }
  if (!Number.isInteger(limits.eventLogSize) || limits.eventLogSize < 10) {
    errors.push("limits.eventLogSize: ожидается целое ≥ 10");
  }

  return errors;
}

/* ── Режимы сложности (DESIGN.md, разд. 17) ───────────────────────── */

export type DifficultyId = "calm" | "normal" | "hard" | "sandbox";

export type BankruptcyMode = "warnings" | "gameover" | "none";

export interface DifficultyMode {
  id: DifficultyId;
  startMoney: number;
  /** Множитель вероятности отказов железа. */
  failureRateMult: number;
  /** Множитель частоты случайных событий. */
  eventRateMult: number;
  /** Множитель штрафов SLA. */
  slaPenaltyMult: number;
  bankruptcy: BankruptcyMode;
}

export interface DifficultiesFile {
  version: number;
  defaultMode: DifficultyId;
  modes: DifficultyMode[];
}

export const difficulties = rawDifficulties as DifficultiesFile;

export const DIFFICULTY_IDS: readonly DifficultyId[] = ["calm", "normal", "hard", "sandbox"];

export function getDifficulty(id: DifficultyId): DifficultyMode {
  const mode = difficulties.modes.find((candidate) => candidate.id === id);
  if (!mode) {
    throw new Error(`Неизвестный режим сложности: ${id}`);
  }
  return mode;
}

/** Проверка difficulties.json: все режимы на месте, числа в разумных пределах. */
export function validateDifficulties(data: DifficultiesFile): string[] {
  const errors: string[] = [];

  const ids = data.modes.map((mode) => mode.id);
  for (const expected of DIFFICULTY_IDS) {
    if (!ids.includes(expected)) errors.push(`modes: нет режима ${expected}`);
  }
  if (new Set(ids).size !== ids.length) {
    errors.push("modes: id режимов должны быть уникальны");
  }
  if (!ids.includes(data.defaultMode)) {
    errors.push(`defaultMode: ${data.defaultMode} отсутствует в списке режимов`);
  }

  for (const mode of data.modes) {
    if (!(mode.startMoney > 0)) errors.push(`${mode.id}.startMoney: должно быть > 0`);
    if (!(mode.failureRateMult >= 0 && mode.failureRateMult <= 3)) {
      errors.push(`${mode.id}.failureRateMult: ожидается 0…3`);
    }
    if (!(mode.eventRateMult >= 0 && mode.eventRateMult <= 3)) {
      errors.push(`${mode.id}.eventRateMult: ожидается 0…3`);
    }
    if (!(mode.slaPenaltyMult >= 0 && mode.slaPenaltyMult <= 3)) {
      errors.push(`${mode.id}.slaPenaltyMult: ожидается 0…3`);
    }
    if (!["warnings", "gameover", "none"].includes(mode.bankruptcy)) {
      errors.push(`${mode.id}.bankruptcy: неизвестное значение`);
    }
  }

  return errors;
}

/* ── Экономика: тарифы, PUE, интернет, стартовое состояние ────────── */

export type LocationKind = "home" | "garage" | "colo" | "datacenter";

export interface ElectricityTariff {
  id: string;
  /** Цена за кВт·ч в долларах. */
  pricePerKwh: number;
}

export interface InternetPlan {
  id: string;
  speedMbit: number;
  pricePerMonth: number;
}

export interface EconomyFile {
  version: number;
  electricity: {
    tariffs: ElectricityTariff[];
    /** PUE: во сколько раз общее потребление больше ИТ-нагрузки. */
    pue: Record<LocationKind, number>;
    /** Случайное блуждание цены за год (доля, например 0.05 = ±5%). */
    priceDriftPerYear: number;
    priceMinMult: number;
    priceMaxMult: number;
  };
  internet: {
    plans: InternetPlan[];
    defaultPlanId: string;
  };
  start: {
    location: LocationKind;
    /** Потребление старого домашнего ПК, Вт (до этапа железа). */
    itLoadW: number;
    internetPlanId: string;
    electricityTariffId: string;
    rentPerMonth: number;
  };
  bankruptcy: {
    /** Деньги ниже этого значения при отсутствии клиентов — конец игры. */
    threshold: number;
    /** Порог предупреждения о минусе. */
    warningAt: number;
  };
  reports: {
    /** Сколько месячных отчётов хранится в состоянии. */
    historySize: number;
  };
}

export const economy = rawEconomy as EconomyFile;

export const LOCATION_KINDS: readonly LocationKind[] = ["home", "garage", "colo", "datacenter"];

export function getInternetPlan(id: string): InternetPlan {
  const plan = economy.internet.plans.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`Неизвестный тариф интернета: ${id}`);
  return plan;
}

export function getElectricityTariff(id: string): ElectricityTariff {
  const tariff = economy.electricity.tariffs.find((candidate) => candidate.id === id);
  if (!tariff) throw new Error(`Неизвестный тариф на электричество: ${id}`);
  return tariff;
}

/** Проверка economy.json: ссылки существуют, числа в разумных пределах. */
export function validateEconomy(data: EconomyFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }

  const tariffIds = data.electricity.tariffs.map((tariff) => tariff.id);
  if (new Set(tariffIds).size !== tariffIds.length) {
    errors.push("electricity.tariffs: id тарифов должны быть уникальны");
  }
  if (tariffIds.length === 0) {
    errors.push("electricity.tariffs: нужен хотя бы один тариф");
  }
  for (const tariff of data.electricity.tariffs) {
    if (!(tariff.pricePerKwh > 0) || tariff.pricePerKwh > 1) {
      errors.push(`electricity.tariffs.${tariff.id}.pricePerKwh: ожидается 0…1`);
    }
  }
  for (const kind of LOCATION_KINDS) {
    const pue = data.electricity.pue[kind];
    if (!(pue >= 1) || pue > 3) {
      errors.push(`electricity.pue.${kind}: ожидается 1…3`);
    }
  }
  if (!(data.electricity.priceDriftPerYear >= 0) || data.electricity.priceDriftPerYear > 0.2) {
    errors.push("electricity.priceDriftPerYear: ожидается 0…0,2");
  }
  if (!(data.electricity.priceMinMult > 0 && data.electricity.priceMinMult <= 1)) {
    errors.push("electricity.priceMinMult: ожидается 0…1");
  }
  if (!(data.electricity.priceMaxMult >= 1 && data.electricity.priceMaxMult <= 2)) {
    errors.push("electricity.priceMaxMult: ожидается 1…2");
  }

  const planIds = data.internet.plans.map((plan) => plan.id);
  if (new Set(planIds).size !== planIds.length) {
    errors.push("internet.plans: id тарифов должны быть уникальны");
  }
  if (!planIds.includes(data.internet.defaultPlanId)) {
    errors.push(`internet.defaultPlanId: ${data.internet.defaultPlanId} отсутствует в списке`);
  }
  for (const plan of data.internet.plans) {
    if (!(plan.speedMbit > 0)) errors.push(`internet.plans.${plan.id}.speedMbit: должно быть > 0`);
    if (!(plan.pricePerMonth >= 0)) errors.push(`internet.plans.${plan.id}.pricePerMonth: должно быть ≥ 0`);
  }
  if (!planIds.includes(data.start.internetPlanId)) {
    errors.push(`start.internetPlanId: ${data.start.internetPlanId} отсутствует в списке`);
  }
  if (!tariffIds.includes(data.start.electricityTariffId)) {
    errors.push(`start.electricityTariffId: ${data.start.electricityTariffId} отсутствует в списке`);
  }
  if (!LOCATION_KINDS.includes(data.start.location)) {
    errors.push(`start.location: неизвестная локация ${data.start.location}`);
  }
  if (!(data.start.itLoadW > 0) || data.start.itLoadW > 2000) {
    errors.push("start.itLoadW: ожидается 0…2000 Вт");
  }
  if (!(data.start.rentPerMonth >= 0)) {
    errors.push("start.rentPerMonth: должно быть ≥ 0");
  }

  if (!(data.bankruptcy.threshold < 0)) {
    errors.push("bankruptcy.threshold: ожидается отрицательное число");
  }
  if (!(data.bankruptcy.warningAt <= 0)) {
    errors.push("bankruptcy.warningAt: ожидается ≤ 0");
  }
  if (data.bankruptcy.warningAt <= data.bankruptcy.threshold) {
    errors.push("bankruptcy.warningAt: должен быть выше порога банкротства");
  }
  if (!Number.isInteger(data.reports.historySize) || data.reports.historySize < 6) {
    errors.push("reports.historySize: ожидается целое ≥ 6");
  }

  return errors;
}