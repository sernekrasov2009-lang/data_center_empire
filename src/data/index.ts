import rawBalance from "./balance.json";
import rawComponents from "./components.json";
import rawDifficulties from "./difficulties.json";
import rawEconomy from "./economy.json";
import rawLocation from "./location.json";
import rawReputation from "./reputation.json";
import rawServices from "./services.json";
import rawEvents from "./events.json";
import rawStaff from "./staff.json";

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

/* ── Локация, охлаждение, шум и соседи (DESIGN.md, разд. 4) ───────── */

export type PowerOffReason =
  | "none"
  | "breaker"
  | "overheat"
  | "neighbors"
  | "blackout"
  | "channelFailure"
  | "moving";

export interface CoolingOption {
  id: string;
  /** Проводимость охлаждения, Вт/К: T_room = T_outside + P_heat / C. */
  conductanceWPerK: number;
  /** Сколько ватт потребляет само охлаждение. */
  powerW: number;
  price: number;
  noiseDb: number;
}

export interface ClimateSpec {
  /** Средняя температура по месяцам, °C (январь…декабрь). */
  monthlyBaseC: number[];
  /** Суточная амплитуда вокруг средней, °C. */
  dailyAmplitudeC: number;
  /** Дом отапливается зимой: комнатная температура не опускается ниже. */
  minRoomTempC: number;
  warnC: number;
  throttleC: number;
  shutdownC: number;
}

export interface NoiseSpec {
  /** Ночной интервал: с nightStartHour до nightEndHour (через полночь). */
  nightStartHour: number;
  nightEndHour: number;
  nightLimitDb: number;
  dayLimitDb: number;
  /** Прирост раздражения за каждый дБ сверх лимита за час. */
  irritationPerDbHour: number;
  irritationDecayPerHour: number;
  complaintAt: number;
  fineAt: number;
  shutdownAt: number;
  fineAmount: number;
  minComplaintGapHours: number;
}

export interface InsulationSpec {
  price: number;
  reductionDb: number;
}

export interface UpsSpec {
  price: number;
  /** Сколько минут ИБП держит нагрузку (пересчитано в часы: 240 мин = 4 ч). */
  maxMinutes: number;
}

export interface StabilizerSpec {
  price: number;
}

export interface MovingSpec {
  price: number;
  downtimeHours: number;
}

export interface LocationDefinition {
  id: LocationKind;
  slots: number;
  powerCapacityW: number;
  rentPerMonth: number;
  /** id тарифов интернета из economy.json, доступных в этой локации. */
  internetPlans: string[];
  defaultInternetPlanId: string;
  defaultCoolingId: string;
}

export interface LocationFile {
  version: number;
  /** Сколько часов подряд допустима перегрузка до срабатывания автомата. */
  breakerGraceHours: number;
  climate: ClimateSpec;
  noise: NoiseSpec;
  insulation: InsulationSpec;
  ups: UpsSpec;
  stabilizer: StabilizerSpec;
  moving: MovingSpec;
  cooling: CoolingOption[];
  locations: LocationDefinition[];
}

export const locationData = rawLocation as LocationFile;

export function getLocationDefinition(id: string): LocationDefinition {
  const definition = locationData.locations.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Неизвестная локация: ${id}`);
  return definition;
}

export function getCooling(id: string): CoolingOption {
  const cooling = locationData.cooling.find((candidate) => candidate.id === id);
  if (!cooling) throw new Error(`Неизвестное охлаждение: ${id}`);
  return cooling;
}

function integerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Проверка location.json: климат, охлаждение, шум и ссылки на интернет-тарифы. */
export function validateLocation(data: LocationFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }
  if (!Number.isInteger(data.breakerGraceHours) || data.breakerGraceHours < 0 || data.breakerGraceHours > 24) {
    errors.push("breakerGraceHours: ожидается целое 0…24");
  }

  const climate = data.climate;
  if (!Array.isArray(climate.monthlyBaseC) || climate.monthlyBaseC.length !== 12) {
    errors.push("climate.monthlyBaseC: нужно 12 значений");
  } else if (climate.monthlyBaseC.some((value) => value < -30 || value > 45)) {
    errors.push("climate.monthlyBaseC: ожидается −30…45 °C");
  }
  if (!(climate.dailyAmplitudeC >= 0 && climate.dailyAmplitudeC <= 15)) {
    errors.push("climate.dailyAmplitudeC: ожидается 0…15");
  }
  if (!(climate.minRoomTempC >= 0 && climate.minRoomTempC <= 25)) {
    errors.push("climate.minRoomTempC: ожидается 0…25");
  }
  if (!(climate.warnC >= 20 && climate.warnC < climate.throttleC)) {
    errors.push("climate.warnC: ожидается ≥ 20 и меньше throttleC");
  }
  if (!(climate.throttleC < climate.shutdownC && climate.shutdownC <= 70)) {
    errors.push("climate.throttleC: ожидается меньше shutdownC ≤ 70");
  }

  const noise = data.noise;
  if (!integerInRange(noise.nightStartHour, 0, 23) || !integerInRange(noise.nightEndHour, 0, 23)) {
    errors.push("noise.night: часы должны быть целыми 0…23");
  }
  if (!(noise.nightLimitDb >= 0 && noise.nightLimitDb <= 120)) {
    errors.push("noise.nightLimitDb: ожидается 0…120");
  }
  if (!(noise.dayLimitDb >= noise.nightLimitDb && noise.dayLimitDb <= 120)) {
    errors.push("noise.dayLimitDb: ожидается не меньше ночного и ≤ 120");
  }
  if (!(noise.irritationPerDbHour >= 0)) errors.push("noise.irritationPerDbHour: должно быть ≥ 0");
  if (!(noise.irritationDecayPerHour >= 0)) errors.push("noise.irritationDecayPerHour: должно быть ≥ 0");
  if (!(noise.complaintAt > 0 && noise.complaintAt < noise.fineAt && noise.fineAt < noise.shutdownAt)) {
    errors.push("noise: ожидается 0 < complaintAt < fineAt < shutdownAt");
  }
  if (!(noise.fineAmount >= 0)) errors.push("noise.fineAmount: должно быть ≥ 0");
  if (!Number.isInteger(noise.minComplaintGapHours) || noise.minComplaintGapHours < 1) {
    errors.push("noise.minComplaintGapHours: ожидается целое ≥ 1");
  }

  if (!(data.insulation.price >= 0)) errors.push("insulation.price: должно быть ≥ 0");
  if (!(data.insulation.reductionDb >= 0 && data.insulation.reductionDb <= 30)) {
    errors.push("insulation.reductionDb: ожидается 0…30");
  }

  if (!(data.ups.price >= 0)) errors.push("ups.price: должно быть ≥ 0");
  if (!(data.ups.maxMinutes >= 1) || data.ups.maxMinutes > 1440) {
    errors.push("ups.maxMinutes: ожидается 1…1440");
  }
  if (!(data.stabilizer.price >= 0)) errors.push("stabilizer.price: должно быть ≥ 0");
  if (!(data.moving.price >= 0)) errors.push("moving.price: должно быть ≥ 0");
  if (!Number.isInteger(data.moving.downtimeHours) || data.moving.downtimeHours < 0 || data.moving.downtimeHours > 168) {
    errors.push("moving.downtimeHours: ожидается целое 0…168");
  }

  const coolingIds = data.cooling.map((option) => option.id);
  if (coolingIds.length === 0) errors.push("cooling: нужен хотя бы один вариант");
  if (new Set(coolingIds).size !== coolingIds.length) {
    errors.push("cooling: id должны быть уникальны");
  }
  for (const option of data.cooling) {
    const prefix = `cooling.${option.id}`;
    if (!option.id) errors.push("cooling: пустой id");
    if (!(option.conductanceWPerK > 0) || option.conductanceWPerK > 10000) {
      errors.push(`${prefix}.conductanceWPerK: ожидается 0…10000`);
    }
    if (!(option.powerW >= 0)) errors.push(`${prefix}.powerW: должно быть ≥ 0`);
    if (!(option.price >= 0)) errors.push(`${prefix}.price: должно быть ≥ 0`);
    if (!(option.noiseDb >= 0 && option.noiseDb <= 80)) errors.push(`${prefix}.noiseDb: ожидается 0…80`);
  }

  const planIds = new Set(data.locations.flatMap((definition) => definition.internetPlans));
  for (const planId of planIds) {
    if (!economy.internet.plans.some((plan) => plan.id === planId)) {
      errors.push(`locations: неизвестный тариф интернета ${planId}`);
    }
  }

  const locationIds = data.locations.map((definition) => definition.id);
  if (locationIds.length === 0) errors.push("locations: нужна хотя бы одна локация");
  if (new Set(locationIds).size !== locationIds.length) {
    errors.push("locations: id должны быть уникальны");
  }
  for (const definition of data.locations) {
    const prefix = `locations.${definition.id}`;
    if (!LOCATION_KINDS.includes(definition.id)) errors.push(`${prefix}.id: неизвестная локация`);
    if (!Number.isInteger(definition.slots) || definition.slots < 1 || definition.slots > 400) {
      errors.push(`${prefix}.slots: ожидается целое 1…400`);
    }
    if (!(definition.powerCapacityW > 0) || definition.powerCapacityW > 5_000_000) {
      errors.push(`${prefix}.powerCapacityW: ожидается 0…5 000 000 Вт`);
    }
    if (!(definition.rentPerMonth >= 0)) errors.push(`${prefix}.rentPerMonth: должно быть ≥ 0`);
    if (!Array.isArray(definition.internetPlans) || definition.internetPlans.length === 0) {
      errors.push(`${prefix}.internetPlans: нужен непустой список`);
    }
    if (!definition.internetPlans.includes(definition.defaultInternetPlanId)) {
      errors.push(`${prefix}.defaultInternetPlanId: отсутствует в internetPlans`);
    }
    if (!coolingIds.includes(definition.defaultCoolingId)) {
      errors.push(`${prefix}.defaultCoolingId: неизвестное охлаждение`);
    }
  }

  return errors;
}

/* ── Услуги и клиенты (DESIGN.md, разд. 5) ───────────────────────── */

/** Ключ услуги; пока три стартовых, расширится исследованиями. */
export type ServiceId = "landing" | "cms" | "chatbot";

export const SERVICE_IDS: readonly ServiceId[] = ["landing", "cms", "chatbot"];

export interface ServiceDefinition {
  id: ServiceId;
  /** Доля ядра ЦП на одного клиента. */
  coresPerClient: number;
  ramGbPerClient: number;
  storageGbPerClient: number;
  /** Полоса интернета на клиента, Мбит/с. */
  mbitPerClient: number;
  /** Рыночная цена, $/мес; цена игрока ограничена 50–200% от неё. */
  pricePerMonth: number;
  slaPercent: number;
  /** Базовый спрос M в формуле λ (DESIGN.md, разд. 5.2). */
  baseDemandPerDay: number;
}

export interface ServicesFile {
  version: number;
  demand: {
    /** Стартовая репутация; сама репутация появится на этапе 7. */
    reputationStart: number;
    /** Степень в (P / P_рынок)^(−эластичность). */
    priceElasticity: number;
    priceMinMult: number;
    priceMaxMult: number;
  };
  churn: {
    baseMonthly: number;
    /** Добавка к оттоку за цену выше pricePenaltyFrom × рыночная. */
    pricePenaltyMonthly: number;
    pricePenaltyFrom: number;
  };
  services: ServiceDefinition[];
}

export const servicesData = rawServices as ServicesFile;

/* ── Репутация и аптайм (этап 7, DESIGN.md §6 и §15.6) ─────────────── */

export interface ReputationEma {
  weights: { uptime: number; quality: number; support: number };
  windowDays: number;
  min: number;
  max: number;
  start: number;
}

export interface ReputationFile {
  version: number;
  ema: ReputationEma;
  quality: {
    throttleTempC: number;
  };
  tickets: {
    perClientPerMonth: number;
    perIncidentPerClient: number;
    scorePenaltyPer10Open: number;
    maxOpen: number;
  };
  sla: {
    churnPerDailyPoint: number;
    uptimeReportDays: number;
  };
  reviews: {
    ratingFrom: number;
    ratingTo: number;
  };
}

export const reputationData = rawReputation as ReputationFile;

/* ── Случайные события и аварии (этап 8, DESIGN.md §7 и §15.7) ─────── */

export interface EventsFile {
  version: number;
  blackout: {
    chancePerDay: number;
    summerChancePerDay: number;
    minHours: number;
    maxHours: number;
  };
  voltageSpike: {
    chancePerDay: number;
  };
  ddos: {
    chancePerDay: number;
    reputationGrowthPerPoint: number;
    reputationFrom: number;
    minHours: number;
    maxHours: number;
  };
  channelFailure: {
    chancePerDay: number;
    minHours: number;
    maxHours: number;
  };
  clientHacked: {
    chancePerDay: number;
    reputationHit: number;
  };
  electricityPriceSpike: {
    chancePerDay: number;
    priceMult: number;
    minMonths: number;
    maxMonths: number;
  };
}

export const eventsData = rawEvents as EventsFile;

/* ── Персонал и автоматизация (этап 10, DESIGN.md §8) ────────────── */

export type StaffRoleId = "sysadmin" | "network" | "electrician" | "support" | "sales" | "security";

export const STAFF_ROLE_IDS: readonly StaffRoleId[] = [
  "sysadmin",
  "network",
  "electrician",
  "support",
  "sales",
  "security",
];

export type StaffEffect =
  | "repairSpeed"
  | "channelResilience"
  | "powerResilience"
  | "supportScore"
  | "demandBoost"
  | "hackProtection";

export interface StaffRoleDefinition {
  id: StaffRoleId;
  title: string;
  salaryPerMonth: number;
  effect: StaffEffect;
  effectDesc: string;
  /** Доля эффекта за один уровень (например 0,05 → на 5 уровне 0,25). */
  strengthPerLevel: number;
}

export interface StaffFile {
  version: number;
  hiring: {
    /** Взнос при найме, доля месячной зарплаты. */
    feeMult: number;
    /** Выходное пособие при увольнении, доля месячной зарплаты. */
    firingSeveranceMult: number;
  };
  leveling: {
    maxLevel: number;
    /** Через сколько дней работы сотрудник растёт в уровне. */
    promotionAfterDays: number;
    /** Зарплата × 1,2 за каждый уровень сверх первого. */
    salaryPerLevelMult: number;
  };
  roles: StaffRoleDefinition[];
}

export const staffData = rawStaff as StaffFile;

/** Проверка staff.json: роли, зарплаты, прогрессия уровней. */
export function validateStaff(data: StaffFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }
  if (!(data.hiring.feeMult >= 0 && data.hiring.feeMult <= 2)) {
    errors.push("hiring.feeMult: ожидается 0…2");
  }
  if (!(data.hiring.firingSeveranceMult >= 0 && data.hiring.firingSeveranceMult <= 3)) {
    errors.push("hiring.firingSeveranceMult: ожидается 0…3");
  }
  if (!Number.isInteger(data.leveling.maxLevel) || data.leveling.maxLevel < 1 || data.leveling.maxLevel > 10) {
    errors.push("leveling.maxLevel: ожидается целое 1…10");
  }
  if (!(data.leveling.promotionAfterDays >= 7) || data.leveling.promotionAfterDays > 365) {
    errors.push("leveling.promotionAfterDays: ожидается 7…365");
  }
  if (!(data.leveling.salaryPerLevelMult >= 1 && data.leveling.salaryPerLevelMult <= 2)) {
    errors.push("leveling.salaryPerLevelMult: ожидается 1…2");
  }

  const roleIds = data.roles.map((role) => role.id);
  if (roleIds.length !== STAFF_ROLE_IDS.length) {
    errors.push(`roles: нужно ${STAFF_ROLE_IDS.length} ролей`);
  }
  if (new Set(roleIds).size !== roleIds.length) {
    errors.push("roles: id должны быть уникальны");
  }
  for (const role of data.roles) {
    const prefix = `roles.${role.id}`;
    if (!STAFF_ROLE_IDS.includes(role.id)) errors.push(`${prefix}.id: неизвестная роль`);
    if (!(role.salaryPerMonth >= 100 && role.salaryPerMonth <= 10_000)) {
      errors.push(`${prefix}.salaryPerMonth: ожидается 100…10 000`);
    }
    if (!(role.strengthPerLevel > 0 && role.strengthPerLevel * data.leveling.maxLevel <= 0.9)) {
      errors.push(`${prefix}.strengthPerLevel: слишком слабый или сильный эффект`);
    }
  }

  return errors;
}

/** Проверка events.json: вероятности в 0…1, длительности положительные. */
export function validateEvents(data: EventsFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }

  const checks: [string, number, number, number][] = [
    ["blackout.chancePerDay", data.blackout.chancePerDay, 0, 0.05],
    ["blackout.summerChancePerDay", data.blackout.summerChancePerDay, 0, 0.05],
    ["voltageSpike.chancePerDay", data.voltageSpike.chancePerDay, 0, 0.05],
    ["ddos.chancePerDay", data.ddos.chancePerDay, 0, 0.05],
    ["channelFailure.chancePerDay", data.channelFailure.chancePerDay, 0, 0.05],
    ["clientHacked.chancePerDay", data.clientHacked.chancePerDay, 0, 0.05],
    ["electricityPriceSpike.chancePerDay", data.electricityPriceSpike.chancePerDay, 0, 0.05],
  ];
  for (const [key, value, min, max] of checks) {
    if (!(value >= min && value <= max)) {
      errors.push(`${key}: ожидается ${min}…${max}`);
    }
  }

  const durationChecks: [string, number, number][] = [
    ["blackout", data.blackout.maxHours, data.blackout.minHours],
    ["ddos", data.ddos.maxHours, data.ddos.minHours],
    ["channelFailure", data.channelFailure.maxHours, data.channelFailure.minHours],
  ];
  for (const [key, max, min] of durationChecks) {
    if (!(min >= 1 && max >= min && max <= 48)) {
      errors.push(`${key}.minHours/maxHours: ожидается 1 ≤ min ≤ max ≤ 48`);
    }
  }

  if (!(data.ddos.reputationGrowthPerPoint >= 0) || data.ddos.reputationGrowthPerPoint > 0.01) {
    errors.push("ddos.reputationGrowthPerPoint: ожидается 0…0.01");
  }
  if (!(data.clientHacked.reputationHit > 0) || data.clientHacked.reputationHit > 0.2) {
    errors.push("clientHacked.reputationHit: ожидается 0…0.2");
  }
  if (!(data.electricityPriceSpike.priceMult > 1) || data.electricityPriceSpike.priceMult > 2) {
    errors.push("electricityPriceSpike.priceMult: ожидается 1…2");
  }
  if (
    !Number.isInteger(data.electricityPriceSpike.minMonths) ||
    !Number.isInteger(data.electricityPriceSpike.maxMonths) ||
    data.electricityPriceSpike.minMonths < 1 ||
    data.electricityPriceSpike.maxMonths < data.electricityPriceSpike.minMonths
  ) {
    errors.push("electricityPriceSpike.minMonths/maxMonths: ожидается 1 ≤ min ≤ max");
  }

  return errors;
}

/** Проверка reputation.json: веса, окно EMA, ставки тикетов и SLA. */
export function validateReputation(data: ReputationFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }

  const { ema } = data;
  const weightSum = ema.weights.uptime + ema.weights.quality + ema.weights.support;
  if (Math.abs(weightSum - 1) > 0.001) {
    errors.push(`ema.weights: сумма должна быть 1, получено ${weightSum.toFixed(3)}`);
  }
  if (!(ema.windowDays >= 7 && ema.windowDays <= 365)) {
    errors.push("ema.windowDays: ожидается 7…365");
  }
  if (!(ema.min >= 0 && ema.max <= 3 && ema.min < ema.max)) {
    errors.push("ema.min/max: ожидается 0 ≤ min < max ≤ 3");
  }
  if (!(ema.start >= ema.min && ema.start <= ema.max)) {
    errors.push("ema.start: должен быть в границах min…max");
  }

  const { tickets } = data;
  if (!(tickets.perClientPerMonth > 0) || tickets.perClientPerMonth > 1) {
    errors.push("tickets.perClientPerMonth: ожидается 0…1");
  }
  if (!(tickets.perIncidentPerClient >= 0) || tickets.perIncidentPerClient > 5) {
    errors.push("tickets.perIncidentPerClient: ожидается 0…5");
  }
  if (!(tickets.scorePenaltyPer10Open > 0) || tickets.scorePenaltyPer10Open > 0.2) {
    errors.push("tickets.scorePenaltyPer10Open: ожидается 0…0.2");
  }
  if (!Number.isInteger(tickets.maxOpen) || tickets.maxOpen < 10 || tickets.maxOpen > 1000) {
    errors.push("tickets.maxOpen: ожидается 10…1000");
  }

  const { sla } = data;
  if (!(sla.churnPerDailyPoint > 0) || sla.churnPerDailyPoint > 0.1) {
    errors.push("sla.churnPerDailyPoint: ожидается 0…0.1");
  }
  if (!Number.isInteger(sla.uptimeReportDays) || sla.uptimeReportDays !== 30) {
    errors.push("sla.uptimeReportDays: по дизайну равен длине месяца (30)");
  }

  return errors;
}

export function getService(id: ServiceId): ServiceDefinition {
  const service = servicesData.services.find((candidate) => candidate.id === id);
  if (!service) throw new Error(`Неизвестная услуга: ${id}`);
  return service;
}

/** Проверка services.json: три стартовые услуги, спрос и отток в разумных пределах. */
export function validateServices(data: ServicesFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }

  const demand = data.demand;
  if (!(demand.reputationStart > 0 && demand.reputationStart <= 1.5)) {
    errors.push("demand.reputationStart: ожидается 0…1,5");
  }
  if (!(demand.priceElasticity > 0) || demand.priceElasticity > 5) {
    errors.push("demand.priceElasticity: ожидается 0…5");
  }
  if (!(demand.priceMinMult > 0 && demand.priceMinMult < 1)) {
    errors.push("demand.priceMinMult: ожидается 0…1");
  }
  if (!(demand.priceMaxMult > 1 && demand.priceMaxMult <= 3)) {
    errors.push("demand.priceMaxMult: ожидается 1…3");
  }

  const churn = data.churn;
  if (!(churn.baseMonthly >= 0 && churn.baseMonthly < 1)) {
    errors.push("churn.baseMonthly: ожидается 0…1");
  }
  if (!(churn.pricePenaltyMonthly >= 0) || churn.baseMonthly + churn.pricePenaltyMonthly >= 1) {
    errors.push("churn.pricePenaltyMonthly: суммарный месячный отток должен быть < 1");
  }
  if (!(churn.pricePenaltyFrom >= 1 && churn.pricePenaltyFrom <= 2)) {
    errors.push("churn.pricePenaltyFrom: ожидается 1…2");
  }

  const ids = data.services.map((service) => service.id);
  for (const expected of SERVICE_IDS) {
    if (!ids.includes(expected)) errors.push(`services: нет услуги ${expected}`);
  }
  if (new Set(ids).size !== ids.length) {
    errors.push("services: id должны быть уникальны");
  }
  for (const service of data.services) {
    const prefix = `services.${service.id}`;
    if (!SERVICE_IDS.includes(service.id)) errors.push(`${prefix}.id: неизвестная услуга`);
    if (!(service.coresPerClient > 0)) errors.push(`${prefix}.coresPerClient: должно быть > 0`);
    if (!(service.ramGbPerClient > 0)) errors.push(`${prefix}.ramGbPerClient: должно быть > 0`);
    if (!(service.storageGbPerClient > 0)) errors.push(`${prefix}.storageGbPerClient: должно быть > 0`);
    if (!(service.mbitPerClient > 0)) errors.push(`${prefix}.mbitPerClient: должно быть > 0`);
    if (!(service.pricePerMonth > 0) || service.pricePerMonth > 500) {
      errors.push(`${prefix}.pricePerMonth: ожидается 0…500`);
    }
    if (!(service.slaPercent >= 90 && service.slaPercent <= 100)) {
      errors.push(`${prefix}.slaPercent: ожидается 90…100`);
    }
    if (!(service.baseDemandPerDay > 0) || service.baseDemandPerDay > 50) {
      errors.push(`${prefix}.baseDemandPerDay: ожидается 0…50`);
    }
  }

  return errors;
}

/* ── Железо: каталог комплектующих и магазин (DESIGN.md, разд. 3) ─── */

export type ComponentType = "cpu" | "motherboard" | "ram" | "storage" | "psu" | "case" | "nic";

export const COMPONENT_TYPES: readonly ComponentType[] = [
  "cpu",
  "motherboard",
  "ram",
  "storage",
  "psu",
  "case",
  "nic",
];

export type ComponentCondition = "new" | "used";

export type StorageKind = "hdd" | "ssd" | "nvme";

export interface ComponentSpecs {
  cores?: number;
  threads?: number;
  capacityGb?: number;
  speedMbs?: number;
  kind?: StorageKind;
  wattage?: number;
  efficiency?: number;
  ramSlots?: number;
  maxRamGb?: number;
  driveBays?: number;
  networkMbit?: number;
  ports?: number;
  supportedBoardFormFactors?: string[];
}

export interface Component {
  id: string;
  type: ComponentType;
  name: string;
  tier: number;
  generation: number;
  price: number;
  /** Потребление, Вт. */
  power: number;
  specs: ComponentSpecs;
  formFactor: string | null;
  socket: string | null;
  ramType: string | null;
  mtbfDays: number;
  noiseDb: number;
}

export interface HardwareFile {
  version: number;
  /** Температура воздуха на старте, °C. Нагрев помещения появится на этапе 4. */
  ambientTempC: number;
  compatibility: {
    /** Запас блока питания: мощность ≥ этот коэффициент × потребление. */
    psuHeadroom: number;
  };
  build: {
    partsPerHour: number;
    maxHours: number;
    maxRamSticksFallback: number;
    maxStorageFallback: number;
  };
  market: {
    /** Месячное колебание цен новых деталей, доля (±10%). */
    priceDriftPerMonth: number;
    usedDiscountMin: number;
    usedDiscountMax: number;
    usedMtbfMult: number;
    usedDefectChance: number;
    usedDefectWindowDays: number;
    usedLotsPerWeek: number;
    usedLotDays: number;
  };
  delivery: {
    newDaysMin: number;
    newDaysMax: number;
    usedDaysMin: number;
    usedDaysMax: number;
    freeFrom: number;
    fee: number;
    cancelHours: number;
    returnDays: number;
    returnFee: number;
  };
  repair: {
    hoursWithSpare: number;
    hoursWithoutSpare: number;
  };
  /** Старый домашний ПК из стартовых условий (DESIGN.md, разд. 2). */
  startBuild: {
    parts: string[];
  };
  components: Component[];
}

export const hardware = rawComponents as HardwareFile;

export const components: Component[] = hardware.components;

export function getComponent(id: string): Component {
  const component = components.find((candidate) => candidate.id === id);
  if (!component) throw new Error(`Неизвестная комплектующая: ${id}`);
  return component;
}

export function findComponent(id: string): Component | undefined {
  return components.find((candidate) => candidate.id === id);
}

export function componentsByType(type: ComponentType): Component[] {
  return components.filter((component) => component.type === type);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Проверка components.json: каталог, ссылки стартовой сборки и параметры магазина. */
export function validateHardware(data: HardwareFile): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(data.version) || data.version < 1) {
    errors.push("version: ожидается целое число ≥ 1");
  }
  if (typeof data.ambientTempC !== "number" || data.ambientTempC < -20 || data.ambientTempC > 60) {
    errors.push("ambientTempC: ожидается −20…60 °C");
  }
  if (!(data.compatibility.psuHeadroom >= 1) || data.compatibility.psuHeadroom > 2) {
    errors.push("compatibility.psuHeadroom: ожидается 1…2");
  }

  const { build, market, delivery, repair } = data;
  if (!(build.partsPerHour > 0)) errors.push("build.partsPerHour: должно быть > 0");
  if (!(build.maxHours >= 0) || build.maxHours > 8) errors.push("build.maxHours: ожидается 0…8");
  if (!Number.isInteger(build.maxRamSticksFallback) || build.maxRamSticksFallback < 1) {
    errors.push("build.maxRamSticksFallback: ожидается целое ≥ 1");
  }
  if (!Number.isInteger(build.maxStorageFallback) || build.maxStorageFallback < 1) {
    errors.push("build.maxStorageFallback: ожидается целое ≥ 1");
  }

  if (!(market.priceDriftPerMonth >= 0) || market.priceDriftPerMonth > 0.3) {
    errors.push("market.priceDriftPerMonth: ожидается 0…0,3");
  }
  if (!(market.usedDiscountMin >= 0 && market.usedDiscountMin < market.usedDiscountMax && market.usedDiscountMax < 1)) {
    errors.push("market.usedDiscount: ожидается 0 ≤ min < max < 1");
  }
  if (!(market.usedMtbfMult > 0 && market.usedMtbfMult <= 1)) {
    errors.push("market.usedMtbfMult: ожидается 0…1");
  }
  if (!(market.usedDefectChance >= 0 && market.usedDefectChance <= 1)) {
    errors.push("market.usedDefectChance: ожидается 0…1");
  }
  if (!Number.isInteger(market.usedDefectWindowDays) || market.usedDefectWindowDays < 1) {
    errors.push("market.usedDefectWindowDays: ожидается целое ≥ 1");
  }
  if (!Number.isInteger(market.usedLotsPerWeek) || market.usedLotsPerWeek < 1 || market.usedLotsPerWeek > 24) {
    errors.push("market.usedLotsPerWeek: ожидается целое 1…24");
  }
  if (!Number.isInteger(market.usedLotDays) || market.usedLotDays < 1 || market.usedLotDays > 30) {
    errors.push("market.usedLotDays: ожидается целое 1…30");
  }

  if (!Number.isInteger(delivery.newDaysMin) || !Number.isInteger(delivery.newDaysMax) || delivery.newDaysMin < 1 || delivery.newDaysMax < delivery.newDaysMin) {
    errors.push("delivery.newDays: ожидается 1 ≤ min ≤ max");
  }
  if (!Number.isInteger(delivery.usedDaysMin) || !Number.isInteger(delivery.usedDaysMax) || delivery.usedDaysMin < 1 || delivery.usedDaysMax < delivery.usedDaysMin) {
    errors.push("delivery.usedDays: ожидается 1 ≤ min ≤ max");
  }
  if (!(delivery.freeFrom >= 0)) errors.push("delivery.freeFrom: должно быть ≥ 0");
  if (!(delivery.fee >= 0)) errors.push("delivery.fee: должно быть ≥ 0");
  if (!(delivery.cancelHours >= 0)) errors.push("delivery.cancelHours: должно быть ≥ 0");
  if (!Number.isInteger(delivery.returnDays) || delivery.returnDays < 1) {
    errors.push("delivery.returnDays: ожидается целое ≥ 1");
  }
  if (!(delivery.returnFee >= 0 && delivery.returnFee < 1)) {
    errors.push("delivery.returnFee: ожидается 0…1");
  }

  if (!(repair.hoursWithSpare >= 1)) errors.push("repair.hoursWithSpare: должно быть ≥ 1");
  if (!(repair.hoursWithoutSpare >= repair.hoursWithSpare)) {
    errors.push("repair.hoursWithoutSpare: должен быть не меньше hoursWithSpare");
  }

  if (!Array.isArray(data.components) || data.components.length === 0) {
    errors.push("components: нужен хотя бы один компонент");
    return errors;
  }

  const ids = data.components.map((component) => component.id);
  if (new Set(ids).size !== ids.length) {
    errors.push("components: id должны быть уникальны");
  }
  const byId = new Map(data.components.map((component) => [component.id, component]));

  for (const component of data.components) {
    const prefix = `components.${component.id}`;
    if (!component.id || typeof component.id !== "string") errors.push("components: пустой id");
    if (!COMPONENT_TYPES.includes(component.type)) errors.push(`${prefix}.type: неизвестный тип`);
    if (typeof component.name !== "string" || !component.name.trim()) errors.push(`${prefix}.name: пустое имя`);
    if (!Number.isInteger(component.tier) || component.tier < 1 || component.tier > 5) {
      errors.push(`${prefix}.tier: ожидается целое 1…5`);
    }
    if (!Number.isInteger(component.generation) || component.generation < 1) {
      errors.push(`${prefix}.generation: ожидается целое ≥ 1`);
    }
    if (!isPositiveNumber(component.price)) errors.push(`${prefix}.price: должно быть > 0`);
    if (!isNonNegativeNumber(component.power)) errors.push(`${prefix}.power: должно быть ≥ 0`);
    if (!isPositiveNumber(component.mtbfDays)) errors.push(`${prefix}.mtbfDays: должно быть > 0`);
    if (!(component.noiseDb >= 0 && component.noiseDb <= 80)) errors.push(`${prefix}.noiseDb: ожидается 0…80`);
    if (typeof component.specs !== "object" || component.specs === null) {
      errors.push(`${prefix}.specs: ожидался объект`);
      continue;
    }

    switch (component.type) {
      case "cpu":
        if (typeof component.socket !== "string" || !component.socket) errors.push(`${prefix}.socket: обязателен для ЦП`);
        if (!isPositiveNumber(component.specs.cores)) errors.push(`${prefix}.specs.cores: должно быть > 0`);
        break;
      case "motherboard":
        if (typeof component.socket !== "string" || !component.socket) errors.push(`${prefix}.socket: обязателен для платы`);
        if (typeof component.ramType !== "string" || !component.ramType) errors.push(`${prefix}.ramType: обязателен для платы`);
        if (typeof component.formFactor !== "string" || !component.formFactor) errors.push(`${prefix}.formFactor: обязателен для платы`);
        if (!Number.isInteger(component.specs.ramSlots) || (component.specs.ramSlots ?? 0) < 1) {
          errors.push(`${prefix}.specs.ramSlots: ожидается целое ≥ 1`);
        }
        if (!isPositiveNumber(component.specs.maxRamGb)) errors.push(`${prefix}.specs.maxRamGb: должно быть > 0`);
        break;
      case "ram":
        if (typeof component.ramType !== "string" || !component.ramType) errors.push(`${prefix}.ramType: обязателен для ОЗУ`);
        if (!isPositiveNumber(component.specs.capacityGb)) errors.push(`${prefix}.specs.capacityGb: должно быть > 0`);
        break;
      case "storage":
        if (!isPositiveNumber(component.specs.capacityGb)) errors.push(`${prefix}.specs.capacityGb: должно быть > 0`);
        if (!["hdd", "ssd", "nvme"].includes(component.specs.kind ?? "")) {
          errors.push(`${prefix}.specs.kind: ожидается hdd/ssd/nvme`);
        }
        break;
      case "psu":
        if (!isPositiveNumber(component.specs.wattage)) errors.push(`${prefix}.specs.wattage: должно быть > 0`);
        break;
      case "case":
        if (!["tower", "1u", "2u"].includes(component.formFactor ?? "")) {
          errors.push(`${prefix}.formFactor: ожидается tower/1u/2u`);
        }
        if (!Array.isArray(component.specs.supportedBoardFormFactors) || component.specs.supportedBoardFormFactors.length === 0) {
          errors.push(`${prefix}.specs.supportedBoardFormFactors: нужен непустой список`);
        }
        if (!Number.isInteger(component.specs.driveBays) || (component.specs.driveBays ?? 0) < 1) {
          errors.push(`${prefix}.specs.driveBays: ожидается целое ≥ 1`);
        }
        break;
      case "nic":
        if (!isPositiveNumber(component.specs.networkMbit)) errors.push(`${prefix}.specs.networkMbit: должно быть > 0`);
        break;
    }
  }

  const cpus = data.components.filter((component) => component.type === "cpu");
  const boards = data.components.filter((component) => component.type === "motherboard");
  const memories = data.components.filter((component) => component.type === "ram");
  const cases = data.components.filter((component) => component.type === "case");
  for (const type of COMPONENT_TYPES) {
    if (!data.components.some((component) => component.type === type)) {
      errors.push(`components: нет ни одного компонента типа ${type}`);
    }
  }
  for (const cpu of cpus) {
    if (cpu.socket && !boards.some((board) => board.socket === cpu.socket)) {
      errors.push(`components.${cpu.id}.socket: нет материнской платы с сокетом ${cpu.socket}`);
    }
  }
  for (const board of boards) {
    if (board.ramType && !memories.some((memory) => memory.ramType === board.ramType)) {
      errors.push(`components.${board.id}.ramType: нет ОЗУ типа ${board.ramType}`);
    }
    if (
      board.formFactor &&
      !cases.some((box) => box.specs.supportedBoardFormFactors?.includes(board.formFactor ?? "") === true)
    ) {
      errors.push(`components.${board.id}.formFactor: ни один корпус не поддерживает ${board.formFactor}`);
    }
  }

  if (!Array.isArray(data.startBuild.parts) || data.startBuild.parts.length === 0) {
    errors.push("startBuild.parts: нужен непустой список");
  } else {
    for (const id of data.startBuild.parts) {
      if (!byId.has(id)) errors.push(`startBuild.parts: неизвестная комплектующая ${id}`);
    }
    const startTypes = data.startBuild.parts.map((id) => byId.get(id)?.type).filter(Boolean);
    for (const type of COMPONENT_TYPES) {
      if (!startTypes.includes(type)) errors.push(`startBuild.parts: нет компонента типа ${type}`);
    }
  }

  return errors;
}
