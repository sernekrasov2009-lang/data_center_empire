import { useT } from "../../i18n";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatClock, formatMoney } from "../format";

const KPI_PLACEHOLDERS = ["kpi.revenue", "kpi.expenses", "kpi.clients", "kpi.reputation"] as const;

const CHECKLIST = [
  "dash.check.menu",
  "dash.check.saves",
  "dash.check.settings",
  "dash.check.hotkeys",
  "dash.check.clock",
] as const;

export function DashboardScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const hour = useGameStore((state) => state.game.time.hour);
  const money = useGameStore((state) => state.game.money);
  const companyName = useGameStore((state) => state.game.companyName);
  const difficulty = useGameStore((state) => state.game.difficulty);
  const date = getGameDate(hour);

  return (
    <div className="dashboard">
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
        <div className="panel__value">{formatMoney(money, language, numberFormat)}</div>
        <p className="panel__hint">{t("dash.pending")}</p>
      </section>

      <section className="panel">
        <div className="panel__label">{t("dash.company")}</div>
        <div className="panel__value panel__value--text">{companyName}</div>
        <p className="panel__hint">
          {t("dash.difficulty")}: {t(`difficulty.${difficulty}`)}
        </p>
      </section>

      <section className="panel">
        <div className="panel__label">{t("dash.stage")}</div>
        <ul className="checklist checklist--single">
          {CHECKLIST.map((key) => (
            <li key={key}>
              <span className="checklist__mark" aria-hidden="true">
                ✓
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel panel--wide">
        <div className="panel__label">{t("dash.next")}</div>
        <p className="panel__text">{t("dash.next.hint")}</p>
      </section>

      <section className="panel panel--wide panel--kpi">
        <div className="panel__label">{t("dash.pending")}</div>
        <div className="kpi-grid">
          {KPI_PLACEHOLDERS.map((key) => (
            <div key={key} className="kpi">
              <span className="kpi__label">{t(key)}</span>
              <span className="kpi__value">{t("common.empty")}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
