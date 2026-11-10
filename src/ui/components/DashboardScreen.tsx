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
  const date = getGameDate(hour);

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
