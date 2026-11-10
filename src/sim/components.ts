import {
  economy as economyData,
  getComponent,
  hardware as hardwareData,
  type Component,
  type ComponentCondition,
  type ComponentType,
} from "../data";
import type { GameState, HardwareBuild } from "./types";

/** Округление денег до центов. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Текущая цена новой детали с учётом месячного колебания рынка. */
export function newPartPrice(componentId: string, marketPriceMult = 1): number {
  const component = getComponent(componentId);
  return roundMoney(component.price * marketPriceMult);
}

/** Логарифмическая сумма шума: 30 дБ + 30 дБ ≈ 33 дБ, а не 60. */
export function noiseSum(values: readonly number[]): number {
  const total = values.reduce((sum, db) => sum + 10 ** (db / 10), 0);
  return total > 0 ? 10 * Math.log10(total) : 0;
}

export interface BuildStats {
  cores: number;
  threads: number;
  ramGb: number;
  storageGb: number;
  /** Суммарное потребление, Вт. */
  power: number;
  noiseDb: number;
  /** Базовая стоимость деталей по каталогу. */
  price: number;
  psuWattage: number;
  /** Отношение мощности БП к потреблению; 0 — БП нет. */
  psuHeadroom: number;
  partCount: number;
}

export type BuildErrorCode =
  | "missingCpu"
  | "missingMotherboard"
  | "missingPsu"
  | "missingCase"
  | "missingNic"
  | "missingRam"
  | "missingStorage"
  | "tooManyCpu"
  | "tooManyMotherboard"
  | "tooManyPsu"
  | "tooManyCase"
  | "tooManyNic"
  | "tooManyRam"
  | "tooManyStorage"
  | "socketMismatch"
  | "ramTypeMismatch"
  | "boardFormFactorMismatch"
  | "psuTooWeak"
  | "ramCapacityExceeded";

export interface BuildError {
  code: BuildErrorCode;
  params?: Record<string, string | number>;
}

export interface BuildValidation {
  ok: boolean;
  errors: BuildError[];
  stats: BuildStats;
}

/** Характеристики набора деталей. */
export function buildStats(componentIds: readonly string[]): BuildStats {
  const components = componentIds.map(getComponent);
  const byType = (type: ComponentType): Component[] => components.filter((component) => component.type === type);

  const cores = byType("cpu").reduce((sum, component) => sum + (component.specs.cores ?? 0), 0);
  const threads = byType("cpu").reduce((sum, component) => sum + (component.specs.threads ?? component.specs.cores ?? 0), 0);
  const ramGb = byType("ram").reduce((sum, component) => sum + (component.specs.capacityGb ?? 0), 0);
  const storageGb = byType("storage").reduce((sum, component) => sum + (component.specs.capacityGb ?? 0), 0);
  const power = components.reduce((sum, component) => sum + component.power, 0);
  const psu = byType("psu")[0];
  const psuWattage = psu?.specs.wattage ?? 0;

  return {
    cores,
    threads,
    ramGb,
    storageGb,
    power,
    noiseDb: noiseSum(components.map((component) => component.noiseDb)),
    price: roundMoney(components.reduce((sum, component) => sum + component.price, 0)),
    psuWattage,
    psuHeadroom: power > 0 ? psuWattage / power : 0,
    partCount: components.length,
  };
}

/** Стоимость сборки по фактическим ценам покупки (б/у дешевле). */
export function buildValue(build: HardwareBuild): number {
  return roundMoney(build.parts.reduce((sum, part) => sum + part.purchasePrice, 0));
}

export function buildStatsForBuild(build: HardwareBuild): BuildStats {
  const stats = buildStats(build.parts.map((part) => part.componentId));
  return { ...stats, price: buildValue(build) };
}

/** Потребление готового сервера, Вт. Неработающие детали всё равно питаются. */
export function buildPowerW(build: HardwareBuild): number {
  return build.parts.reduce((sum, part) => sum + getComponent(part.componentId).power, 0);
}

/** Текущая ИТ-нагрузка: сумма готовых сборок, иначе стартовые 100 Вт из economy.json. */
export function hardwareLoadW(state: GameState): number {
  const ready = state.hardware.builds.filter((build) => build.status === "ready");
  if (ready.length === 0) return economyData.start.itLoadW;
  return ready.reduce((sum, build) => sum + buildPowerW(build), 0);
}

/** Сколько игровых часов займёт сборка у себя. */
export function buildHours(partCount: number): number {
  const hours = Math.ceil(Math.max(0, partCount) / hardwareData.build.partsPerHour);
  return Math.min(hardwareData.build.maxHours, Math.max(0, hours));
}

/** Проверка совместимости и полноты набора. */
export function validateBuild(componentIds: readonly string[]): BuildValidation {
  const components = componentIds.map(getComponent);
  const errors: BuildError[] = [];
  const byType = (type: ComponentType): Component[] => components.filter((component) => component.type === type);

  const cpus = byType("cpu");
  const boards = byType("motherboard");
  const memories = byType("ram");
  const storages = byType("storage");
  const psus = byType("psu");
  const cases = byType("case");
  const nics = byType("nic");

  if (cpus.length === 0) errors.push({ code: "missingCpu" });
  if (boards.length === 0) errors.push({ code: "missingMotherboard" });
  if (psus.length === 0) errors.push({ code: "missingPsu" });
  if (cases.length === 0) errors.push({ code: "missingCase" });
  if (nics.length === 0) errors.push({ code: "missingNic" });
  if (memories.length === 0) errors.push({ code: "missingRam" });
  if (storages.length === 0) errors.push({ code: "missingStorage" });

  if (cpus.length > 1) errors.push({ code: "tooManyCpu" });
  if (boards.length > 1) errors.push({ code: "tooManyMotherboard" });
  if (psus.length > 1) errors.push({ code: "tooManyPsu" });
  if (cases.length > 1) errors.push({ code: "tooManyCase" });
  if (nics.length > 1) errors.push({ code: "tooManyNic" });

  const board = boards[0];
  const cpu = cpus[0];
  const box = cases[0];
  const psu = psus[0];
  const maxRam = board?.specs.ramSlots ?? hardwareData.build.maxRamSticksFallback;
  const maxStorage = box?.specs.driveBays ?? hardwareData.build.maxStorageFallback;

  if (memories.length > maxRam) errors.push({ code: "tooManyRam", params: { max: maxRam } });
  if (storages.length > maxStorage) errors.push({ code: "tooManyStorage", params: { max: maxStorage } });

  if (cpu && board && cpu.socket !== board.socket) {
    errors.push({
      code: "socketMismatch",
      params: { cpu: cpu.socket ?? "—", board: board.socket ?? "—" },
    });
  }

  if (board) {
    const wrongRam = memories.find((memory) => memory.ramType !== board.ramType);
    if (wrongRam) {
      errors.push({
        code: "ramTypeMismatch",
        params: { ram: wrongRam.ramType ?? "—", board: board.ramType ?? "—" },
      });
    }

    if (box && board.formFactor) {
      const supported = box.specs.supportedBoardFormFactors ?? [];
      if (!supported.includes(board.formFactor)) {
        errors.push({
          code: "boardFormFactorMismatch",
          params: { board: board.formFactor, box: box.formFactor ?? "—" },
        });
      }
    }

    const capacity = memories.reduce((sum, memory) => sum + (memory.specs.capacityGb ?? 0), 0);
    const maxCapacity = board.specs.maxRamGb ?? 0;
    if (maxCapacity > 0 && capacity > maxCapacity) {
      errors.push({ code: "ramCapacityExceeded", params: { capacity, max: maxCapacity } });
    }
  }

  const stats = buildStats(componentIds);
  if (psu) {
    const required = stats.power * hardwareData.compatibility.psuHeadroom;
    if ((psu.specs.wattage ?? 0) < required) {
      errors.push({
        code: "psuTooWeak",
        params: {
          wattage: psu.specs.wattage ?? 0,
          required: Math.ceil(required),
        },
      });
    }
  }

  return { ok: errors.length === 0, errors, stats };
}

/**
 * Вероятность отказа детали за сутки:
 * p = (1 / mtbfDays) × heatMult × ageMult × множитель сложности.
 * У б/у деталей MTBF вдвое ниже (DESIGN.md, разд. 3.6).
 */
export function failureProbability(
  component: Component,
  condition: ComponentCondition,
  ageYears: number,
  temperatureC: number,
  failureRateMult: number,
): number {
  const mtbf = component.mtbfDays * (condition === "used" ? hardwareData.market.usedMtbfMult : 1);
  const heatMult = 1 + Math.max(0, temperatureC - 35) / 10;
  const ageMult = 1 + Math.max(0, ageYears) * 0.15;
  const probability = (1 / mtbf) * heatMult * ageMult * failureRateMult;
  return Math.min(1, Math.max(0, probability));
}
