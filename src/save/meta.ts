import type { GameState } from "../sim";
import { getGameDate } from "../sim";
import { GAME_STATE_VERSION } from "../sim";
import type { SaveMeta, SaveSlotId } from "./types";

export function buildSaveMeta(slot: SaveSlotId, game: GameState, gameVersion: string): SaveMeta {
  const date = getGameDate(game.time.hour);
  return {
    slot,
    companyName: game.companyName,
    difficulty: game.difficulty,
    day: date.totalDays,
    year: date.year,
    month: date.month,
    dayOfMonth: date.dayOfMonth,
    hourOfDay: date.hourOfDay,
    money: game.money,
    savedAt: new Date().toISOString(),
    saveVersion: GAME_STATE_VERSION,
    gameVersion,
  };
}
