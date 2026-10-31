import type { Language } from "../i18n/language";

export type HotkeyAction =
  | "pause"
  | "speed1"
  | "speed2"
  | "speed3"
  | "speed4"
  | "quickSave"
  | "quickLoad"
  | "debug"
  | "pauseMenu";

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  "pause",
  "speed1",
  "speed2",
  "speed3",
  "speed4",
  "quickSave",
  "quickLoad",
  "debug",
  "pauseMenu",
];

/** Две привязки на действие: [основная, дополнительная]. null — не назначено. */
export type HotkeyBinding = string | null;

export type HotkeysSettings = Record<HotkeyAction, [HotkeyBinding, HotkeyBinding]>;

export const DEFAULT_HOTKEYS: HotkeysSettings = {
  pause: ["Space", null],
  speed1: ["Digit1", null],
  speed2: ["Digit2", null],
  speed3: ["Digit3", null],
  speed4: ["Digit4", null],
  quickSave: ["Control+KeyS", null],
  quickLoad: ["Control+KeyL", null],
  debug: ["F3", null],
  pauseMenu: ["Escape", null],
};

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

const SPECIAL_LABELS: Record<string, { ru: string; en: string }> = {
  Space: { ru: "Пробел", en: "Space" },
  Escape: { ru: "Esc", en: "Esc" },
  Enter: { ru: "Enter", en: "Enter" },
  Tab: { ru: "Tab", en: "Tab" },
  Backspace: { ru: "Backspace", en: "Backspace" },
  ArrowUp: { ru: "↑", en: "↑" },
  ArrowDown: { ru: "↓", en: "↓" },
  ArrowLeft: { ru: "←", en: "←" },
  ArrowRight: { ru: "→", en: "→" },
  Backquote: { ru: "`", en: "`" },
  Minus: { ru: "-", en: "-" },
  Equal: { ru: "=", en: "=" },
  BracketLeft: { ru: "[", en: "[" },
  BracketRight: { ru: "]", en: "]" },
  Backslash: { ru: "\\", en: "\\" },
  Semicolon: { ru: ";", en: ";" },
  Quote: { ru: "'", en: "'" },
  Comma: { ru: ",", en: "," },
  Period: { ru: ".", en: "." },
  Slash: { ru: "/", en: "/" },
  Delete: { ru: "Delete", en: "Delete" },
  Home: { ru: "Home", en: "Home" },
  End: { ru: "End", en: "End" },
  PageUp: { ru: "PgUp", en: "PgUp" },
  PageDown: { ru: "PgDn", en: "PgDn" },
  Insert: { ru: "Ins", en: "Ins" },
};

/** Превращает событие клавиатуры в строку привязки. Модификаторы идут первыми. */
export function eventToBinding(event: {
  code: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(event.code);
  return parts.join("+");
}

export function bindingMatches(
  event: { code: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean },
  binding: HotkeyBinding,
): boolean {
  if (!binding) return false;
  return eventToBinding(event) === binding;
}

/** Человекочитаемая подпись: «Ctrl+S», «Пробел», «F3». */
export function formatBinding(binding: HotkeyBinding, language: Language): string {
  if (!binding) return "—";

  const parts = binding.split("+");
  const code = parts.pop() ?? "";
  const labels = parts.map((modifier) => {
    if (modifier === "Control") return "Ctrl";
    if (modifier === "Meta") return language === "ru" ? "Win" : "Cmd";
    return modifier;
  });

  let keyLabel = SPECIAL_LABELS[code]?.[language];
  if (!keyLabel && code.startsWith("Key")) keyLabel = code.slice(3);
  if (!keyLabel && code.startsWith("Digit")) keyLabel = code.slice(5);
  if (!keyLabel && code.startsWith("Numpad")) keyLabel = `Num ${code.slice(6)}`;
  if (!keyLabel && /^F\d{1,2}$/.test(code)) keyLabel = code;
  if (!keyLabel) keyLabel = code;

  return [...labels, keyLabel].join("+");
}

/** Ищет, кому ещё назначена эта привязка. */
export function findConflict(
  hotkeys: HotkeysSettings,
  action: HotkeyAction,
  binding: HotkeyBinding,
): { action: HotkeyAction; slot: 0 | 1 } | null {
  if (!binding) return null;
  for (const candidate of HOTKEY_ACTIONS) {
    if (candidate === action) continue;
    const bindings = hotkeys[candidate];
    for (let slot = 0; slot < 2; slot += 1) {
      if (bindings[slot] === binding) return { action: candidate, slot: slot as 0 | 1 };
    }
  }
  return null;
}

/**
 * Новый набор привязок: значение ставится в слот, та же клавиша снимается
 * с других действий (одна клавиша — одно действие).
 */
export function withBinding(
  hotkeys: HotkeysSettings,
  action: HotkeyAction,
  slot: 0 | 1,
  binding: HotkeyBinding,
): HotkeysSettings {
  const next: HotkeysSettings = { ...hotkeys };
  for (const candidate of HOTKEY_ACTIONS) {
    next[candidate] = [...hotkeys[candidate]] as [HotkeyBinding, HotkeyBinding];
  }

  if (binding) {
    for (const candidate of HOTKEY_ACTIONS) {
      const bindings = next[candidate];
      for (let index = 0; index < 2; index += 1) {
        if (bindings[index] === binding && !(candidate === action && index === slot)) {
          bindings[index] = null;
        }
      }
    }
  }

  next[action][slot] = binding;
  return next;
}

export function resetHotkeys(): HotkeysSettings {
  const next = {} as HotkeysSettings;
  for (const action of HOTKEY_ACTIONS) {
    next[action] = [...DEFAULT_HOTKEYS[action]] as [HotkeyBinding, HotkeyBinding];
  }
  return next;
}

/** Приводит произвольные данные из settings.json к корректному набору привязок. */
export function sanitizeHotkeys(raw: unknown): HotkeysSettings {
  const result = resetHotkeys();
  if (typeof raw !== "object" || raw === null) return result;

  const source = raw as Record<string, unknown>;
  const used = new Set<string>();

  for (const action of HOTKEY_ACTIONS) {
    const value = source[action];
    if (!Array.isArray(value)) continue;

    for (let slot = 0; slot < 2; slot += 1) {
      const binding = value[slot];
      if (typeof binding !== "string" || binding.length === 0 || binding.length > 64) {
        result[action][slot] = null;
        continue;
      }
      if (used.has(binding)) {
        result[action][slot] = null;
        continue;
      }
      used.add(binding);
      result[action][slot] = binding;
    }
  }

  return result;
}

export function actionForEvent(hotkeys: HotkeysSettings, event: Parameters<typeof eventToBinding>[0]): HotkeyAction | null {
  const binding = eventToBinding(event);
  if (!binding) return null;
  for (const action of HOTKEY_ACTIONS) {
    if (hotkeys[action].includes(binding)) return action;
  }
  return null;
}
