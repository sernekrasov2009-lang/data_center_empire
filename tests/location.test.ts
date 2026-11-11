import { describe, expect, it } from "vitest";
import {
  economy as economyData,
  getCooling,
  getInternetPlan,
  locationData,
  validateLocation,
} from "../src/data";
import {
  HOURS_PER_MONTH,
  assignFreeSlot,
  buildNoiseDb,
  buildPowerW,
  buyInsulation,
  coolingPowerW,
  createGame,
  currentNoiseDb,
  firstFreeSlot,
  fixedMonthlyCosts,
  hardwareLoadW,
  isNight,
  noiseLimitFor,
  outsideTempFor,
  placedBuilds,
  resetBreaker,
  restartServers,
  roomTempFor,
  serversRunning,
  setBuildSlot,
  setCooling,
  setInternetPlan,
  tickLocation,
  totalPowerDrawW,
  type BuildPart,
  type GameState,
} from "../src/sim";

function withSecondBuild(state: GameState, slot: number | null = null): GameState {
  const next = structuredClone(state);
  const starter = next.hardware.builds[0]!;
  next.hardware.builds.push({
    ...structuredClone(starter),
    id: 2,
    starter: false,
    slot,
  });
  return next;
}

/** Синтетическая нагрузка: подменяем детали стартовой сборки на мощные ЦП. */
function withLoad(state: GameState, watt: number): GameState {
  const next = structuredClone(state);
  const perPart = 150;
  const count = Math.ceil(watt / perPart);
  const parts: BuildPart[] = Array.from({ length: count }, () => ({
    componentId: "cpu-orion-16",
    condition: "new",
    purchasePrice: 450,
    installedAtHour: 0,
    defectAtHour: null,
    broken: false,
    repairDoneHour: null,
  }));
  next.hardware.builds[0]!.parts = parts;
  return next;
}

function night(value: number): GameState {
  const state = withSecondBuild(createGame(), 1);
  state.time.hour = value;
  return state;
}

describe("location.json", () => {
  it("проходит валидацию", () => {
    expect(validateLocation(locationData)).toEqual([]);
  });

  it("ловит испорченные данные", () => {
    const broken = structuredClone(locationData);
    broken.climate.monthlyBaseC = [1, 2];
    broken.cooling[0]!.conductanceWPerK = 0;
    broken.noise.complaintAt = 0;
    broken.insulation.reductionDb = 99;
    broken.locations[0]!.internetPlans = [];
    broken.locations[0]!.defaultCoolingId = "nope";

    const errors = validateLocation(broken);
    expect(errors.length).toBeGreaterThan(5);
    expect(errors.join("\n")).toContain("cooling.window.conductanceWPerK");
    expect(errors.join("\n")).toContain("locations.home.defaultCoolingId");
  });

  it("домашняя локация совпадает с DESIGN.md", () => {
    const home = locationData.locations.find((definition) => definition.id === "home")!;
    expect(home.slots).toBe(2);
    expect(home.powerCapacityW).toBe(1500);
    expect(home.rentPerMonth).toBe(0);
    expect(home.internetPlans).toEqual(["home-100", "home-300"]);
  });
});

describe("климат и охлаждение", () => {
  it("летом на улице жарче, чем зимой", () => {
    const january = outsideTempFor(0);
    const july = outsideTempFor(HOURS_PER_MONTH * 6 + 15);
    expect(july).toBeGreaterThan(january + 20);
  });

  it("днём теплее, чем ночью", () => {
    const day = outsideTempFor(HOURS_PER_MONTH * 6 + 15);
    const nightHour = outsideTempFor(HOURS_PER_MONTH * 6 + 3);
    expect(day).toBeGreaterThan(nightHour);
  });

  it("считает комнатную температуру по формуле T + P/C", () => {
    expect(roomTempFor(null, 20, 100, "window")).toBeCloseTo(24, 5);
    expect(roomTempFor(null, 20, 300, "split")).toBeCloseTo(22, 5);
  });

  it("не опускает комнату ниже отопительного минимума", () => {
    expect(roomTempFor(null, -40, 0, "window")).toBe(locationData.climate.minRoomTempC);
  });

  it("мощное охлаждение имеет большую проводимость", () => {
    expect(getCooling("window").conductanceWPerK).toBeLessThan(
      getCooling("fan").conductanceWPerK,
    );
    expect(getCooling("crac").conductanceWPerK).toBeGreaterThan(
      getCooling("split").conductanceWPerK,
    );
  });
});

describe("размещение серверов", () => {
  it("ставит стартовый ПК в первый слот", () => {
    const state = createGame();
    expect(state.location.id).toBe("home");
    expect(state.hardware.builds).toHaveLength(1);
    expect(state.hardware.builds[0]!.slot).toBe(0);
    expect(placedBuilds(state)).toHaveLength(1);
    expect(hardwareLoadW(state)).toBe(100);
    expect(firstFreeSlot(state)).toBe(1);
  });

  it("перемещает сервер и освобождает прежний слот", () => {
    const state = withSecondBuild(createGame());
    const moved = setBuildSlot(state, 2, 0);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const builds = moved.state.hardware.builds;
    expect(builds.find((build) => build.id === 2)!.slot).toBe(0);
    expect(builds.find((build) => build.id === 1)!.slot).toBeNull();
    expect(hardwareLoadW(moved.state)).toBe(100);
  });

  it("снимает сервер со слота", () => {
    const removed = setBuildSlot(createGame(), 1, null);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.state.hardware.builds[0]!.slot).toBeNull();
    expect(hardwareLoadW(removed.state)).toBe(0);
    expect(serversRunning(removed.state)).toBe(true);
  });

  it("отклоняет несуществующий слот и чужую сборку", () => {
    const state = createGame();
    const invalid = setBuildSlot(state, 1, 5);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.failure.code).toBe("slotInvalid");

    const missing = setBuildSlot(state, 99, 0);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.failure.code).toBe("buildNotFound");
  });

  it("не трогает исходное состояние", () => {
    const state = createGame();
    setBuildSlot(state, 1, null);
    expect(state.hardware.builds[0]!.slot).toBe(0);
  });

  it("автоматически занимает свободный слот", () => {
    const state = withSecondBuild(createGame());
    const build = state.hardware.builds[1]!;
    expect(build.slot).toBeNull();
    expect(assignFreeSlot(state, build)).toBe(true);
    expect(build.slot).toBe(1);
    expect(firstFreeSlot(state)).toBeNull();
  });
});

describe("питание и PUE", () => {
  it("считает потребление как нагрузку × PUE плюс охлаждение", () => {
    const state = createGame();
    const pue = economyData.electricity.pue.home;
    expect(totalPowerDrawW(state)).toBeCloseTo(100 * pue, 5);

    const withSplit = setCooling(state, "split");
    expect(withSplit.ok).toBe(true);
    if (!withSplit.ok) return;
    expect(coolingPowerW(withSplit.state)).toBe(getCooling("split").powerW);
    expect(totalPowerDrawW(withSplit.state)).toBeCloseTo(
      100 * pue + getCooling("split").powerW,
      5,
    );
  });

  it("при выбитом автомате нагрузка и охлаждение обесточены", () => {
    const state = createGame();
    state.location.powerOff = "breaker";
    expect(hardwareLoadW(state)).toBe(0);
    expect(coolingPowerW(state)).toBe(0);
    expect(totalPowerDrawW(state)).toBe(0);
    expect(currentNoiseDb(state)).toBe(0);
  });

  it("берёт интернет и аренду из состояния локации", () => {
    const state = createGame();
    expect(fixedMonthlyCosts(state)).toEqual({ internet: 20, rent: 0, staff: 0 });

    const switched = setInternetPlan(state, "home-300");
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(fixedMonthlyCosts(switched.state)).toEqual({ internet: 35, rent: 0, staff: 0 });
  });
});

describe("автомат и перегрев", () => {
  it("выбивает автомат после часа перегруза", () => {
    const state = withLoad(createGame(), 1650);
    state.location.coolingId = "crac";
    state.location.ownedCooling.push("crac");
    state.time.hour = 12;

    const first = tickLocation(state);
    expect(first.state.location.powerOff).toBe("none");
    expect(first.state.location.overloadHours).toBe(1);

    const second = tickLocation(first.state);
    expect(second.state.location.powerOff).toBe("breaker");
    expect(second.events.map((event) => event.kind)).toContain("breakerTripped");
    expect(hardwareLoadW(second.state)).toBe(0);
    expect(totalPowerDrawW(second.state)).toBe(0);
  });

  it("сбрасывает счётчик перегруза при нормальной нагрузке", () => {
    const state = createGame();
    state.location.overloadHours = 1;
    state.time.hour = 12;
    const result = tickLocation(state);
    expect(result.state.location.overloadHours).toBe(0);
    expect(result.state.location.powerOff).toBe("none");
  });

  it("сбрасывает автомат вручную", () => {
    const state = createGame();
    state.location.powerOff = "breaker";
    const result = resetBreaker(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.location.powerOff).toBe("none");

    expect(resetBreaker(createGame()).ok).toBe(false);
  });

  it("отключает серверы при перегреве комнаты", () => {
    const state = withLoad(createGame(), 700);
    state.time.hour = HOURS_PER_MONTH * 6 + 15;

    const result = tickLocation(state);
    expect(result.state.location.roomTempC).toBeGreaterThan(locationData.climate.shutdownC);
    expect(result.state.location.powerOff).toBe("overheat");
    expect(result.events.map((event) => event.kind)).toContain("serversShutdown");
  });

  it("не включает серверы, пока комната не остыла", () => {
    const state = createGame();
    state.location.powerOff = "overheat";
    state.location.roomTempC = 60;
    expect(restartServers(state).ok).toBe(false);

    const cooled = structuredClone(state);
    cooled.location.roomTempC = 30;
    const result = restartServers(cooled);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.location.powerOff).toBe("none");
  });

  it("не запускает серверы, если они и так работают", () => {
    expect(restartServers(createGame()).ok).toBe(false);
  });
});

describe("шум и соседи", () => {
  it("рассчитывает шум стартовой сборки и изоляцию", () => {
    const state = createGame();
    expect(currentNoiseDb(state)).toBeCloseTo(28.6, 1);

    const insulated = buyInsulation(state);
    expect(insulated.ok).toBe(true);
    if (!insulated.ok) return;
    expect(insulated.cost).toBe(locationData.insulation.price);
    expect(currentNoiseDb(insulated.state)).toBeCloseTo(20.6, 1);
  });

  it("не покупает изоляцию дважды и без денег", () => {
    const once = buyInsulation(createGame());
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(buyInsulation(once.state).ok).toBe(false);
    expect(buyInsulation(createGame({ money: 0 })).ok).toBe(false);
  });

  it("знает ночной и дневной лимиты", () => {
    expect(isNight(23)).toBe(true);
    expect(isNight(HOURS_PER_MONTH * 6 + 12)).toBe(false);
    expect(noiseLimitFor(23)).toBe(locationData.noise.nightLimitDb);
    expect(noiseLimitFor(HOURS_PER_MONTH * 6 + 12)).toBe(locationData.noise.dayLimitDb);
  });

  it("начисляет раздражение за шум ночью", () => {
    const state = night(23);
    expect(currentNoiseDb(state)).toBeGreaterThan(locationData.noise.nightLimitDb);

    const result = tickLocation(state);
    expect(result.state.location.irritation).toBeGreaterThan(0);
  });

  it("вызывает жалобу соседей", () => {
    const state = night(23);
    state.location.irritation = 11.9;

    const result = tickLocation(state);
    expect(result.events.map((event) => event.kind)).toContain("noiseComplaint");
    expect(result.state.money).toBe(state.money);
  });

  it("штрафует за шум и снижает раздражение", () => {
    const state = night(23);
    state.location.irritation = 23.9;

    const result = tickLocation(state);
    expect(result.events.map((event) => event.kind)).toContain("noiseFine");
    expect(result.state.money).toBe(state.money - locationData.noise.fineAmount);
    expect(result.state.location.irritation).toBeLessThan(locationData.noise.fineAt);
  });

  it("соседи добиваются отключения серверов", () => {
    const state = night(23);
    state.location.irritation = 47.9;

    const result = tickLocation(state);
    expect(result.state.location.powerOff).toBe("neighbors");
    expect(result.events.map((event) => event.kind)).toContain("neighborsShutdown");
    expect(hardwareLoadW(result.state)).toBe(0);
  });
});

describe("охлаждение и интернет", () => {
  it("покупает охлаждение один раз, потом переключает бесплатно", () => {
    const bought = setCooling(createGame(), "fan");
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.cost).toBe(getCooling("fan").price);
    expect(bought.state.money).toBe(800 - getCooling("fan").price);
    expect(bought.state.location.ownedCooling).toContain("fan");

    const back = setCooling(bought.state, "window");
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.cost).toBe(0);
    expect(back.state.money).toBe(bought.state.money);

    const again = setCooling(back.state, "fan");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.cost).toBe(0);
  });

  it("не покупает охлаждение без денег", () => {
    const result = setCooling(createGame({ money: 0 }), "split");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("notEnoughMoney");
  });

  it("переключает тариф интернета только из доступных", () => {
    const state = createGame();
    const plan = getInternetPlan("home-300");
    const result = setInternetPlan(state, plan.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.location.internetPlanId).toBe("home-300");
    expect(state.location.internetPlanId).toBe("home-100");

    const unavailable = setInternetPlan(state, "colo-10g");
    expect(unavailable.ok).toBe(false);
    if (unavailable.ok) return;
    expect(unavailable.failure.code).toBe("planNotAvailable");
  });
});

describe("сборка и шум", () => {
  it("считает мощность и шум по деталям", () => {
    const build = createGame().hardware.builds[0]!;
    expect(buildPowerW(build)).toBe(100);
    expect(buildNoiseDb(build)).toBeCloseTo(28.55, 2);
  });
});
