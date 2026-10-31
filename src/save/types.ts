import type { DifficultyId } from "../data";
import type { GameState } from "../sim";

export type ManualSlotId = "slot1" | "slot2" | "slot3" | "slot4" | "slot5" | "slot6";
export type SpecialSlotId = "autosave" | "quicksave";
export type SaveSlotId = ManualSlotId | SpecialSlotId;

export const MANUAL_SLOTS: readonly ManualSlotId[] = ["slot1", "slot2", "slot3", "slot4", "slot5", "slot6"];
export const SPECIAL_SLOTS: readonly SpecialSlotId[] = ["autosave", "quicksave"];

/** Порядок отображения в диалоге слотов. */
export const SAVE_SLOTS: readonly SaveSlotId[] = [...SPECIAL_SLOTS, ...MANUAL_SLOTS];

export const SAVE_FORMAT = "uptime-save";

export interface SaveMeta {
  slot: SaveSlotId;
  companyName: string;
  difficulty: DifficultyId;
  /** Суммарные игровые сутки (с 0). */
  day: number;
  year: number;
  month: number;
  dayOfMonth: number;
  hourOfDay: number;
  money: number;
  /** ISO-время записи файла. */
  savedAt: string;
  saveVersion: number;
  gameVersion: string;
}

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  game: GameState;
}

export function isSaveSlotId(value: unknown): value is SaveSlotId {
  return typeof value === "string" && (SAVE_SLOTS as readonly string[]).includes(value);
}

export function isManualSlotId(value: unknown): value is ManualSlotId {
  return typeof value === "string" && (MANUAL_SLOTS as readonly string[]).includes(value);
}
