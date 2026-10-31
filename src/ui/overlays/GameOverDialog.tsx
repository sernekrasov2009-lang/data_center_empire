import { useT } from "../../i18n";
import { platform } from "../../platform";
import { economy as economyData } from "../../data";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { Modal } from "../components/Modal";
import { formatClock, formatMoney } from "../format";

/**
 * Экран банкротства. Закрыть его нельзя: время уже стоит, а продолжить игру
 * можно только загрузкой другого сохранения или новой игрой из главного меню.
 */
export function GameOverDialog(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const openSlots = useGameStore((state) => state.openSlots);
  const goToMenu = useGameStore((state) => state.goToMenu);

  const over = game.gameOver;
  const hour = over?.hour ?? game.time.hour;
  const date = getGameDate(hour);
  const lastReport = game.economy.reports.at(-1) ?? null;

  return (
    <Modal
      title={t("gameOver.title")}
      subtitle={t("gameOver.subtitle")}
      closeLabel={t("gameOver.menu")}
      size="sm"
      testId="game-over"
      footer={
        <>
          <button type="button" className="btn" onClick={goToMenu} data-testid="gameover-menu">
            {t("gameOver.menu")}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => platform.quit()} data-testid="gameover-quit">
            {t("gameOver.quit")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openSlots("load")}
            data-testid="gameover-load"
          >
            {t("gameOver.load")}
          </button>
        </>
      }
    >
      <div className="gameover">
        <p className="gameover__lead">
          {t("gameOver.text", {
            money: formatMoney(over?.money ?? game.money, language, numberFormat),
            threshold: formatMoney(economyData.bankruptcy.threshold, language, numberFormat),
          })}
        </p>

        <dl className="gameover__grid">
          <div>
            <dt>{t("gameOver.company")}</dt>
            <dd>{game.companyName}</dd>
          </div>
          <div>
            <dt>{t("gameOver.date")}</dt>
            <dd>
              {t("hud.year", { year: date.year })} · {t("hud.month", { month: date.month })} ·{" "}
              {t("hud.day", { day: date.dayOfMonth })} {formatClock(date.hourOfDay)}
            </dd>
          </div>
          <div>
            <dt>{t("gameOver.money")}</dt>
            <dd className="gameover__money">{formatMoney(over?.money ?? game.money, language, numberFormat)}</dd>
          </div>
          <div>
            <dt>{t("gameOver.lastBill")}</dt>
            <dd>
              {lastReport
                ? `${t("econ.monthYear", { month: lastReport.month, year: lastReport.year })} · ${formatMoney(
                    lastReport.net,
                    language,
                    numberFormat,
                  )}`
                : t("gameOver.noBill")}
            </dd>
          </div>
        </dl>

        <p className="panel__hint">{t("gameOver.hint")}</p>
      </div>
    </Modal>
  );
}
