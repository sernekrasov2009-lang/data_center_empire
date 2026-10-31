import { describe, expect, it } from "vitest";
import { GAME_STATE_VERSION, createGame } from "../src/sim";
import { buildSaveMeta } from "../src/save/meta";
import { SaveError, buildEnvelope, migrateGame, parseSave } from "../src/save/migrate";
import { SAVE_FORMAT } from "../src/save/types";

const legacy = {
  version: 1,
  seed: 7,
  rng: { seed: 7, s: 7 },
  time: { hour: 48, speed: 5, paused: false },
  money: 1234,
  stats: { ticks: 48 },
  events: [
    { id: 1, kind: "dayStarted", hour: 24 },
    { id: 2, kind: "unknownKind", hour: 25 },
  ],
  nextEventId: 3,
};

describe("миграции сохранений", () => {
  it("поднимает сохранение версии 1 до текущей", () => {
    const game = migrateGame(legacy);
    expect(game.version).toBe(GAME_STATE_VERSION);
    expect(game.companyName).toBe("Uptime Hosting");
    expect(game.difficulty).toBe("normal");
    expect(game.time.hour).toBe(48);
    expect(game.money).toBe(1234);
    expect(game.events).toHaveLength(1);
  });

  it("сохраняет корректные поля новой версии", () => {
    const source = createGame({ seed: 42, difficulty: "hard", companyName: "Acme" });
    const game = migrateGame(source);
    expect(game.companyName).toBe("Acme");
    expect(game.difficulty).toBe("hard");
    expect(game.seed).toBe(42);
    expect(game.rng).toEqual(source.rng);
  });

  it("заменяет неизвестные значения безопасными", () => {
    const game = migrateGame({
      ...legacy,
      difficulty: "nightmare",
      companyName: "   ",
      time: { hour: 10, speed: 7, paused: "no" },
    });
    expect(game.difficulty).toBe("normal");
    expect(game.companyName).toBe("Uptime Hosting");
    expect(game.time.speed).toBe(1);
    expect(game.time.paused).toBe(true);
  });

  it("отбрасывает сохранение без игрового времени", () => {
    expect(() => migrateGame({ ...legacy, time: undefined })).toThrow(SaveError);
    expect(() => migrateGame({ ...legacy, time: { hour: -1 } })).toThrow(SaveError);
    expect(() => migrateGame(null)).toThrow(SaveError);
    expect(() => migrateGame([])).toThrow(SaveError);
  });

  it("читает конверт с метаданными", () => {
    const game = createGame({ seed: 11, companyName: "Envelope Inc" });
    const meta = buildSaveMeta("slot3", game, "0.1.0");
    const envelope = buildEnvelope(meta, game);
    expect(envelope.format).toBe(SAVE_FORMAT);

    const parsed = parseSave(envelope, "slot3");
    expect(parsed.meta?.companyName).toBe("Envelope Inc");
    expect(parsed.meta?.slot).toBe("slot3");
    expect(parsed.game.companyName).toBe("Envelope Inc");
    expect(parsed.migratedFrom).toBeNull();
  });

  it("читает «голый» GameState и сообщает версию миграции", () => {
    const parsed = parseSave(legacy, "slot2");
    expect(parsed.meta).toBeNull();
    expect(parsed.game.version).toBe(GAME_STATE_VERSION);
    expect(parsed.migratedFrom).toBe(1);
  });

  it("строит метаданные из игрового времени", () => {
    const game = createGame({ seed: 1, companyName: "Meta LLC", difficulty: "calm" });
    const advanced = { ...game, time: { ...game.time, hour: 24 * 31 + 5 }, money: 999 };
    const meta = buildSaveMeta("autosave", advanced, "9.9.9");
    expect(meta.slot).toBe("autosave");
    expect(meta.companyName).toBe("Meta LLC");
    expect(meta.difficulty).toBe("calm");
    expect(meta.day).toBe(31);
    expect(meta.month).toBe(2);
    expect(meta.dayOfMonth).toBe(2);
    expect(meta.hourOfDay).toBe(5);
    expect(meta.money).toBe(999);
    expect(meta.saveVersion).toBe(GAME_STATE_VERSION);
    expect(meta.gameVersion).toBe("9.9.9");
    expect(Number.isNaN(Date.parse(meta.savedAt))).toBe(false);
  });
});
