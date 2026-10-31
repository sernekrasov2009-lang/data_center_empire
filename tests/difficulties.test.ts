import { describe, expect, it } from "vitest";
import { DIFFICULTY_IDS, difficulties, getDifficulty, validateDifficulties } from "../src/data";

describe("difficulties.json", () => {
  it("проходит валидацию", () => {
    expect(validateDifficulties(difficulties)).toEqual([]);
  });

  it("содержит все режимы по одному разу", () => {
    const ids = difficulties.modes.map((mode) => mode.id);
    expect(ids.slice().sort()).toEqual([...DIFFICULTY_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("по умолчанию выбирает обычную сложность", () => {
    expect(difficulties.defaultMode).toBe("normal");
    expect(getDifficulty("normal").startMoney).toBe(800);
  });

  it("задаёт отличия режимов", () => {
    const calm = getDifficulty("calm");
    const hard = getDifficulty("hard");
    const sandbox = getDifficulty("sandbox");

    expect(calm.bankruptcy).toBe("warnings");
    expect(hard.failureRateMult).toBeGreaterThan(1);
    expect(hard.slaPenaltyMult).toBeGreaterThan(1);
    expect(sandbox.startMoney).toBeGreaterThan(100_000);
    expect(sandbox.failureRateMult).toBe(0);
    expect(sandbox.eventRateMult).toBe(0);
    expect(sandbox.bankruptcy).toBe("none");
  });

  it("ловит испорченные данные", () => {
    const broken = {
      ...difficulties,
      defaultMode: "nightmare" as never,
      modes: [
        { ...getDifficulty("normal"), id: "normal" as const, startMoney: 0 },
        { ...getDifficulty("normal"), id: "normal" as const },
      ],
    };
    const errors = validateDifficulties(broken);
    expect(errors.join("\n")).toContain("startMoney");
    expect(errors.join("\n")).toContain("уникальны");
    expect(errors.join("\n")).toContain("defaultMode");
    expect(errors.join("\n")).toContain("calm");
  });
});
