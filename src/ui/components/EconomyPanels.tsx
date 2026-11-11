import { economy as economyData, getInternetPlan } from "../../data";
import { useT } from "../../i18n";
import {
  HOURS_PER_MONTH,
  bankruptcyStatus,
  cashForecast,
  daysUntilBill,
  fixedMonthlyCosts,
  hardwareLoadW,
  projectedMonthlyExpenses,
} from "../../sim";
import { useGameStore } from "../../state/store";
import { formatInt, formatMoney, formatMoneyExact } from "../format";

/** Предупреждение о минусе и приближении банкротства. */
export function EconomyBanner(): React.JSX.Element | null {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);

  const status = bankruptcyStatus(game);
  if (status === "ok" || status === "over") return null;

  const money = formatMoney(game.money, language, numberFormat);
  if (status === "negative") {
    return (
      <div className="econ-banner" data-kind="warn" role="status">
        <span className="econ-banner__title">{t("econ.banner.negative")}</span>
        <span className="econ-banner__text">{t("econ.banner.negative.text", { money })}</span>
      </div>
    );
  }

  return (
    <div className="econ-banner" data-kind="danger" role="status">
      <span className="econ-banner__title">{t("econ.banner.critical")}</span>
      <span className="econ-banner__text">
        {t("econ.banner.critical.text", {
          money,
          threshold: formatMoney(economyData.bankruptcy.threshold, language, numberFormat),
        })}
      </span>
    </div>
  );
}

/** Начисления текущего месяца и дата следующего счёта. */
export function ThisMonthPanel(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);

  const projected = projectedMonthlyExpenses(game);
  const days = daysUntilBill(game.time.hour);
  const elapsed = game.time.hour % HOURS_PER_MONTH;

  return (
    <section className="panel">
      <div className="panel__label">{t("econ.thisMonth")}</div>
      <div className="panel__value panel__value--expense">
        {formatMoney(-projected.total, language, numberFormat)}
      </div>
      <div className="month-bar" aria-hidden="true">
        <span style={{ width: `${(elapsed / HOURS_PER_MONTH) * 100}%` }} />
      </div>
      <div className="econ-rows">
        <div className="econ-row">
          <span className="econ-row__label">{t("econ.accrued")}</span>
          <span className="econ-row__value">
            {formatMoney(-game.economy.accrual.electricity, language, numberFormat)}
          </span>
        </div>
        <div className="econ-row">
          <span className="econ-row__label">{t("econ.nextBill")}</span>
          <span className="econ-row__value">{t("econ.days", { days })}</span>
        </div>
      </div>
      <p className="panel__hint">{t("econ.thisMonth.hint")}</p>
    </section>
  );
}

/** Из чего складывается счёт: электричество, интернет, аренда. */
export function ExpensesPanel(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);

  const projected = projectedMonthlyExpenses(game);
  const fixed = fixedMonthlyCosts(game);
  const plan = getInternetPlan(game.location.internetPlanId);
  const pue = economyData.electricity.pue[game.location.id as keyof typeof economyData.electricity.pue];
  const price = economyData.electricity.tariffs.find(
    (tariff) => tariff.id === economyData.start.electricityTariffId,
  );

  return (
    <section className="panel">
      <div className="panel__label">{t("econ.breakdown")}</div>
      <div className="econ-rows">
        <div className="econ-row">
          <span className="econ-row__label">{t("econ.electricity")}</span>
          <span className="econ-row__value">
            {formatMoney(-projected.electricity, language, numberFormat)}
          </span>
        </div>
        <div className="econ-row__hint">
          {t("econ.hint.electricity", {
            load: formatInt(hardwareLoadW(game), language),
            pue: String(pue).replace(".", language === "ru" ? "," : "."),
            price: formatMoneyExact((price?.pricePerKwh ?? 0) * game.economy.electricityPriceMult, language),
          })}
        </div>
        <div className="econ-row">
          <span className="econ-row__label">{t("econ.internet")}</span>
          <span className="econ-row__value">{formatMoney(-fixed.internet, language, numberFormat)}</span>
        </div>
        <div className="econ-row__hint">
          {t("econ.hint.internet", { speed: formatInt(plan.speedMbit, language) })}
        </div>
        <div className="econ-row">
          <span className="econ-row__label">{t("econ.rent")}</span>
          <span className="econ-row__value">{formatMoney(-fixed.rent, language, numberFormat)}</span>
        </div>
        <div className="econ-row__hint">{t("econ.hint.rent")}</div>
        {fixed.staff > 0 && (
          <>
            <div className="econ-row">
              <span className="econ-row__label">{t("econ.staff")}</span>
              <span className="econ-row__value">
                {formatMoney(-fixed.staff, language, numberFormat)}
              </span>
            </div>
            <div className="econ-row__hint">{t("econ.hint.staff")}</div>
          </>
        )}
        <div className="econ-row econ-row--total">
          <span className="econ-row__label">{t("econ.total")}</span>
          <span className="econ-row__value">{formatMoney(-projected.total, language, numberFormat)}</span>
        </div>
      </div>
    </section>
  );
}

/** Прогноз денег на три месяца при текущем счёте. */
export function ForecastPanel(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);

  const forecast = cashForecast(game);

  return (
    <section className="panel">
      <div className="panel__label">{t("econ.forecast")}</div>
      <div className="forecast-list">
        {forecast.map((row) => (
          <div key={row.month} className="forecast-row" data-negative={row.money < 0}>
            <span className="forecast-row__label">{t("econ.forecast.month", { n: row.month })}</span>
            <span className="forecast-row__value">{formatMoney(row.money, language, numberFormat)}</span>
          </div>
        ))}
      </div>
      <p className="panel__hint">{t("econ.forecast.hint")}</p>
    </section>
  );
}

/** Последние закрытые месяцы: сколько списали и сколько осталось. */
export function ReportsPanel(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const reports = useGameStore((state) => state.game.economy.reports);

  const latest = reports.slice(-6).reverse();

  return (
    <section className="panel">
      <div className="panel__label">{t("econ.reports")}</div>
      {latest.length === 0 ? (
        <p className="panel__hint">{t("econ.reports.empty")}</p>
      ) : (
        <ul className="bill-list">
          {latest.map((report) => (
            <li key={`${report.year}-${report.month}-${report.hour}`} className="bill">
              <span className="bill__month">{t("econ.monthYear", { month: report.month, year: report.year })}</span>
              <span className="bill__net">{formatMoney(report.net, language, numberFormat)}</span>
              <span className="bill__after">{formatMoney(report.moneyAfter, language, numberFormat)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="panel__hint">{t("econ.reports.hint")}</p>
    </section>
  );
}
