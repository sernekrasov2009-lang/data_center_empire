import { getService, servicesData, type ServiceId } from "../../data";
import { useT } from "../../i18n";
import { activeBuilds, buildUsage, clientsByService, usedMbit } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatInt, formatMoney } from "../format";

const SERVICE_ORDER: readonly ServiceId[] = ["landing", "cms", "chatbot"];

export function ServicesScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const setServicePrice = useGameStore((state) => state.setServicePrice);
  const toggleService = useGameStore((state) => state.toggleService);
  const setServiceLimit = useGameStore((state) => state.setServiceLimit);

  const counts = clientsByService(game);
  const usage = buildUsage(game);
  const running = activeBuilds(game).length > 0;
  const internet = usedMbit(game);
  const perHour = game.services.lastHourRevenue;

  return (
    <div className="services">
      <div className="hardware__head">
        <div>
          <h1 className="hardware__title">{t("services.title")}</h1>
          <p className="hardware__subtitle">{t("services.subtitle")}</p>
        </div>
        <div className="warehouse__summary">
          <span className="badge">{t("services.clientsBadge", { count: game.services.clients.length })}</span>
          <span className="badge" data-state={perHour > 0 ? "ok" : undefined}>
            {t("services.perHour", { value: formatMoney(perHour, language, numberFormat) })}
          </span>
        </div>
      </div>

      <div className="location__grid">
        {SERVICE_ORDER.map((serviceId) => {
          const definition = getService(serviceId);
          const entry = game.services.services.find((service) => service.id === serviceId);
          if (!entry) return null;
          const count = counts[serviceId] ?? 0;
          const price = definition.pricePerMonth * entry.priceMult;
          const market = definition.pricePerMonth;
          const revenue = count * price;

          return (
            <section className="panel" key={serviceId} data-service={serviceId}>
              <div className="panel__label">{t(`services.name.${serviceId}`)}</div>
              <div className="panel__value" data-state={entry.enabled ? "ok" : undefined}>
                {t("services.clients", { count })}
              </div>
              <div className="econ-rows">
                <div className="econ-row">
                  <span className="econ-row__label">{t("services.price")}</span>
                  <span className="econ-row__value">
                    {formatMoney(price, language, numberFormat)}
                  </span>
                </div>
                <div className="econ-row">
                  <span className="econ-row__label">{t("services.market")}</span>
                  <span className="econ-row__value">
                    {formatMoney(market, language, numberFormat)}
                  </span>
                </div>
                <div className="econ-row">
                  <span className="econ-row__label">{t("services.sla")}</span>
                  <span className="econ-row__value">{t("services.slaValue", { value: definition.slaPercent })}</span>
                </div>
                <div className="econ-row">
                  <span className="econ-row__label">{t("services.revenue")}</span>
                  <span className="econ-row__value">
                    {t("services.perMonth", { value: formatMoney(revenue, language, numberFormat) })}
                  </span>
                </div>
              </div>

              <label className="svc-field">
                <span>{t("services.priceLabel", {
                  min: Math.round(servicesData.demand.priceMinMult * 100),
                  max: Math.round(servicesData.demand.priceMaxMult * 100),
                })}</span>
                <input
                  className="svc-slider"
                  type="range"
                  min={servicesData.demand.priceMinMult}
                  max={servicesData.demand.priceMaxMult}
                  step={0.05}
                  value={entry.priceMult}
                  onChange={(event) => setServicePrice(serviceId, Number(event.target.value))}
                />
                <span className="svc-slider__value">{Math.round(entry.priceMult * 100)}%</span>
              </label>

              <label className="svc-field">
                <span>{t("services.limitLabel")}</span>
                <input
                  className="svc-input"
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  value={entry.clientLimit === 0 ? "" : entry.clientLimit}
                  placeholder="∞"
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw === "") return;
                    setServiceLimit(serviceId, Math.max(0, Math.floor(Number(raw) || 0)));
                  }}
                />
              </label>

              <button
                type="button"
                className="btn btn--small"
                data-state={entry.enabled ? "ok" : undefined}
                disabled={!entry.enabled && !running}
                onClick={() => toggleService(serviceId)}
              >
                {entry.enabled ? t("services.disable") : t("services.enable")}
              </button>

              <p className="panel__hint">
                {t("services.hint", {
                  cores: definition.coresPerClient,
                  ram: definition.ramGbPerClient,
                  storage: definition.storageGbPerClient,
                  mbit: definition.mbitPerClient,
                })}
              </p>
            </section>
          );
        })}

        <section className="panel panel--wide">
          <div className="panel__label">{t("services.usage")}</div>
          <div className="loc-slots">
            {usage.length === 0 && (
              <p className="panel__hint">{t("services.noServers")}</p>
            )}
            {usage.map((build) => (
              <article className="loc-slot" key={build.buildId} data-filled={build.clients > 0}>
                <div className="loc-slot__head">
                  <span className="loc-slot__label">
                    {t("services.server", { n: build.buildId })}
                  </span>
                  <span className="badge" data-state={build.clients > 0 ? "ok" : undefined}>
                    {t("services.clients", { count: build.clients })}
                  </span>
                </div>
                <div className="econ-rows">
                  <div className="econ-row">
                    <span className="econ-row__label">{t("services.cores")}</span>
                    <span className="econ-row__value">
                      {formatCores(language, build.coresUsed)} / {formatInt(build.coresTotal, language)}
                    </span>
                  </div>
                  <div className="econ-row">
                    <span className="econ-row__label">{t("services.ram")}</span>
                    <span className="econ-row__value">
                      {formatGb(language, build.ramGbUsed)} / {formatInt(build.ramGbTotal, language)} GB
                    </span>
                  </div>
                  <div className="econ-row">
                    <span className="econ-row__label">{t("services.storage")}</span>
                    <span className="econ-row__value">
                      {formatGb(language, build.storageGbUsed)} / {formatInt(build.storageGbTotal, language)} GB
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="econ-rows">
            <div className="econ-row">
              <span className="econ-row__label">{t("services.internet")}</span>
              <span className="econ-row__value">{t("services.mbit", { value: internet.toFixed(2) })}</span>
            </div>
          </div>
          <p className="panel__hint">{t("services.usageHint")}</p>
        </section>
      </div>
    </div>
  );
}

function formatCores(language: string, value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace(".", language === "ru" ? "," : ".");
}

function formatGb(language: string, value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded).replace(".", language === "ru" ? "," : ".");
}
