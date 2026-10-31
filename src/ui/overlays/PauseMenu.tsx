import { useT } from "../../i18n";
import { platform } from "../../platform";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { Modal } from "../components/Modal";
import { formatClock, formatMoney } from "../format";

export function PauseMenu(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const dirty = useGameStore((state) => state.dirty);
  const resume = useGameStore((state) => state.resume);
  const openSlots = useGameStore((state) => state.openSlots);
  const openSettings = useGameStore((state) => state.openSettings);
  const requestConfirm = useGameStore((state) => state.requestConfirm);
  const goToMenu = useGameStore((state) => state.goToMenu);

  const date = getGameDate(game.time.hour);

  const toMenu = () => {
    if (!dirty) {
      goToMenu();
      return;
    }
    requestConfirm({
      titleKey: "pause.confirmMenu.title",
      textKey: "pause.confirmMenu.text",
      confirmKey: "pause.menu",
      danger: true,
      action: () => useGameStore.getState().goToMenu(),
    });
  };

  const quit = () => {
    requestConfirm({
      titleKey: "pause.confirmQuit.title",
      textKey: "pause.confirmQuit.text",
      confirmKey: "menu.quit",
      danger: true,
      action: () => platform.quit(),
    });
  };

  return (
    <Modal title={t("pause.title")} subtitle={t("pause.subtitle")} closeLabel={t("pause.resume")} onClose={resume} size="sm">
      <div className="pause">
        <div className="pause__summary">
          <span className="pause__company">{game.companyName}</span>
          <span className="pause__meta">
            {t(`difficulty.${game.difficulty}`)} · {t("hud.year", { year: date.year })} ·{" "}
            {t("hud.month", { month: date.month })} · {t("hud.day", { day: date.dayOfMonth })}{" "}
            {formatClock(date.hourOfDay)}
          </span>
          <span className="pause__money">{formatMoney(game.money, language, numberFormat)}</span>
          {dirty && <span className="pause__dirty">{t("pause.unsaved")}</span>}
        </div>

        <div className="pause__actions">
          <button type="button" className="btn btn--primary" onClick={resume} data-testid="pause-resume">
            {t("pause.resume")}
          </button>
          <button type="button" className="btn" onClick={() => openSlots("save")} data-testid="pause-save">
            {t("pause.save")}
          </button>
          <button type="button" className="btn" onClick={() => openSlots("load")} data-testid="pause-load">
            {t("pause.load")}
          </button>
          <button type="button" className="btn" onClick={() => openSettings("pause")} data-testid="pause-settings">
            {t("pause.settings")}
          </button>
          <button type="button" className="btn" onClick={toMenu} data-testid="pause-menu">
            {t("pause.menu")}
          </button>
          <button type="button" className="btn btn--danger" onClick={quit} data-testid="pause-quit">
            {t("pause.quit")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
