import { formatClock, formatMoney } from "../format";
import { useT } from "../../i18n";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { SpeedControls } from "./SpeedControls";

export function TopBar(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const toggleLanguage = useGameStore((state) => state.toggleLanguage);
  const companyName = useGameStore((state) => state.game.companyName);
  const money = useGameStore((state) => state.game.money);
  const hour = useGameStore((state) => state.game.time.hour);
  const paused = useGameStore((state) => state.game.time.paused);
  const speed = useGameStore((state) => state.game.time.speed);
  const openPause = useGameStore((state) => state.openPause);
  const openSettings = useGameStore((state) => state.openSettings);

  const date = getGameDate(hour);

  return (
    <header className="topbar">
      <div className="brand" title={companyName}>
        <span className="led" data-state={paused ? "warn" : "ok"} aria-hidden="true" />
        <div className="brand__text">
          <div className="brand__title">{companyName}</div>
          <div className="brand__subtitle">{t("app.title")}</div>
        </div>
      </div>

      <div className="stat">
        <span className="stat__label">{t("hud.money")}</span>
        <span className="stat__value stat__value--money">{formatMoney(money, language, numberFormat)}</span>
      </div>

      <div className="stat">
        <span className="stat__label">{t("hud.date")}</span>
        <span className="stat__value">
          {t("hud.day", { day: date.dayOfMonth })} · {formatClock(date.hourOfDay)}
        </span>
        <span className="stat__hint">
          {t("hud.year", { year: date.year })} · {t("hud.month", { month: date.month })}
        </span>
      </div>

      <SpeedControls paused={paused} />

      <div className="topbar__right">
        <span className="badge" data-state={paused ? "warn" : "ok"}>
          {paused ? t("hud.paused") : `×${speed}`}
        </span>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => openSettings(null)}
          title={t("menu.settings")}
          aria-label={t("menu.settings")}
        >
          ⚙
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={openPause}
          title={t("pause.title")}
          aria-label={t("pause.title")}
        >
          ☰
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={toggleLanguage}
          title={t("common.language")}
          aria-label={t("common.language")}
        >
          {language === "ru" ? t("common.en") : t("common.ru")}
        </button>
      </div>
    </header>
  );
}
