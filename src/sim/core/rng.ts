import type { RngState } from "../types";

/**
 * Детерминированный RNG (mulberry32). Вся случайность в игре идёт через него,
 * `Math.random` запрещён (GAME.md, разд. 4).
 * Состояние хранится в обычном объекте, поэтому сериализуется вместе с сейвом.
 */
export function createRng(seed: number): RngState {
  const normalized = seed >>> 0;
  return { seed: normalized, s: normalized === 0 ? 0x9e3779b9 : normalized };
}

export function nextUint32(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Равномерное число в [0, 1). */
export function nextFloat(rng: RngState): number {
  return nextUint32(rng) / 0x100000000;
}

/** Целое в [min, max] включительно. */
export function nextInt(rng: RngState, min: number, max: number): number {
  if (max < min) {
    throw new RangeError(`nextInt: max (${max}) меньше min (${min})`);
  }
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

/** Проверка вероятности p ∈ [0, 1]. */
export function chance(rng: RngState, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return nextFloat(rng) < p;
}

/** Случайный элемент непустого массива. */
export function pick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) {
    throw new RangeError("pick: пустой массив");
  }
  const item = items[nextInt(rng, 0, items.length - 1)];
  // noUncheckedIndexedAccess: индекс всегда в диапазоне.
  return item as T;
}
