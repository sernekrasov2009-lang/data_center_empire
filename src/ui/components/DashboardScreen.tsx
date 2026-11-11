import { useT } from "../../i18n";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatClock, formatMoney } from "../format";
import {
  EconomyBanner,
  ExpensesPanel,
  ForecastPanel,
  ReportsPanel,
  ThisMonthPanel,
} from "./EconomyPanels";

const CHECKLIST = [
  "dash.check.location",
  "dash.check.power",
  "dash.check.cooling",
  "dash.check.internet",
  "dash.check.noise",
] as const;

export function DashboardScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const hour = useGameStore((state) => state.game.time.hour);
  const money = useGameStore((state) => state.game.money);
  const companyName = useGameStore((state) => state.game.companyName);
  const difficulty = useGameStore((state) => state.game.difficulty);
  const lastReport = useGameStore((state) => state.game.economy.reports.at(-1) ?? null);
  const world = useGameStore((state) => state.game.world);
  const date = getGameDate(hour);
  const priceSpikeActive = world.electricityPriceEventHoursLeft > 0;

  return (
    <div className="dashboard">
      <EconomyBanner />

      <section className="panel panel--clock">
        <div className="panel__label">{t("dash.clock")}</div>
        <div className="clock__time">{formatClock(date.hourOfDay)}</div>
        <div className="clock__meta">
          {t("hud.year", { year: date.year })} · {t("hud.month", { month: date.month })} ·{" "}
          {t("hud.day", { day: date.dayOfMonth })}
        </div>
        <div className="clock__bar" aria-hidden="true">
          <span style={{ width: `${(date.hourOfDay / 24) * 100}%` }} />
        </div>
        <p className="panel__hint">{t("dash.clockHint")}</p>
      </section>

      <section className="panel">
        <div className="panel__label">{t("hud.money")}</div>
        <div className="panel__value" data-state={money < 0 ? "danger" : "ok"}>
          {formatMoney(money, language, numberFormat)}
        </div>
        <p className="panel__hint">
          {lastReport
            ? t("dash.lastMonth", { net: formatMoney(lastReport.net, language, numberFormat) })
            : t("dash.noReports")}
        </p>
        <p className="panel__hint">
          {t("dash.company")}: {companyName} · {t(`difficulty.${difficulty}`)}
        </p>
      </section>

      <ThisMonthPanel />
      <ExpensesPanel />
      <ForecastPanel />
      <ReportsPanel />

      <section className="panel panel--wide" data-kind="world">
        <div className="panel__label">{t("world.active")}</div>
        {world.active.length === 0 && !priceSpikeActive ? (
          <p className="panel__hint">{t("world.activeEmpty")}</p>
        ) : (
          <ul className="checklist">
            {world.active.map((event) => (
              <li key={event.id}>
                <span className="badge" data-state="warn">
                  {t(`world.${event.kind}`)}
                </span>{" "}
                {t("world.endsIn", { hours: Math.max(0, event.endAtHour - hour) })}
              </li>
            ))}
            {priceSpikeActive && (
              <li>
                <span className="badge" data-state="warn">
                  {t("world.electricityPriceSpike", {
                    percent: Math.round((world.electricityPriceEventMult - 1) * 100),
                  })}
                </span>{" "}
                {t("world.electricityPriceLeft", {
                  months: (world.electricityPriceEventHoursLeft / 720).toFixed(1),
                })}
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="panel panel--wide">
        <div className="panel__label">{t("dash.stage")}</div>
        <ul className="checklist">
          {CHECKLIST.map((key) => (
            <li key={key}>
              <span className="checklist__mark" aria-hidden="true">
                ✓
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
        <p className="panel__hint">{t("dash.next.hint")}</p>
      </section>
    </div>
  );
}
