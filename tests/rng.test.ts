import { describe, expect, it } from "vitest";
import { chance, createRng, nextFloat, nextInt, nextUint32, pick } from "../src/sim";

describe("seeded RNG", () => {
  it("детерминирован для одного seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => nextUint32(a));
    const seqB = Array.from({ length: 50 }, () => nextUint32(b));
    expect(seqA).toEqual(seqB);
  });

  it("разные seed дают разные последовательности", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => nextUint32(a));
    const seqB = Array.from({ length: 20 }, () => nextUint32(b));
    expect(seqA).not.toEqual(seqB);
  });

  it("продолжает последовательность из сохранённого состояния", () => {
    const rng = createRng(7);
    for (let i = 0; i < 10; i += 1) nextUint32(rng);
    const snapshot = JSON.parse(JSON.stringify(rng)) as typeof rng;
    const fromSnapshot = Array.from({ length: 10 }, () => nextUint32(snapshot));
    const fromLive = Array.from({ length: 10 }, () => nextUint32(rng));
    expect(fromSnapshot).toEqual(fromLive);
  });

  it("держит диапазоны", () => {
    const rng = createRng(123);
    for (let i = 0; i < 1000; i += 1) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);

      const int = nextInt(rng, 3, 9);
      expect(Number.isInteger(int)).toBe(true);
      expect(int).toBeGreaterThanOrEqual(3);
      expect(int).toBeLessThanOrEqual(9);
    }
  });

  it("chance и pick ведут себя предсказуемо на краях", () => {
    const rng = createRng(5);
    expect(chance(rng, 0)).toBe(false);
    expect(chance(rng, 1)).toBe(true);
    expect(pick(rng, ["a"])).toBe("a");
    expect(() => pick(rng, [])).toThrow(RangeError);
    expect(() => nextInt(rng, 5, 1)).toThrow(RangeError);
  });
});
