import { useT } from "../../i18n";
import { platform } from "../../platform";
import { useGameStore } from "../../state/store";
import { formatClock, formatMoney, formatSavedAt } from "../format";

function newestSave(saves: ReturnType<typeof useGameStore.getState>["saves"]) {
  return saves.slice().sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null;
}

export function MainMenu(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const saves = useGameStore((state) => state.saves);
  const continueGame = useGameStore((state) => state.continueGame);
  const openNewGame = useGameStore((state) => state.openNewGame);
  const openSlots = useGameStore((state) => state.openSlots);
  const openSettings = useGameStore((state) => state.openSettings);
  const toggleLanguage = useGameStore((state) => state.toggleLanguage);

  const last = newestSave(saves);

  return (
    <div className="menu">
      <section className="menu__panel">
        <header className="menu__head">
          <div className="menu__logo" aria-hidden="true">
            UE
          </div>
          <div>
            <h1 className="menu__title">{t("app.title")}</h1>
            <p className="menu__tagline">{t("menu.tagline")}</p>
          </div>
        </header>

        <div className="menu__actions">
          <button
            type="button"
            className="menu__btn menu__btn--primary"
            onClick={() => void continueGame()}
            disabled={!last}
            data-testid="menu-continue"
          >
            <span className="menu__btn-label">{t("menu.continue")}</span>
            <span className="menu__btn-hint">
              {last
                ? `${last.companyName} · ${t(`difficulty.${last.difficulty}`)} · ${formatSavedAt(last.savedAt, language)}`
                : t("menu.noSaves")}
            </span>
          </button>

          <button type="button" className="menu__btn" onClick={openNewGame} data-testid="menu-new-game">
            <span className="menu__btn-label">{t("menu.newGame")}</span>
            <span className="menu__btn-hint">{t("menu.newGame.hint")}</span>
          </button>

          <button type="button" className="menu__btn" onClick={() => openSlots("load")} data-testid="menu-load">
            <span className="menu__btn-label">{t("menu.load")}</span>
            <span className="menu__btn-hint">
              {last
                ? `${formatMoney(last.money, language, numberFormat)} · ${t("hud.day", { day: last.dayOfMonth })} ${formatClock(last.hourOfDay)}`
                : t("menu.noSaves")}
            </span>
          </button>

          <button type="button" className="menu__btn" onClick={() => openSettings(null)} data-testid="menu-settings">
            <span className="menu__btn-label">{t("menu.settings")}</span>
            <span className="menu__btn-hint">{t("menu.settings.hint")}</span>
          </button>

          <button
            type="button"
            className="menu__btn menu__btn--quiet"
            onClick={() => platform.quit()}
            data-testid="menu-quit"
          >
            <span className="menu__btn-label">{t("menu.quit")}</span>
          </button>
        </div>

        <footer className="menu__foot">
          <span>
            {t("menu.version", { version: platform.versions.app })} · {platform.isElectron ? "Electron" : "Browser"}
          </span>
          <button
            type="button"
            className="ghost-btn"
            onClick={toggleLanguage}
            title={t("common.language")}
            aria-label={t("common.language")}
          >
            {language === "ru" ? t("common.en") : t("common.ru")}
          </button>
        </footer>
      </section>
    </div>
  );
}
