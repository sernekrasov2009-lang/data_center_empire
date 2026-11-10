import rawBalance from "./balance.json";
import rawComponents from "./components.json";
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