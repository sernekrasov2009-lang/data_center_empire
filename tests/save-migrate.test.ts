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

  it("поднимает сохранение версии 2 до 3 с пустой экономикой", () => {
    const game = migrateGame({ ...legacy, version: 2 });
    expect(game.version).toBe(GAME_STATE_VERSION);
    expect(game.economy).toEqual({
      accrual: { electricity: 0, internet: 0, rent: 0 },
      reports: [],
      lifetime: { revenue: 0, expenses: 0 },
      electricityPriceMult: 1,
      lowMoneyWarned: false,
    });
    expect(game.gameOver).toBeNull();
  });

  it("сохраняет экономику, отчёты и экран банкротства", () => {
    const source = createGame({ money: 1200 });
    const withEconomy = {
      ...source,
      money: -2100,
      economy: {
        ...source.economy,
        accrual: { electricity: 1.5, internet: 0, rent: 0 },
        reports: [
          {
            hour: 720,
            year: 1,
            month: 1,
            revenue: 10,
            expenses: { electricity: 15.5, internet: 20, rent: 0 },
            totalExpenses: 35.5,
            net: -25.5,
            moneyAfter: 1174.5,
          },
        ],
        lifetime: { revenue: 10, expenses: 35.5 },
        electricityPriceMult: 1.1,
        lowMoneyWarned: true,
      },
      gameOver: { hour: 720, money: -2100 },
    };

    const game = migrateGame(withEconomy);
    expect(game.economy.reports).toHaveLength(1);
    expect(game.economy.reports[0]).toMatchObject({ month: 1, net: -25.5 });
    expect(game.economy.electricityPriceMult).toBeCloseTo(1.1, 10);
    expect(game.economy.lowMoneyWarned).toBe(true);
    expect(game.gameOver).toEqual({ hour: 720, money: -2100 });
  });

  it("чистит испорченную экономику", () => {
    const source = createGame();
    const game = migrateGame({
      ...source,
      economy: {
        accrual: { electricity: -5 },
        reports: [{ hour: 720, year: -1, month: 99, expenses: { internet: -4 } }],
        lifetime: { expenses: -100 },
        electricityPriceMult: 99,
      },
    });

    expect(game.economy.accrual.electricity).toBe(0);
    expect(game.economy.reports[0]).toMatchObject({ year: 1, month: 12 });
    expect(game.economy.reports[0]!.expenses.internet).toBe(0);
    expect(game.economy.lifetime.expenses).toBe(0);
    expect(game.economy.electricityPriceMult).toBe(1.2);
  });

  it("сохраняет новые виды событий и суммы", () => {
    const game = migrateGame({
      ...legacy,
      version: 3,
      events: [
        { id: 1, kind: "billPaid", hour: 720, amount: 35.55 },
        { id: 2, kind: "bankrupted", hour: 720, amount: -2001 },
        { id: 3, kind: "unknownKind", hour: 721 },
      ],
    });
    expect(game.events.map((event) => event.kind)).toEqual(["billPaid", "bankrupted"]);
    expect(game.events[0]!.amount).toBe(35.55);
    expect(game.events[1]!.amount).toBe(-2001);
  });

  it("поднимает сохранение версии 4 с домашней локацией и слотами", () => {
    const game = migrateGame({ ...legacy, version: 4 });
    expect(game.version).toBe(GAME_STATE_VERSION);
    expect(game.location.id).toBe("home");
    expect(game.location.coolingId).toBe("window");
    expect(game.location.ownedCooling).toEqual(["window"]);
    expect(game.location.internetPlanId).toBe("home-100");
    expect(game.location.powerOff).toBe("none");
    expect(game.location.insulated).toBe(false);
  });

  it("ставит готовые серверы в слоты при миграции", () => {
    const source = createGame();
    const ready = structuredClone(source.hardware.builds[0]!);
    const game = migrateGame({
      ...source,
      hardware: {
        ...source.hardware,
        builds: [
          { ...structuredClone(ready), id: 7, starter: false, slot: null },
          { ...structuredClone(ready), id: 3, starter: true, slot: null },
        ],
      },
    });
    const slots = game.hardware.builds.map((build) => [build.id, build.slot]);
    expect(slots).toEqual([
      [7, 1],
      [3, 0],
    ]);
  });

  it("чистит испорченную локацию", () => {
    const source = createGame();
    const game = migrateGame({
      ...source,
      location: {
        coolingId: "nope",
        internetPlanId: "colo-10g",
        powerOff: "meltdown",
        ownedCooling: ["nope", "split"],
        irritation: 900,
        overloadHours: -3,
        insulated: "yes",
        outsideTempC: -999,
      },
    });
    expect(game.location.coolingId).toBe("window");
    expect(game.location.internetPlanId).toBe("home-100");
    expect(game.location.powerOff).toBe("none");
    expect(game.location.ownedCooling).toEqual(["split", "window"]);
    expect(game.location.irritation).toBe(100);
    expect(game.location.overloadHours).toBe(0);
    expect(game.location.insulated).toBe(false);
    expect(game.location.outsideTempC).toBe(-40);
  });

  it("принимает новые события локации", () => {
    const game = migrateGame({
      ...legacy,
      version: 4,
      events: [
        { id: 1, kind: "breakerTripped", hour: 10, amount: 1800 },
        { id: 2, kind: "noiseFine", hour: 11, amount: 50 },
        { id: 3, kind: "neighborsShutdown", hour: 12 },
      ],
    });
    expect(game.events.map((event) => event.kind)).toEqual([
      "breakerTripped",
      "noiseFine",
      "neighborsShutdown",
    ]);
  });
});
