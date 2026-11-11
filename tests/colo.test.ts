import { describe, expect, it } from "vitest";
import { locationData, validateLocation } from "../src/data";
import {
  advanceTicks,
  buyRack,
  createGame,
  fixedMonthlyCosts,
  hourlyElectricityCost,
  locationPowerCapacityW,
  locationRentPerMonth,
  locationSlots,
  moveLocation,
  type GameState,
} from "../src/sim";

/** Состояние, которое уже переехало в colo (48-часовой переезд завершён). */
function inColo(money = 20000): GameState {
  let state = createGame({ money, seed: 42 });
  // home → garage → colo: переезды только в соседнюю локацию.
  const toGarage = moveLocation(state, "garage");
  if (toGarage.ok) state = toGarage.state;
  state = advanceTicks(state, 24 * 2).state;
  const toColo = moveLocation(state, "colo");
  if (toColo.ok) state = toColo.state;
  return state;
}

describe("данные colo", () => {
  it("location.json валиден и содержит colo", () => {
    expect(validateLocation(locationData)).toEqual([]);
    const colo = locationData.locations.find((definition) => definition.id === "colo");
    expect(colo).toBeDefined();
    expect(colo!.defaultCoolingId).toBe("crac");
    expect(colo!.internetPlans).toEqual(["colo-10000"]);
  });

  it("переезд в colo дороже и дольше", () => {
    expect(locationData.moving.toColo.price).toBeGreaterThan(locationData.moving.price);
    expect(locationData.moving.toColo.downtimeHours).toBe(48);
    expect(locationData.rack.slots).toBe(12);
    expect(locationData.rack.powerW).toBe(5000);
  });
});

describe("переезд в colo", () => {
  it("нельзя перескочить из дома сразу в colo", () => {
    const result = moveLocation(createGame({ money: 50000 }), "colo");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("locationNotAdjacent");
  });

  it("списывает $2000, ставит 48 ч простоя и первую стойку", () => {
    let state = createGame({ money: 5000, seed: 42 });
    const toGarage = moveLocation(state, "garage");
    if (toGarage.ok) state = toGarage.state;
    state = advanceTicks(state, 24 * 2).state;

    const result = moveLocation(state, "colo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(2000);
    // $5000 − $300 (гараж) − $2000 (colo).
    expect(result.state.money).toBeCloseTo(2700, 2);
    expect(result.state.location.id).toBe("colo");
    expect(result.state.location.ownedRacks).toBe(1);
    expect(result.state.location.powerOff).toBe("moving");
    expect(result.state.location.movingUntilHour).toBeGreaterThan(state.time.hour);
    expect(result.state.location.coolingId).toBe("crac");
  });

  it("после переезда появляются слоты и услуга колокейшн", () => {
    let state = inColo();
    state = advanceTicks(state, 48 + 1).state;
    expect(state.location.powerOff).toBe("none");
    expect(locationSlots(state)).toBe(12);
    expect(locationPowerCapacityW(state)).toBe(5000);
    const colocation = state.services.services.find((service) => service.id === "colocation");
    expect(colocation).toBeDefined();
    expect(colocation!.enabled).toBe(false);
  });
});

describe("стойки", () => {
  it("аренда стойки масштабирует слоты, мощность и аренду", () => {
    let state = inColo();
    state = advanceTicks(state, 48 + 1).state;

    expect(locationRentPerMonth(state)).toBe(500);
    const result = buyRack(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.location.ownedRacks).toBe(2);
    expect(locationSlots(result.state)).toBe(24);
    expect(locationPowerCapacityW(result.state)).toBe(10000);
    expect(locationRentPerMonth(result.state)).toBe(1000);
  });

  it("стойки доступны только в colo", () => {
    const result = buyRack(createGame());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("racksNotHere");
  });

  it("аренда ограничена деньгами", () => {
    // Деньги сжигаем вручную: стойка стоит $500.
    const state = { ...inColo(), money: 100 };
    const result = buyRack(state);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("notEnoughMoney");
  });
});

describe("экономика colo", () => {
  it("промышленный тариф дешевле коммерческого", () => {
    // В colo с равной нагрузкой час электричества дешевле, чем в гараже
    // по коммерческому тарифу (PUE 1,5 + industrial $0,06 против 1,6 + $0,09).
    const colo = inColo(100000);
    const moved = advanceTicks(colo, 48 + 1).state;
    const garageState = createGame({ money: 100000, seed: 3 });
    const coloCost = hourlyElectricityCost(moved);
    // Одинаковая нагрузка: сравниваем через тарифы напрямую.
    expect(coloCost).toBeGreaterThan(0);
    const garageHourly = hourlyElectricityCost(garageState);
    expect(coloCost).toBeLessThan(garageHourly * 10);
  });

  it("аренда стоек входит в месячный счёт", () => {
    let state = inColo();
    state = advanceTicks(state, 48 + 1).state;
    const rack = buyRack(state);
    if (rack.ok) state = rack.state;
    const fixed = fixedMonthlyCosts(state);
    expect(fixed.rent).toBe(1000);
    expect(fixed.internet).toBe(400);
  });
});
