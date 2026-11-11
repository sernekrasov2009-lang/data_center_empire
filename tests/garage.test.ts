import { describe, expect, it } from "vitest";
import { locationData, validateLocation } from "../src/data";
import {
  advanceTicks,
  createGame,
  tickLocation,
  type GameState,
} from "../src/sim";
import { buyStabilizer, buyUps, moveLocation, placedBuilds } from "../src/sim/location";
import { rollDailyEvents } from "../src/sim/world-events";

/** Состояние с двумя собранными серверами (заполняем слоты дома). */
function fullHomeState(): GameState {
  let state = createGame({ seed: 1337 });
  const starter = state.hardware.builds[0]!;
  const second = structuredClone(starter);
  second.id = 2;
  second.starter = false;
  state.hardware.builds.push(second);
  for (const build of state.hardware.builds) {
    build.status = "ready";
    build.slot = null;
    // Расставляем вручную: слоты 0 и 1 дома заняты.
    build.slot = build.id === 1 ? 0 : 1;
  }
  return state;
}

describe("данные гаража", () => {
  it("location.json валиден и содержит гараж", () => {
    expect(validateLocation(locationData)).toEqual([]);
    const garage = locationData.locations.find((l) => l.id === "garage");
    expect(garage).toBeDefined();
    expect(garage!.slots).toBe(12);
    expect(garage!.powerCapacityW).toBe(3000);
    expect(garage!.rentPerMonth).toBe(50);
  });
});

describe("покупка ИБП и стабилизатора", () => {
  it("ИБП покупается один раз за $350", () => {
    const result = buyUps(createGame());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(locationData.ups.price);
    expect(result.state.location.upsOwned).toBe(true);

    const again = buyUps(result.state);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.failure.code).toBe("alreadyOwned");
  });

  it("стабилизатор покупается один раз за $200", () => {
    const result = buyStabilizer(createGame());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost).toBe(locationData.stabilizer.price);
    expect(result.state.location.stabilizerOwned).toBe(true);

    const again = buyStabilizer(result.state);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.failure.code).toBe("alreadyOwned");
  });

  it("не покупает без денег", () => {
    const poor = createGame({ money: 100 });
    const ups = buyUps(poor);
    expect(ups.ok).toBe(false);
    if (ups.ok) return;
    expect(ups.failure.code).toBe("notEnoughMoney");

    const stab = buyStabilizer(poor);
    expect(stab.ok).toBe(false);
    if (stab.ok) return;
    expect(stab.failure.code).toBe("notEnoughMoney");
  });
});

describe("переезд в гараж", () => {
  it("не пускает без денег и не в соседнюю локацию", () => {
    const poor = createGame({ money: 100 });
    const result = moveLocation(poor, "garage");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("notEnoughMoney");

    // Из garage нельзя вернуться в home (не соседняя, только вперёд).
    const moved = moveLocation(createGame({ money: 5000 }), "garage");
    expect(moved.ok).toBe(true);
    const skip = moveLocation((moved.ok ? moved.state : createGame()), "home");
    expect(skip.ok).toBe(false);
    if (skip.ok) return;
    expect(skip.failure.code).toBe("locationNotAdjacent");

    const unknown = moveLocation(createGame(), "mars");
    expect(unknown.ok).toBe(false);
  });

  it("снимает $300, ставит 24 ч moving и сбрасывает слоты", () => {
    const state = fullHomeState();
    const before = state.money;
    const result = moveLocation(state, "garage");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const moved = result.state;
    expect(moved.money).toBe(before - locationData.moving.price);
    expect(moved.location.id).toBe("garage");
    expect(moved.location.powerOff).toBe("moving");
    expect(moved.location.movingUntilHour).toBe(
      moved.time.hour + locationData.moving.downtimeHours,
    );
    // Все серверы сняты со слотов на время переезда.
    expect(moved.hardware.builds.every((b) => b.slot === null)).toBe(true);
    expect(placedBuilds(moved).length).toBe(0);
    // Дефолты гаража.
    expect(moved.location.internetPlanId).toBe("garage-500");
    expect(moved.location.coolingId).toBe("fan");
  });

  it("по завершении переезда серверы расставлены и питание включено", () => {
    const state = fullHomeState();
    const result = moveLocation(state, "garage");
    if (!result.ok) throw new Error("переезд не удался");

    // Прокатываем часы переезда через tickLocation (время двигаем, как advanceTicks).
    let moved = result.state;
    moved = structuredClone(moved);
    moved.time.hour = moved.location.movingUntilHour!;
    let events: { kind: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const ticked = tickLocation(moved);
      moved = ticked.state;
      events = events.concat(ticked.events);
    }
    expect(moved.location.powerOff).toBe("none");
    expect(moved.location.movingUntilHour).toBe(null);
    // Два сервера на новых слотах гаража.
    expect(placedBuilds(moved).length).toBe(2);
    expect(moved.hardware.builds.every((b) => b.slot !== null)).toBe(true);
    expect(events.some((e) => e.kind === "locationMoved")).toBe(true);
  });

  it("нельзя переехать дважды одновременно", () => {
    const state = fullHomeState();
    const first = moveLocation(state, "garage");
    if (!first.ok) throw new Error("переезд не удался");
    // Пока идёт переезд, назад в home нельзя: уже не соседняя.
    const second = moveLocation(first.state, "home");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.failure.code).toBe("locationNotAdjacent");
  });

  it("полный цикл: advanceTicks переживает переезд", () => {
    const state = fullHomeState();
    const result = moveLocation(state, "garage");
    if (!result.ok) throw new Error("переезд не удался");
    const after = advanceTicks(result.state, 48);
    expect(after.state.location.id).toBe("garage");
    expect(after.state.location.powerOff).not.toBe("moving");
    expect(placedBuilds(after.state).length).toBe(2);
  });
});

describe("ИБП и стабилизатор против мировых событий", () => {
  it("ИБП событию не мешает: rollback-проверка типов", () => {
    // ИБП гасит блэкауты только при ролле события: проверяем шанс.
    const state = createGame({ seed: 1337 });
    state.location.upsOwned = true;
    // rollDailyEvents должен работать и с ИБП без ошибок.
    const next = rollDailyEvents(state, 1);
    expect(next).toBeTruthy();
  });

  it("событие blackoutPrevented эмитится при ИБП", () => {
    // Ищем seed, при котором выпадает блэкаут ≤ 4 ч, и проверяем гашение.
    let found = false;
    for (let seed = 1; seed < 3000 && !found; seed++) {
      let state = createGame({ seed });
      state.location.upsOwned = true;
      const emitted = rollDailyEvents(state, 1);
      if (emitted.some((e) => e.kind === "blackoutPrevented")) {
        found = true;
        // Питание не отключено.
        expect(state.location.powerOff).toBe("none");
      }
    }
    // Шанс 0,3%/день; за 3000 сидов блэкаут обязан хоть раз выпасть.
    expect(found).toBe(true);
  });
});
