import { describe, expect, it } from "vitest";
import {
  actionForEvent,
  DEFAULT_HOTKEYS,
  eventToBinding,
  findConflict,
  formatBinding,
  resetHotkeys,
  sanitizeHotkeys,
  withBinding,
} from "../src/state/hotkeys";

describe("горячие клавиши", () => {
  it("собирает комбинацию из модификаторов и кода клавиши", () => {
    expect(eventToBinding({ code: "KeyS", ctrlKey: true })).toBe("Control+KeyS");
    expect(eventToBinding({ code: "F3" })).toBe("F3");
    expect(eventToBinding({ code: "ControlLeft", ctrlKey: true })).toBeNull();
    expect(eventToBinding({ code: "" })).toBeNull();
  });

  it("форматирует подписи для ru и en", () => {
    expect(formatBinding("Control+KeyS", "ru")).toBe("Ctrl+S");
    expect(formatBinding("Space", "ru")).toBe("Пробел");
    expect(formatBinding("Space", "en")).toBe("Space");
    expect(formatBinding("Digit1", "en")).toBe("1");
    expect(formatBinding(null, "en")).toBe("—");
  });

  it("находит действие по событию", () => {
    expect(actionForEvent(DEFAULT_HOTKEYS, { code: "Space" })).toBe("pause");
    expect(actionForEvent(DEFAULT_HOTKEYS, { code: "KeyS", ctrlKey: true })).toBe("quickSave");
    expect(actionForEvent(DEFAULT_HOTKEYS, { code: "KeyQ" })).toBeNull();
  });

  it("находит конфликт привязки", () => {
    const conflict = findConflict(DEFAULT_HOTKEYS, "speed1", "Space");
    expect(conflict).toEqual({ action: "pause", slot: 0 });
    expect(findConflict(DEFAULT_HOTKEYS, "speed1", "KeyQ")).toBeNull();
    expect(findConflict(DEFAULT_HOTKEYS, "speed1", null)).toBeNull();
  });

  it("переносит клавишу на новое действие и снимает со старого", () => {
    const next = withBinding(DEFAULT_HOTKEYS, "speed1", 0, "Space");
    expect(next.speed1[0]).toBe("Space");
    expect(next.pause[0]).toBeNull();
    // Исходный набор не меняется.
    expect(DEFAULT_HOTKEYS.speed1[0]).toBe("Digit1");
    expect(DEFAULT_HOTKEYS.pause[0]).toBe("Space");
  });

  it("очищает привязку", () => {
    const next = withBinding(DEFAULT_HOTKEYS, "pause", 0, null);
    expect(next.pause[0]).toBeNull();
    expect(actionForEvent(next, { code: "Space" })).toBeNull();
  });

  it("сбрасывает набор к значениям по умолчанию", () => {
    const next = resetHotkeys();
    expect(next).toEqual(DEFAULT_HOTKEYS);
    next.pause[0] = "KeyP";
    expect(DEFAULT_HOTKEYS.pause[0]).toBe("Space");
  });

  it("приводит испорченный файл к корректному набору", () => {
    const hotkeys = sanitizeHotkeys({
      pause: ["KeyP", "KeyP"],
      speed1: ["Space", 42],
      unknown: ["KeyX"],
    });
    expect(hotkeys.pause[0]).toBe("KeyP");
    expect(hotkeys.pause[1]).toBeNull();
    expect(hotkeys.speed1[0]).toBe("Space");
    expect(hotkeys.speed1[1]).toBeNull();
    expect(hotkeys.speed2).toEqual(DEFAULT_HOTKEYS.speed2);
  });

  it("не принимает мусор вместо набора", () => {
    expect(sanitizeHotkeys("nope")).toEqual(DEFAULT_HOTKEYS);
    expect(sanitizeHotkeys(null)).toEqual(DEFAULT_HOTKEYS);
  });
});
