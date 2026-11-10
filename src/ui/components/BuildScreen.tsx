import { useMemo, useState } from "react";
import { getComponent, hardware, type ComponentType } from "../../data";
import { useT, type Translate } from "../../i18n";
import {
  buildHours,
  buildStats,
  buildStatsForBuild,
  newPartPrice,
  validateBuild,
  type BuildStats,
} from "../../sim";
import { useGameStore } from "../../state/store";
import { formatInt, formatMoney } from "../format";

const SINGLE_TYPES: readonly ComponentType[] = ["cpu", "motherboard", "psu", "case", "nic"];
const MULTI_TYPES: readonly ComponentType[] = ["ram", "storage"];
const ALL_TYPES: readonly ComponentType[] = [
  "cpu",
  "motherboard",
  "ram",
  "storage",
  "psu",
  "case",
  "nic",
];

function componentSummary(componentId: string, t: Translate): string {
  const component = getComponent(componentId);
  switch (component.type) {
    case "cpu":
      return t("hardware.spec.cpu", {
        cores: component.specs.cores ?? 0,
        socket: component.socket ?? "—",
      });
    case "motherboard":
      return t("hardware.spec.board", {
        socket: component.socket ?? "—",
        ram: component.ramType ?? "—",
        slots: component.specs.ramSlots ?? 0,
      });
    case "ram":
      return t("hardware.spec.ram", {
        gb: component.specs.capacityGb ?? 0,
        type: component.ramType ?? "—",
      });
    case "storage":
      return t("hardware.spec.storage", {
        gb: component.specs.capacityGb ?? 0,
        speed: component.specs.speedMbs ?? 0,
      });
    case "psu":
      return t("hardware.spec.psu", { watt: component.specs.wattage ?? 0 });
    case "case":
      return t("hardware.spec.case", {
        form: component.formFactor ?? "—",
        bays: component.specs.driveBays ?? 0,
      });
    case "nic":
      return t("hardware.spec.nic", {
        speed: component.specs.networkMbit ?? 0,
        ports: component.specs.ports ?? 1,
      });
  }
}

function conditionLabel(condition: "new" | "used", t: Translate): string {
  return t(`hardware.condition.${condition}`);
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="hw-kpi">
      <span className="hw-kpi__label">{label}</span>
      <span className="hw-kpi__value">{value}</span>
    </div>
  );
}

function statsBlock(stats: BuildStats, t: Translate, language: "ru" | "en", numberFormat: "short" | "full"): React.JSX.Element {
  return (
    <div className="hw-kpis">
      <Stat label={t("hardware.cores")} value={formatInt(stats.cores, language)} />
      <Stat label={t("hardware.ram")} value={t("hardware.gb", { gb: formatInt(stats.ramGb, language) })} />
      <Stat
        label={t("hardware.storage")}
        value={t("hardware.gb", { gb: formatInt(stats.storageGb, language) })}
      />
      <Stat label={t("hardware.power")} value={t("hardware.watt", { watt: stats.power })} />
      <Stat label={t("hardware.noise")} value={t("hardware.db", { db: stats.noiseDb.toFixed(1) })} />
      <Stat label={t("hardware.price")} value={formatMoney(stats.price, language, numberFormat)} />
    </div>
  );
}

export function BuildScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const placeNewOrder = useGameStore((state) => state.placeNewOrder);
  const buyUsedLot = useGameStore((state) => state.buyUsedLot);
  const startBuild = useGameStore((state) => state.startBuild);

  const [tab, setTab] = useState<"build" | "shop">("build");
  const [selection, setSelection] = useState<number[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"all" | ComponentType>("all");

  const { parts, builds, usedLots, marketPriceMult } = game.hardware;
  const hour = game.time.hour;

  const byId = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts]);
  const chosenIds = selection.filter((id) => byId.has(id));
  const chosen = chosenIds.map((id) => byId.get(id)!);
  const chosenComponents = chosen.map((part) => part.componentId);
  const stats = chosen.length > 0 ? buildStats(chosenComponents) : null;
  const validation = chosen.length > 0 ? validateBuild(chosenComponents) : null;

  function ofType(type: ComponentType) {
    return chosen.filter((part) => getComponent(part.componentId).type === type);
  }

  function available(type: ComponentType) {
    return parts.filter((part) => getComponent(part.componentId).type === type);
  }

  function pickSingle(type: ComponentType, id: string): void {
    setSelection((previous) => {
      const kept = previous.filter((partId) => {
        const part = byId.get(partId);
        return part !== undefined && getComponent(part.componentId).type !== type;
      });
      return id === "" ? kept : [...kept, Number(id)];
    });
  }

  function addPart(id: string): void {
    if (!id) return;
    const partId = Number(id);
    setSelection((previous) => (previous.includes(partId) ? previous : [...previous, partId]));
  }

  function removePart(id: number): void {
    setSelection((previous) => previous.filter((partId) => partId !== id));
  }

  function quantityFor(componentId: string): number {
    return quantities[componentId] ?? 1;
  }

  function setQuantity(componentId: string, value: string): void {
    const parsed = Number.parseInt(value, 10);
    const quantity = Number.isFinite(parsed) ? Math.min(99, Math.max(1, parsed)) : 1;
    setQuantities((previous) => ({ ...previous, [componentId]: quantity }));
  }

  const filtered = hardware.components.filter(
    (component) => filter === "all" || component.type === filter,
  );

  return (
    <div className="hardware">
      <div className="hardware__head">
        <div>
          <h1 className="hardware__title">{t("hardware.title")}</h1>
          <p className="hardware__subtitle">{t("hardware.subtitle")}</p>
        </div>
        <div className="hardware__tabs" role="tablist" aria-label={t("hardware.title")}>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === "build"}
            data-active={tab === "build"}
            onClick={() => setTab("build")}
          >
            {t("hardware.tab.build")}
          </button>
          <button
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === "shop"}
            data-active={tab === "shop"}
            onClick={() => setTab("shop")}
          >
            {t("hardware.tab.shop")}
          </button>
        </div>
      </div>

      {tab === "build" ? (
        <div className="hardware__grid">
          <section className="panel hardware__builder">
            <div className="panel__label">{t("hardware.builder")}</div>
            <p className="panel__hint">{t("hardware.builderHint")}</p>

            <div className="hw-slots">
              {SINGLE_TYPES.map((type) => {
                const current = ofType(type)[0];
                const options = available(type);
                return (
                  <label className="hw-slot" key={type}>
                    <span className="hw-slot__label">{t(`hardware.type.${type}`)}</span>
                    <select
                      className="select"
                      value={current ? String(current.id) : ""}
                      onChange={(event) => pickSingle(type, event.target.value)}
                    >
                      <option value="">{t("hardware.choosePart")}</option>
                      {options.map((part) => {
                        const component = getComponent(part.componentId);
                        return (
                          <option key={part.id} value={part.id}>
                            {component.name} · {conditionLabel(part.condition, t)} ·{" "}
                            {formatMoney(part.purchasePrice, language, numberFormat)}
                          </option>
                        );
                      })}
                    </select>
                    {options.length === 0 && (
                      <span className="hw-slot__hint">{t("hardware.noParts")}</span>
                    )}
                  </label>
                );
              })}

              {MULTI_TYPES.map((type) => {
                const current = ofType(type);
                const options = available(type).filter(
                  (part) => !chosenIds.includes(part.id),
                );
                return (
                  <div className="hw-slot hw-slot--multi" key={type}>
                    <span className="hw-slot__label">{t(`hardware.type.${type}`)}</span>
                    <div className="hw-chosen">
                      {current.length === 0 && (
                        <span className="hw-slot__hint">{t("hardware.chooseAtLeastOne")}</span>
                      )}
                      {current.map((part) => (
                        <span className="hw-chip" key={part.id}>
                          {getComponent(part.componentId).name} · {conditionLabel(part.condition, t)}
                          <button
                            type="button"
                            className="hw-chip__remove"
                            onClick={() => removePart(part.id)}
                            title={t("hardware.removePart")}
                            aria-label={t("hardware.removePart")}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <select
                      className="select"
                      value=""
                      onChange={(event) => addPart(event.target.value)}
                      disabled={options.length === 0}
                    >
                      <option value="">{t("hardware.addPart")}</option>
                      {options.map((part) => {
                        const component = getComponent(part.componentId);
                        return (
                          <option key={part.id} value={part.id}>
                            {component.name} · {conditionLabel(part.condition, t)} ·{" "}
                            {formatMoney(part.purchasePrice, language, numberFormat)}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })}
            </div>

            {stats && (
              <div className="hw-summary">
                {statsBlock(stats, t, language, numberFormat)}
                <p className="hw-headroom">
                  {t("hardware.psuHeadroom", {
                    watt: stats.psuWattage,
                    ratio: stats.psuHeadroom.toFixed(2),
                  })}
                </p>
              </div>
            )}

            {validation && !validation.ok && (
              <ul className="hw-errors" aria-label={t("hardware.errors")}>
                {validation.errors.map((error, index) => (
                  <li key={`${error.code}-${index}`}>
                    {t(`hardware.error.${error.code}`, error.params)}
                  </li>
                ))}
              </ul>
            )}

            <div className="hw-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!validation?.ok}
                onClick={() => {
                  if (startBuild(chosenIds)) setSelection([]);
                }}
              >
                {t("hardware.buildButton")}
              </button>
              <span className="hw-actions__hint">
                {t("hardware.buildHours", { hours: buildHours(chosenIds.length) })}
              </span>
            </div>
          </section>

          <section className="panel hardware__builds">
            <div className="panel__label">{t("hardware.assembled")}</div>
            {builds.length === 0 ? (
              <p className="panel__hint">{t("hardware.noBuilds")}</p>
            ) : (
              <div className="build-list">
                {builds.map((build) => {
                  const buildStatsValue = buildStatsForBuild(build);
                  const broken = build.parts.filter((part) => part.broken);
                  const repairHours = broken
                    .map((part) => part.repairDoneHour)
                    .filter((value): value is number => value !== null)
                    .map((value) => Math.max(0, value - hour));
                  return (
                    <article className="build-card" key={build.id}>
                      <header className="build-card__head">
                        <div>
                          <div className="build-card__name">
                            {build.starter
                              ? t("hardware.startServer")
                              : t("hardware.serverName", { n: build.id })}
                          </div>
                          <div className="build-card__meta">
                            {build.status === "assembling"
                              ? t("hardware.assembling", {
                                  hours: Math.max(0, build.readyAtHour - hour),
                                })
                              : broken.length > 0
                                ? t("hardware.down", { n: broken.length })
                                : t("hardware.ready")}
                          </div>
                        </div>
                        <span className="build-card__value">
                          {formatMoney(buildStatsValue.price, language, numberFormat)}
                        </span>
                      </header>
                      <div className="build-card__stats">
                        <span>{t("hardware.coresShort", { n: buildStatsValue.cores })}</span>
                        <span>{t("hardware.ramShort", { gb: buildStatsValue.ramGb })}</span>
                        <span>{t("hardware.storageShort", { gb: buildStatsValue.storageGb })}</span>
                        <span>{t("hardware.powerShort", { watt: buildStatsValue.power })}</span>
                        <span>{t("hardware.noiseShort", { db: buildStatsValue.noiseDb.toFixed(1) })}</span>
                      </div>
                      <div className="build-card__parts">
                        {build.parts.map((part, index) => {
                          const component = getComponent(part.componentId);
                          const repair =
                            part.broken && part.repairDoneHour !== null
                              ? Math.max(0, part.repairDoneHour - hour)
                              : null;
                          return (
                            <span
                              className="build-part"
                              data-broken={part.broken}
                              key={`${part.componentId}-${index}`}
                              title={`${component.name} · ${conditionLabel(part.condition, t)}`}
                            >
                              {component.name}
                              {part.condition === "used"
                                ? ` · ${t("hardware.condition.used")}`
                                : ""}
                              {repair !== null ? ` · ${t("hardware.repairIn", { hours: repair })}` : ""}
                            </span>
                          );
                        })}
                      </div>
                      {repairHours.length > 0 && (
                        <p className="panel__hint">
                          {t("hardware.repairHint", {
                            hours: Math.max(...repairHours),
                          })}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="hardware__shop">
          <section className="panel">
            <div className="panel__label">{t("hardware.shop.new")}</div>
            <div className="hw-shop-toolbar">
              <label className="hw-filter">
                <span>{t("hardware.filter")}</span>
                <select
                  className="select"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as "all" | ComponentType)}
                >
                  <option value="all">{t("hardware.filter.all")}</option>
                  {ALL_TYPES.map((type) => (
                    <option value={type} key={type}>
                      {t(`hardware.type.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="badge" data-state="ok">
                {t("hardware.marketMult", { mult: marketPriceMult.toFixed(3) })}
              </span>
            </div>
            <div className="hw-table" role="table">
              <div className="hw-table__head" role="row">
                <span role="columnheader">{t("hardware.name")}</span>
                <span role="columnheader">{t("hardware.specs")}</span>
                <span role="columnheader">{t("hardware.price")}</span>
                <span role="columnheader">{t("hardware.quantity")}</span>
                <span role="columnheader" />
              </div>
              {filtered.map((component) => {
                const price = newPartPrice(component.id, marketPriceMult);
                const quantity = quantityFor(component.id);
                return (
                  <div className="hw-table__row" role="row" key={component.id}>
                    <span className="hw-table__name" role="cell">
                      <strong>{component.name}</strong>
                      <small>{t(`hardware.type.${component.type}`)}</small>
                    </span>
                    <span className="hw-table__specs" role="cell">
                      {componentSummary(component.id, t)}
                    </span>
                    <span className="hw-table__price" role="cell">
                      {formatMoney(price, language, numberFormat)}
                    </span>
                    <span className="hw-table__qty" role="cell">
                      <input
                        className="input input--qty"
                        type="number"
                        min={1}
                        max={99}
                        value={quantity}
                        onChange={(event) => setQuantity(component.id, event.target.value)}
                        aria-label={t("hardware.quantity")}
                      />
                    </span>
                    <span role="cell">
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => placeNewOrder(component.id, quantity)}
                      >
                        {t("hardware.order")}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel__label">{t("hardware.shop.used")}</div>
            <p className="panel__hint">{t("hardware.usedHint")}</p>
            {usedLots.length === 0 ? (
              <p className="panel__hint">{t("hardware.usedEmpty")}</p>
            ) : (
              <div className="lot-grid">
                {usedLots.map((lot) => {
                  const component = getComponent(lot.componentId);
                  const daysLeft = Math.max(0, Math.ceil((lot.expiresAtHour - hour) / 24));
                  return (
                    <article className="lot" key={lot.id}>
                      <div className="lot__head">
                        <strong>{component.name}</strong>
                        <span className="lot__discount">
                          −{Math.round(lot.discount * 100)}%
                        </span>
                      </div>
                      <div className="lot__specs">{componentSummary(component.id, t)}</div>
                      <div className="lot__price">
                        {formatMoney(lot.price, language, numberFormat)}
                      </div>
                      <div className="lot__meta">
                        {t("hardware.lotMeta", { days: daysLeft })}
                      </div>
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => buyUsedLot(lot.id)}
                      >
                        {t("hardware.buy")}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel panel--wide">
            <div className="panel__label">{t("hardware.delivery")}</div>
            <ul className="hw-delivery">
              <li>{t("hardware.delivery.new", { min: hardware.delivery.newDaysMin, max: hardware.delivery.newDaysMax })}</li>
              <li>{t("hardware.delivery.used", { min: hardware.delivery.usedDaysMin, max: hardware.delivery.usedDaysMax })}</li>
              <li>{t("hardware.delivery.free", { amount: formatMoney(hardware.delivery.freeFrom, language, numberFormat), fee: formatMoney(hardware.delivery.fee, language, numberFormat) })}</li>
              <li>{t("hardware.delivery.cancel", { hours: hardware.delivery.cancelHours })}</li>
              <li>{t("hardware.delivery.return", { days: hardware.delivery.returnDays, fee: Math.round(hardware.delivery.returnFee * 100) })}</li>
            </ul>
            <p className="panel__hint">{t("hardware.shop.bulkNote")}</p>
          </section>
        </div>
      )}

      <section className="panel panel--wide">
        <div className="panel__label">{t("hardware.stockHint")}</div>
        <p className="panel__hint">
          {t("hardware.stockCount", { count: parts.length })} · {t("hardware.stockValue", {
            value: formatMoney(
              parts.reduce((sum, part) => sum + part.purchasePrice, 0),
              language,
              numberFormat,
            ),
          })}
        </p>
      </section>
    </div>
  );
}
