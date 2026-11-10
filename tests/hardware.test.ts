import { describe, expect, it } from "vitest";
import {
  components,
  findComponent,
  getComponent,
  hardware,
  validateHardware,
} from "../src/data";
import {
  HOURS_PER_DAY,
  HOURS_PER_YEAR,
  buildHours,
  buildPowerW,
  buildStats,
  buyUsedLot,
  cancelOrder,
  createGame,
  driftMarketPrice,
  failureProbability,
  hardwareLoadW,
  hiddenDefectAtHour,
  placeNewOrder,
  previewNewOrder,
  refreshUsedMarket,
  returnOrder,
  startBuild,
  tickHardware,
  validateBuild,
} from "../src/sim";
import { migrateGame } from "../src/save/migrate";

const START_PARTS = hardware.startBuild.parts;

describe("components.json", () => {
  it("проходит валидацию", () => {
    expect(validateHardware(hardware)).toEqual([]);
  });

  it("находит детали по id", () => {
    expect(getComponent("cpu-vela-4").name).toBe("Vela 4");
    expect(findComponent("nope")).toBeUndefined();
    expect(() => getComponent("nope")).toThrow();
    expect(new Set(components.map((component) => component.id)).size).toBe(components.length);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(hardware);
    broken.components = broken.components.filter((component) => component.id !== "psu-300");
    broken.startBuild.parts = ["cpu-vela-4", "missing-part"];
    broken.delivery.newDaysMax = 0;
    broken.market.usedDiscountMin = 0.8;
    broken.market.usedDiscountMax = 0.2;

    const errors = validateHardware(broken);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.includes("startBuild.parts"))).toBe(true);
    expect(errors.some((error) => error.includes("delivery.newDays"))).toBe(true);
    expect(errors.some((error) => error.includes("usedDiscount"))).toBe(true);
  });
});

describe("характеристики и совместимость", () => {
  it("считает стартовую сборку на 100 Вт", () => {
    const stats = buildStats(START_PARTS);
    expect(stats.partCount).toBe(START_PARTS.length);
    expect(stats.power).toBe(100);
    expect(stats.cores).toBe(4);
    expect(stats.ramGb).toBe(8);
    expect(stats.storageGb).toBe(1000);
    expect(stats.psuHeadroom).toBeCloseTo(3, 10);
    expect(stats.noiseDb).toBeGreaterThan(25);
  });

  it("принимает полный совместимый набор", () => {
    const validation = validateBuild(START_PARTS);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("ловит несовместимые детали", () => {
    const socket = validateBuild([
      "cpu-orion-16",
      "mb-vela-a",
      "ram-pc8",
      "storage-hdd-1t",
      "psu-800",
      "case-tower",
      "nic-1g",
    ]);
    expect(socket.ok).toBe(false);
    expect(socket.errors.map((error) => error.code)).toContain("socketMismatch");

    const ram = validateBuild([
      "cpu-vela-4",
      "mb-vela-a",
      "ram-ecc32",
      "storage-hdd-1t",
      "psu-300",
      "case-tower",
      "nic-1g",
    ]);
    expect(ram.errors.map((error) => error.code)).toContain("ramTypeMismatch");

    const capacity = validateBuild([
      "cpu-vela-4",
      "mb-vela-a",
      "ram-pc16",
      "ram-pc16",
      "ram-pc16",
      "storage-hdd-1t",
      "psu-300",
      "case-tower",
      "nic-1g",
    ]);
    expect(capacity.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["tooManyRam"]),
    );

    // Корпус 1U не принимает ATX-плату.
    const formFactor = validateBuild([
      "cpu-vela-4",
      "mb-vela-a",
      "ram-pc8",
      "storage-hdd-1t",
      "psu-300",
      "case-1u",
      "nic-1g",
    ]);
    expect(formFactor.errors.map((error) => error.code)).toContain("boardFormFactorMismatch");

    const weak = validateBuild([
      "cpu-orion-16",
      "mb-orion",
      "ram-ecc32",
      "ram-ecc32",
      "ram-ecc32",
      "ram-ecc32",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "storage-hdd-1t",
      "psu-300",
      "case-2u",
      "nic-10g",
    ]);
    expect(weak.errors.map((error) => error.code)).toContain("psuTooWeak");
  });

  it("ловит отсутствующие обязательные детали", () => {
    const validation = validateBuild(["cpu-vela-4", "mb-vela-a"]);
    const codes = validation.errors.map((error) => error.code);
    expect(codes).toEqual(
      expect.arrayContaining(["missingPsu", "missingCase", "missingNic", "missingRam", "missingStorage"]),
    );
  });

  it("считает время сборки", () => {
    expect(buildHours(0)).toBe(0);
    expect(buildHours(1)).toBe(1);
    expect(buildHours(4)).toBe(1);
    expect(buildHours(5)).toBe(2);
    expect(buildHours(100)).toBe(hardware.build.maxHours);
  });

  it("считает нагрузку по готовым сборкам", () => {
    const game = createGame();
    expect(hardwareLoadW(game)).toBe(100);
    expect(buildPowerW(game.hardware.builds[0]!)).toBe(100);
  });
});

describe("магазин и доставка", () => {
  it("считает предпросмотр заказа с доставкой", () => {
    const game = createGame();
    const preview = previewNewOrder(game, "ram-pc8", 1);
    expect(preview.unitPrice).toBe(25);
    expect(preview.subtotal).toBe(25);
    expect(preview.shipping).toBe(hardware.delivery.fee);
    expect(preview.total).toBe(35);

    const free = previewNewOrder(game, "cpu-orion-16", 1);
    expect(free.shipping).toBe(0);
    expect(free.total).toBe(450);
  });

  it("оформляет заказ и списывает деньги", () => {
    const game = createGame({ money: 1000 });
    const preview = previewNewOrder(game, "ram-pc8", 3);
    const result = placeNewOrder(game, "ram-pc8", 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.money).toBeCloseTo(1000 - preview.total, 6);
    expect(result.state.hardware.orders).toHaveLength(1);
    expect(result.state.hardware.orders[0]!.status).toBe("inTransit");
    expect(result.state.hardware.orders[0]!.lines[0]!.quantity).toBe(3);
    expect(result.state.hardware.orders[0]!.arriveAtHour).toBeGreaterThan(game.time.hour);
  });

  it("не даёт купить без денег и с плохим количеством", () => {
    const game = createGame({ money: 10 });
    expect(placeNewOrder(game, "ram-pc8", 1).ok).toBe(false);
    expect(placeNewOrder(game, "ram-pc8", 0).ok).toBe(false);
    expect(placeNewOrder(game, "ram-pc8", 1.5).ok).toBe(false);
    expect(placeNewOrder(game, "nope", 1).ok).toBe(false);
  });

  it("отменяет заказ в первые 12 часов и возвращает деньги", () => {
    const game = createGame({ money: 1000 });
    const placed = placeNewOrder(game, "ram-pc8", 2);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const orderId = placed.order.id;
    const total = placed.order.total;
    const early = cancelOrder({ ...placed.state, time: { ...placed.state.time, hour: 12 } }, orderId);
    expect(early.ok).toBe(true);
    if (!early.ok) return;
    expect(early.refund).toBeCloseTo(total, 6);
    expect(early.state.money).toBeCloseTo(1000, 6);
    expect(early.state.hardware.orders[0]!.status).toBe("cancelled");

    const late = cancelOrder({ ...placed.state, time: { ...placed.state.time, hour: 13 } }, orderId);
    expect(late.ok).toBe(false);
  });

  it("доставляет заказ и кладёт детали на склад", () => {
    const game = createGame({ money: 1000 });
    const placed = placeNewOrder(game, "ram-pc8", 2);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const arriveHour = placed.order.arriveAtHour;
    const atArrival = { ...placed.state, time: { ...placed.state.time, hour: arriveHour } };
    const tick = tickHardware(atArrival);
    const order = tick.state.hardware.orders[0]!;
    expect(order.status).toBe("delivered");
    expect(order.deliveredAtHour).toBe(arriveHour);
    expect(tick.state.hardware.parts).toHaveLength(2);
    expect(tick.state.hardware.parts[0]!.condition).toBe("new");
    expect(tick.state.hardware.parts[0]!.defectAtHour).toBeNull();
    expect(tick.events.map((event) => event.kind)).toContain("orderArrived");
  });

  it("возвращает доставленный заказ с комиссией 10%", () => {
    const game = createGame({ money: 1000 });
    const placed = placeNewOrder(game, "ram-pc8", 2);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const hour = placed.order.arriveAtHour;
    const delivered = tickHardware({
      ...placed.state,
      time: { ...placed.state.time, hour },
    }).state;
    const orderId = placed.order.id;

    const returned = returnOrder(delivered, orderId);
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(returned.refund).toBeCloseTo(placed.order.subtotal * 0.9, 6);
    expect(returned.state.hardware.parts).toHaveLength(0);
    expect(returned.state.hardware.orders[0]!.status).toBe("returned");

    const late = returnOrder(
      { ...delivered, time: { ...delivered.time, hour: hour + hardware.delivery.returnDays * HOURS_PER_DAY + 1 } },
      orderId,
    );
    expect(late.ok).toBe(false);
  });

  it("не даёт вернуть установленные детали", () => {
    const game = createGame({ money: 1000 });
    const placed = placeNewOrder(game, "ram-pc8", 1);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const hour = placed.order.arriveAtHour;
    const delivered = tickHardware({
      ...placed.state,
      time: { ...placed.state.time, hour },
    }).state;
    const partId = delivered.hardware.parts[0]!.id;
    const built = startBuild(delivered, [partId]);
    expect(built.ok).toBe(false);

    const withStarter = { ...delivered, hardware: { ...delivered.hardware, parts: [] } };
    expect(returnOrder(withStarter, placed.order.id).ok).toBe(false);
  });

  it("меняет цены раз в месяц в пределах ±10%", () => {
    const game = createGame();
    const { state, mult } = driftMarketPrice(game);
    expect(mult).toBeGreaterThanOrEqual(0.9);
    expect(mult).toBeLessThanOrEqual(1.1);
    expect(state.hardware.marketPriceMult).toBe(mult);
  });
});

describe("б/у рынок и износ", () => {
  it("создаёт шесть лотов со скидкой 30–60%", () => {
    const game = createGame();
    expect(game.hardware.usedLots).toHaveLength(hardware.market.usedLotsPerWeek);
    for (const lot of game.hardware.usedLots) {
      expect(lot.discount).toBeGreaterThanOrEqual(hardware.market.usedDiscountMin);
      expect(lot.discount).toBeLessThanOrEqual(hardware.market.usedDiscountMax);
      expect(lot.price).toBeLessThan(getComponent(lot.componentId).price);
      expect(lot.expiresAtHour - lot.listedAtHour).toBe(hardware.market.usedLotDays * HOURS_PER_DAY);
    }
  });

  it("детерминирован при одном seed", () => {
    const first = createGame({ seed: 99 });
    const second = createGame({ seed: 99 });
    expect(first.hardware.usedLots).toEqual(second.hardware.usedLots);
  });

  it("покупает лот и убирает его с рынка", () => {
    const game = createGame({ money: 1000 });
    const lot = game.hardware.usedLots[0]!;
    const result = buyUsedLot(game, lot.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.hardware.usedLots.some((candidate) => candidate.id === lot.id)).toBe(false);
    expect(result.order.kind).toBe("used");
    expect(result.order.lotId).toBe(lot.id);
    expect(result.order.lines[0]!.condition).toBe("used");
    expect(result.state.money).toBeLessThan(1000);
    expect(buyUsedLot(result.state, lot.id).ok).toBe(false);
  });

  it("обновляет рынок не чаще раза в неделю", () => {
    const game = createGame();
    const same = refreshUsedMarket({ ...game, time: { ...game.time, hour: 10 } });
    expect(same.generated).toBe(false);

    const week = refreshUsedMarket({
      ...game,
      time: { ...game.time, hour: game.hardware.lastUsedMarketHour + 7 * HOURS_PER_DAY },
    });
    expect(week.generated).toBe(true);
    expect(week.state.hardware.usedLots).toHaveLength(hardware.market.usedLotsPerWeek);
  });

  it("назначает скрытый дефект в первые 60 дней", () => {
    const game = createGame();
    const defect = hiddenDefectAtHour(game.rng, 0, 1);
    expect(defect).not.toBeNull();
    expect(defect!).toBeGreaterThan(0);
    expect(defect!).toBeLessThanOrEqual(hardware.market.usedDefectWindowDays * HOURS_PER_DAY);
    expect(hiddenDefectAtHour(game.rng, 0, 0)).toBeNull();
  });

  it("считает вероятность отказа выше для б/у, старых и горячих деталей", () => {
    const cpu = getComponent("cpu-vela-4");
    const base = failureProbability(cpu, "new", 0, 28, 1);
    expect(failureProbability(cpu, "used", 0, 28, 1)).toBeGreaterThan(base);
    expect(failureProbability(cpu, "new", 5, 28, 1)).toBeGreaterThan(base);
    expect(failureProbability(cpu, "new", 0, 45, 1)).toBeGreaterThan(base);
    expect(failureProbability(cpu, "new", 0, 28, 2)).toBeGreaterThan(base);
    expect(failureProbability(cpu, "new", 0, 28, 0)).toBe(0);
  });

  it("ломает деталь по дефекту и ремонтирует за 48 часов", () => {
    const game = createGame();
    const state = {
      ...game,
      time: { ...game.time, hour: HOURS_PER_DAY },
      hardware: {
        ...game.hardware,
        builds: game.hardware.builds.map((build) => ({
          ...build,
          parts: build.parts.map((part, index) => ({
            ...part,
            defectAtHour: index === 0 ? HOURS_PER_DAY : null,
          })),
        })),
      },
    };

    const tick = tickHardware(state);
    const failed = tick.events.find((event) => event.kind === "partFailed");
    expect(failed).toBeDefined();
    expect(failed?.amount).toBe(hardware.repair.hoursWithoutSpare);
    expect(failed?.ref).toBe("cpu-vela-4");

    const part = tick.state.hardware.builds[0]!.parts[0]!;
    expect(part.broken).toBe(true);
    expect(part.repairDoneHour).toBe(HOURS_PER_DAY + hardware.repair.hoursWithoutSpare);
  });

  it("ускоряет ремонт до 6 часов при запчасти на складе", () => {
    const game = createGame();
    const state = {
      ...game,
      time: { ...game.time, hour: HOURS_PER_DAY },
      hardware: {
        ...game.hardware,
        parts: [
          {
            id: 99,
            componentId: "cpu-vela-4",
            condition: "new" as const,
            acquiredHour: 0,
            purchasePrice: 80,
            orderId: null,
            defectAtHour: null,
          },
        ],
        builds: game.hardware.builds.map((build) => ({
          ...build,
          parts: build.parts.map((part, index) => ({
            ...part,
            defectAtHour: index === 0 ? HOURS_PER_DAY : null,
          })),
        })),
      },
    };

    const tick = tickHardware(state);
    const failed = tick.events.find((event) => event.kind === "partFailed");
    expect(failed?.amount).toBe(hardware.repair.hoursWithSpare);
    expect(tick.state.hardware.parts).toHaveLength(0);
  });

  it("завершает ремонт в нужный час", () => {
    const game = createGame();
    const repairHour = HOURS_PER_DAY + hardware.repair.hoursWithoutSpare;
    const state = {
      ...game,
      time: { ...game.time, hour: repairHour },
      hardware: {
        ...game.hardware,
        builds: game.hardware.builds.map((build) => ({
          ...build,
          parts: build.parts.map((part, index) => ({
            ...part,
            broken: index === 0,
            repairDoneHour: index === 0 ? repairHour : null,
            defectAtHour: null,
          })),
        })),
      },
    };

    const tick = tickHardware(state);
    expect(tick.events.some((event) => event.kind === "partRepaired")).toBe(true);
    expect(tick.state.hardware.builds[0]!.parts[0]!.broken).toBe(false);
  });
});

describe("сборка из складских деталей", () => {
  function stockedGame() {
    const game = createGame({ money: 5000 });
    const parts = START_PARTS.map((componentId, index) => ({
      id: index + 1,
      componentId,
      condition: "new" as const,
      acquiredHour: 0,
      purchasePrice: getComponent(componentId).price,
      orderId: null,
      defectAtHour: null,
    }));
    return {
      ...game,
      hardware: { ...game.hardware, parts, nextPartId: parts.length + 1 },
    };
  }

  it("собирает сервер и убирает детали со склада", () => {
    const game = stockedGame();
    const ids = game.hardware.parts.map((part) => part.id);
    const result = startBuild(game, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.hardware.parts).toHaveLength(0);
    expect(result.state.hardware.builds).toHaveLength(2);
    expect(result.build.parts).toHaveLength(ids.length);
    expect(result.hours).toBe(buildHours(ids.length));
    expect(buildPowerW(result.build)).toBe(100);

    const readyHour = result.build.readyAtHour;
    const tick = tickHardware({ ...result.state, time: { ...result.state.time, hour: readyHour } });
    expect(tick.state.hardware.builds[1]!.status).toBe("ready");
    expect(tick.events.some((event) => event.kind === "buildCompleted")).toBe(true);
    expect(hardwareLoadW(tick.state)).toBe(200);
  });

  it("не собирает несовместимый или неполный набор", () => {
    const game = stockedGame();
    const ids = game.hardware.parts.map((part) => part.id);
    const missingRam = ids.filter((id) => {
      const part = game.hardware.parts.find((candidate) => candidate.id === id);
      return part?.componentId !== "ram-pc8";
    });
    const result = startBuild(game, missingRam);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("invalidBuild");
    expect(result.failure.buildErrors?.some((error) => error.code === "missingRam")).toBe(true);

    expect(startBuild(game, []) instanceof Object).toBe(true);
    expect(startBuild(game, [...ids, ...ids]).ok).toBe(false);
    expect(startBuild(game, [9999]).ok).toBe(false);
  });
});

describe("миграция на версию с железом", () => {
  const v3 = {
    version: 3,
    seed: 5,
    rng: { seed: 5, s: 5 },
    time: { hour: 100, speed: 1, paused: true },
    money: 900,
    companyName: "Old Save",
    difficulty: "normal",
    economy: {
      accrual: { electricity: 0, internet: 0, rent: 0 },
      reports: [],
      lifetime: { revenue: 0, expenses: 0 },
      electricityPriceMult: 1,
      lowMoneyWarned: false,
    },
    gameOver: null,
    stats: { ticks: 100 },
    events: [{ id: 1, kind: "partFailed", hour: 90, ref: "cpu-vela-4" }],
    nextEventId: 2,
  };

  it("добавляет стартовую сборку и б/у рынок", () => {
    const game = migrateGame(v3);
    expect(game.version).toBeGreaterThanOrEqual(4);
    expect(game.hardware.builds).toHaveLength(1);
    expect(game.hardware.builds[0]!.starter).toBe(true);
    expect(game.hardware.builds[0]!.parts.map((part) => part.componentId)).toEqual(START_PARTS);
    expect(game.hardware.usedLots).toHaveLength(hardware.market.usedLotsPerWeek);
    expect(hardwareLoadW(game)).toBe(100);
  });

  it("сохраняет ссылку события на деталь", () => {
    const game = migrateGame(v3);
    expect(game.events.find((event) => event.kind === "partFailed")?.ref).toBe("cpu-vela-4");
  });

  it("чистит испорченное железо", () => {
    const game = migrateGame({
      ...v3,
      hardware: {
        parts: [{ id: 1, componentId: "unknown-part", condition: "new" }],
        builds: [{ id: 1, status: "ready", parts: [{ componentId: "nope" }] }],
        orders: [{ id: 1, lines: [{ componentId: "nope", quantity: 1 }] }],
        usedLots: [{ id: 1, componentId: "nope", price: 10 }],
        marketPriceMult: 99,
        lastUsedMarketHour: -5,
      },
    });
    expect(game.hardware.builds).toHaveLength(1);
    expect(game.hardware.builds[0]!.starter).toBe(true);
    expect(game.hardware.parts).toHaveLength(0);
    expect(game.hardware.orders).toHaveLength(0);
  });

  it("сохраняет корректные склад и заказы", () => {
    const source = createGame({ seed: 5 });
    const saved = {
      ...source,
      hardware: {
        ...source.hardware,
        parts: [
          {
            id: 7,
            componentId: "ram-pc8",
            condition: "used",
            acquiredHour: 10,
            purchasePrice: 15,
            orderId: 2,
            defectAtHour: 50,
          },
        ],
        orders: [
          {
            id: 2,
            kind: "used",
            lines: [{ componentId: "ram-pc8", quantity: 1, unitPrice: 15, condition: "used" }],
            subtotal: 15,
            shipping: 10,
            total: 25,
            status: "delivered",
            orderedAtHour: 1,
            arriveAtHour: 40,
            deliveredAtHour: 40,
            lotId: 3,
          },
        ],
      },
    };

    const game = migrateGame(saved);
    expect(game.hardware.parts[0]).toMatchObject({
      componentId: "ram-pc8",
      condition: "used",
      purchasePrice: 15,
      defectAtHour: 50,
    });
    expect(game.hardware.orders[0]).toMatchObject({ id: 2, status: "delivered", lotId: 3 });
    expect(game.hardware.nextPartId).toBe(8);
    expect(game.hardware.nextOrderId).toBe(3);
  });

  it("не портит возраст деталей при расчёте вероятности", () => {
    const cpu = getComponent("cpu-vela-4");
    const year = failureProbability(cpu, "new", 1, 28, 1);
    expect(year).toBeGreaterThan(0);
    expect(year).toBeLessThan(1);
    expect(failureProbability(cpu, "new", 1, 28, 1e9)).toBe(1);
    expect(HOURS_PER_YEAR).toBeGreaterThan(0);
  });
});
