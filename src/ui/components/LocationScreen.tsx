import { economy as economyData, getInternetPlan, locationData } from "../../data";
import { useT, type Translate } from "../../i18n";
import {
  locationPowerCapacityW,
  locationRentPerMonth,
  locationSlots,
  buildNoiseDb,
  buildPowerW,
  coolingPowerW,
  currentNoiseDb,
  getLocation,
  getSelectedCooling,
  hardwareLoadW,
  isNight,
  noiseLimitFor,
  placedBuilds,
  serversRunning,
  totalPowerDrawW,
} from "../../sim";
import { useGameStore } from "../../state/store";
import { formatInt, formatMoney } from "../format";

const COOLING_KEY: Record<string, string> = {
  window: "location.cooling.window",
  fan: "location.cooling.fan",
  split: "location.cooling.split",
  crac: "location.cooling.crac",
};

function coolingName(id: string, t: Translate): string {
  return t(COOLING_KEY[id] ?? id);
}

export function LocationScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const placeBuild = useGameStore((state) => state.placeBuild);
  const setCooling = useGameStore((state) => state.setCooling);
  const setInternetPlan = useGameStore((state) => state.setInternetPlan);
  const buyInsulation = useGameStore((state) => state.buyInsulation);
  const buyUps = useGameStore((state) => state.buyUps);
  const buyStabilizer = useGameStore((state) => state.buyStabilizer);
  const moveLocation = useGameStore((state) => state.moveLocation);
  const buyRack = useGameStore((state) => state.buyRack);
  const resetBreaker = useGameStore((state) => state.resetBreaker);
  const restartServers = useGameStore((state) => state.restartServers);

  const definition = getLocation(game);
  const cooling = getSelectedCooling(game);
  const load = hardwareLoadW(game);
  const capacity = locationPowerCapacityW(game);
  const slots = locationSlots(game);
  const rent = locationRentPerMonth(game);
  const draw = totalPowerDrawW(game);
  const climate = locationData.climate;
  const pue = economyData.electricity.pue[definition.id];
  const noise = currentNoiseDb(game);
  const night = isNight(game.time.hour);
  const limit = noiseLimitFor(game.time.hour);
  const irritation = game.location.irritation;

  const readyBuilds = game.hardware.builds.filter((build) => build.status === "ready");
  const placed = placedBuilds(game);
  const unplaced = readyBuilds.filter((build) => build.slot === null);

  const tempState =
    game.location.roomTempC >= climate.shutdownC
      ? "danger"
      : game.location.roomTempC >= climate.throttleC
        ? "throttle"
        : game.location.roomTempC >= climate.warnC
          ? "warn"
          : "ok";
  const noiseState = noise > limit ? "danger" : "ok";
  const powerState = load > capacity ? "danger" : load > capacity * 0.8 ? "warn" : "ok";

  const plan = getInternetPlan(game.location.internetPlanId);
  const plans = definition.internetPlans.map((planId) => getInternetPlan(planId));

  function buildName(buildId: number): string {
    const build = game.hardware.builds.find((candidate) => candidate.id === buildId);
    if (!build) return "—";
    return build.starter ? t("hardware.startServer") : t("hardware.serverName", { n: build.id });
  }

  return (
    <div className="location">
      <div className="hardware__head">
        <div>
          <h1 className="hardware__title">{t("location.title")}</h1>
          <p className="hardware__subtitle">
            {t(definition.id === "home" ? "location.subtitle" : `location.subtitle.${definition.id}`)}
          </p>
        </div>
        <div className="warehouse__summary">
          <span className="badge">{t(`location.kind.${definition.id}`)}</span>
          <span className="badge" data-state={serversRunning(game) ? "ok" : "danger"}>
            {serversRunning(game) ? t("location.status.online") : t("location.status.offline")}
          </span>
        </div>
      </div>

      {game.location.powerOff !== "none" && (
        <div className="econ-banner" data-kind="danger" role="status">
          <span className="econ-banner__title">{t(`location.off.${game.location.powerOff}`)}</span>
          <span className="econ-banner__text">
            {t(`location.off.${game.location.powerOff}.text`)}
          </span>
          {game.location.powerOff === "breaker" && (
            <button type="button" className="btn btn--small btn--primary" onClick={resetBreaker}>
              {t("location.resetBreaker")}
            </button>
          )}
          {(game.location.powerOff === "overheat" || game.location.powerOff === "neighbors") && (
            <button type="button" className="btn btn--small btn--primary" onClick={restartServers}>
              {t("location.restart")}
            </button>
          )}
          {(game.location.powerOff === "blackout" ||
            game.location.powerOff === "channelFailure" ||
            game.location.powerOff === "moving") && (
            <p className="panel__hint">
              {t(`location.off.${game.location.powerOff}.text`)}
            </p>
          )}
        </div>
      )}

      <div className="location__grid">
        {definition.id === "colo" && (
          <section className="panel panel--wide">
            <div className="panel__label">{t("location.racks")}</div>
            <div className="loc-options">
              <article className="loc-option" data-current>
                <div className="loc-option__head">
                  <strong>{t("location.rack")}</strong>
                  <span className="badge" data-state="ok">
                    {t("location.rackCount", { count: game.location.ownedRacks })}
                  </span>
                </div>
                <div className="loc-option__specs">
                  <span>
                    {t("location.coloRackInfo", {
                      slots: locationData.rack.slots,
                      watt: formatInt(locationData.rack.powerW, language),
                      price: formatMoney(locationData.rack.rentPerMonth, language, numberFormat),
                    })}
                  </span>
                  <span>{t("location.rackTotal", {
                    slots,
                    watt: formatInt(capacity, language),
                  })}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={
                    game.location.ownedRacks >= locationData.rack.maxRacks ||
                    game.money < locationData.rack.rentPerMonth
                  }
                  onClick={buyRack}
                >
                  {t("location.buyRack", {
                    price: formatMoney(locationData.rack.rentPerMonth, language, numberFormat),
                  })}
                </button>
              </article>
            </div>
            <p className="panel__hint">{t("location.rackHint")}</p>
          </section>
        )}

        <section className="panel">
          <div className="panel__label">{t("location.power")}</div>
          <div className="panel__value" data-state={powerState}>
            {formatInt(load, language)} / {formatInt(capacity, language)} {t("location.watt")}
          </div>
          <div className="loc-bar" data-state={powerState} aria-hidden="true">
            <span style={{ width: `${Math.min(100, (load / capacity) * 100)}%` }} />
          </div>
          <div className="econ-rows">
            <div className="econ-row">
              <span className="econ-row__label">{t("location.draw")}</span>
              <span className="econ-row__value">
                {t("location.wattValue", { watt: formatInt(Math.round(draw), language) })}
              </span>
            </div>
            <div className="econ-row">
              <span className="econ-row__label">{t("location.pue")}</span>
              <span className="econ-row__value">
                {String(pue).replace(".", language === "ru" ? "," : ".")}
              </span>
            </div>
            <div className="econ-row">
              <span className="econ-row__label">{t("location.coolingPower")}</span>
              <span className="econ-row__value">
                {t("location.wattValue", { watt: formatInt(coolingPowerW(game), language) })}
              </span>
            </div>
            <div className="econ-row">
              <span className="econ-row__label">{t("location.rent")}</span>
              <span className="econ-row__value">
                {formatMoney(rent, language, numberFormat)}
              </span>
            </div>
          </div>
          <p className="panel__hint">
            {load > capacity
              ? t("location.overloadWarning", { capacity: formatInt(capacity, language) })
              : t("location.powerHint")}
          </p>
        </section>

        <section className="panel">
          <div className="panel__label">{t("location.temperature")}</div>
          <div className="panel__value" data-state={tempState}>
            {t("location.degrees", { value: game.location.roomTempC.toFixed(1) })}
          </div>
          <div className="econ-rows">
            <div className="econ-row">
              <span className="econ-row__label">{t("location.outside")}</span>
              <span className="econ-row__value">
                {t("location.degrees", { value: game.location.outsideTempC.toFixed(1) })}
              </span>
            </div>
            <div className="econ-row">
              <span className="econ-row__label">{t("location.tempStatus")}</span>
              <span className="econ-row__value">{t(`location.temp.${tempState}`)}</span>
            </div>
          </div>
          <ul className="loc-legend">
            <li>{t("location.temp.warnAt", { value: climate.warnC })}</li>
            <li>{t("location.temp.throttleAt", { value: climate.throttleC })}</li>
            <li>{t("location.temp.shutdownAt", { value: climate.shutdownC })}</li>
          </ul>
        </section>

        <section className="panel panel--wide">
          <div className="panel__label">{t("location.slots")}</div>
          <div className="loc-slots">
            {Array.from({ length: slots }, (_, slot) => {
              const build = placed.find((candidate) => candidate.slot === slot);
              return (
                <article className="loc-slot" key={slot} data-filled={build !== undefined}>
                  <div className="loc-slot__head">
                    <span className="loc-slot__label">{t("location.slot", { n: slot + 1 })}</span>
                    {build ? (
                      <span className="badge" data-state="ok">
                        {t("location.powered")}
                      </span>
                    ) : (
                      <span className="badge">{t("location.empty")}</span>
                    )}
                  </div>
                  <select
                    className="select"
                    value={build ? String(build.id) : ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "") {
                        if (build) placeBuild(build.id, null);
                        return;
                      }
                      placeBuild(Number(value), slot);
                    }}
                  >
                    <option value="">{t("location.emptySlot")}</option>
                    {readyBuilds.map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>
                        {buildName(candidate.id)}
                      </option>
                    ))}
                  </select>
                  {build && (
                    <div className="loc-slot__meta">
                      <span>
                        {t("location.wattValue", { watt: formatInt(buildPowerW(build), language) })}
                      </span>
                      <span>{t("location.dbValue", { db: buildNoiseDb(build).toFixed(1) })}</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <p className="panel__hint">
            {unplaced.length === 0
              ? t("location.allPlaced")
              : t("location.unplaced", { count: unplaced.length })}
          </p>
        </section>

        <section className="panel panel--wide">
          <div className="panel__label">{t("location.cooling")}</div>
          <div className="loc-options">
            {locationData.cooling.map((option) => {
              const owned = game.location.ownedCooling.includes(option.id);
              const current = game.location.coolingId === option.id;
              return (
                <article className="loc-option" key={option.id} data-current={current}>
                  <div className="loc-option__head">
                    <strong>{coolingName(option.id, t)}</strong>
                    {current ? (
                      <span className="badge" data-state="ok">
                        {t("location.current")}
                      </span>
                    ) : owned ? (
                      <span className="badge">{t("location.owned")}</span>
                    ) : (
                      <span className="loc-option__price">
                        {formatMoney(option.price, language, numberFormat)}
                      </span>
                    )}
                  </div>
                  <div className="loc-option__specs">
                    <span>{t("location.conductance", { value: option.conductanceWPerK })}</span>
                    <span>{t("location.wattValue", { watt: option.powerW })}</span>
                    <span>{t("location.dbValue", { db: option.noiseDb.toFixed(0) })}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={current || (!owned && game.money < option.price)}
                    onClick={() => setCooling(option.id)}
                  >
                    {current
                      ? t("location.current")
                      : owned
                        ? t("location.turnOn")
                        : t("location.buy")}
                  </button>
                </article>
              );
            })}
          </div>
          <p className="panel__hint">
            {t("location.coolingHint", {
              current: coolingName(cooling.id, t),
              conductance: cooling.conductanceWPerK,
            })}
          </p>
        </section>

        <section className="panel">
          <div className="panel__label">{t("location.internet")}</div>
          <div className="panel__value">
            {t("location.mbit", { speed: formatInt(plan.speedMbit, language) })}
          </div>
          <div className="loc-options loc-options--stack">
            {plans.map((option) => {
              const current = option.id === plan.id;
              return (
                <div className="loc-plan" key={option.id} data-current={current}>
                  <div>
                    <strong>{t("location.mbit", { speed: formatInt(option.speedMbit, language) })}</strong>
                    <small>
                      {t("location.perMonth", {
                        price: formatMoney(option.pricePerMonth, language, numberFormat),
                      })}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={current}
                    onClick={() => setInternetPlan(option.id)}
                  >
                    {current ? t("location.current") : t("location.switch")}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="panel__hint">{t("location.internetHint")}</p>
        </section>

        <section className="panel">
          <div className="panel__label">{t("location.noise")}</div>
          <div className="panel__value" data-state={noiseState}>
            {t("location.dbValue", { db: noise.toFixed(1) })}
          </div>
          <div className="econ-rows">
            <div className="econ-row">
              <span className="econ-row__label">{night ? t("location.night") : t("location.day")}</span>
              <span className="econ-row__value">{t("location.limit", { db: limit })}</span>
            </div>
            <div className="econ-row">
              <span className="econ-row__label">{t("location.irritation")}</span>
              <span className="econ-row__value">
                {t("location.percent", { value: Math.round(irritation) })}
              </span>
            </div>
          </div>
          <div
            className="loc-bar"
            data-state={
              irritation >= locationData.noise.fineAt
                ? "danger"
                : irritation >= locationData.noise.complaintAt
                  ? "warn"
                  : "ok"
            }
            aria-hidden="true"
          >
            <span style={{ width: `${Math.min(100, irritation)}%` }} />
          </div>
          <ul className="loc-legend">
            <li>{t("location.noise.complaintAt", { value: locationData.noise.complaintAt })}</li>
            <li>{t("location.noise.fineAt", { value: locationData.noise.fineAt })}</li>
            <li>{t("location.noise.shutdownAt", { value: locationData.noise.shutdownAt })}</li>
          </ul>
          {game.location.insulated ? (
            <span className="badge" data-state="ok">
              {t("location.insulated", { db: locationData.insulation.reductionDb })}
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--small btn--primary"
              disabled={game.money < locationData.insulation.price}
              onClick={buyInsulation}
            >
              {t("location.buyInsulation", {
                price: formatMoney(locationData.insulation.price, language, numberFormat),
                db: locationData.insulation.reductionDb,
              })}
            </button>
          )}
          <p className="panel__hint">{t("location.noiseHint")}</p>
        </section>

        <section className="panel panel--wide" data-kind="upgrades">
          <div className="panel__label">{t("location.upgrades")}</div>
          <div className="loc-options">
            <article className="loc-option" data-current={game.location.upsOwned}>
              <div className="loc-option__head">
                <strong>{t("location.ups")}</strong>
                {game.location.upsOwned ? (
                  <span className="badge" data-state="ok">{t("location.upsOwned")}</span>
                ) : (
                  <span className="loc-option__price">
                    {formatMoney(locationData.ups.price, language, numberFormat)}
                  </span>
                )}
              </div>
              <div className="loc-option__specs">
                <span>
                  {t("location.upsDesc", { hours: Math.round(locationData.ups.maxMinutes / 60) })}
                </span>
              </div>
              {!game.location.upsOwned && (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={game.money < locationData.ups.price}
                  onClick={buyUps}
                >
                  {t("location.buyUps")}
                </button>
              )}
            </article>

            <article className="loc-option" data-current={game.location.stabilizerOwned}>
              <div className="loc-option__head">
                <strong>{t("location.stabilizer")}</strong>
                {game.location.stabilizerOwned ? (
                  <span className="badge" data-state="ok">{t("location.stabilizerOwned")}</span>
                ) : (
                  <span className="loc-option__price">
                    {formatMoney(locationData.stabilizer.price, language, numberFormat)}
                  </span>
                )}
              </div>
              <div className="loc-option__specs">
                <span>{t("location.stabilizerDesc")}</span>
              </div>
              {!game.location.stabilizerOwned && (
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={game.money < locationData.stabilizer.price}
                  onClick={buyStabilizer}
                >
                  {t("location.buyStabilizer")}
                </button>
              )}
            </article>

            {definition.id === "home" && (
              <article className="loc-option">
                <div className="loc-option__head">
                  <strong>{t("location.move")}</strong>
                  <span className="loc-option__price">
                    {formatMoney(locationData.moving.price, language, numberFormat)}
                  </span>
                </div>
                <div className="loc-option__specs">
                  <span>{t("location.moveDesc")}</span>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={
                    game.money < locationData.moving.price ||
                    game.location.movingUntilHour !== null
                  }
                  onClick={() => moveLocation("garage")}
                >
                  {t("location.move")}
                </button>
              </article>
            )}

            {definition.id === "garage" && (
              <article className="loc-option">
                <div className="loc-option__head">
                  <strong>{t("location.moveToColo")}</strong>
                  <span className="loc-option__price">
                    {formatMoney(locationData.moving.toColo.price, language, numberFormat)}
                  </span>
                </div>
                <div className="loc-option__specs">
                  <span>{t("location.coloDesc")}</span>
                  <span>
                    {t("location.coloRackInfo", {
                      slots: locationData.rack.slots,
                      watt: formatInt(locationData.rack.powerW, language),
                      price: formatMoney(locationData.rack.rentPerMonth, language, numberFormat),
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={
                    game.money < locationData.moving.toColo.price ||
                    game.location.movingUntilHour !== null
                  }
                  onClick={() => moveLocation("colo")}
                >
                  {t("location.moveToColo")}
                </button>
              </article>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
