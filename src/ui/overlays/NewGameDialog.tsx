import { useState, type FormEvent } from "react";
import { balance, difficulties, getDifficulty, type DifficultyId } from "../../data";
import { useT } from "../../i18n";
import { useGameStore } from "../../state/store";
import { Modal } from "../components/Modal";
import { formatMoney } from "../format";

function randomSeed(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoApi.getRandomValues(buffer);
    return (buffer[0] ?? 0) >>> 0;
  }
  return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
}

export function NewGameDialog(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const closeOverlay = useGameStore((state) => state.closeOverlay);
  const newGame = useGameStore((state) => state.newGame);

  const [difficulty, setDifficulty] = useState<DifficultyId>(difficulties.defaultMode);
  const [companyName, setCompanyName] = useState("");
  const [seedText, setSeedText] = useState(String(balance.start.seed));
  const [error, setError] = useState<string | null>(null);

  const selected = getDifficulty(difficulty);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const seed = Number(seedText.trim() === "" ? balance.start.seed : seedText);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      setError(t("newGame.seedInvalid"));
      return;
    }
    newGame({ difficulty, companyName: companyName.trim(), seed });
  };

  return (
    <Modal
      title={t("newGame.title")}
      subtitle={t("newGame.subtitle")}
      closeLabel={t("settings.close")}
      onClose={closeOverlay}
      size="lg"
      testId="new-game-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={closeOverlay}>
            {t("newGame.cancel")}
          </button>
          <button type="submit" form="new-game-form" className="btn btn--primary">
            {t("newGame.start")}
          </button>
        </>
      }
    >
      <form id="new-game-form" className="newgame" onSubmit={submit}>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">{t("newGame.company")}</span>
            <input
              className="input"
              value={companyName}
              maxLength={40}
              placeholder={t("newGame.companyPlaceholder")}
              onChange={(event) => setCompanyName(event.target.value)}
              autoFocus
            />
            <span className="field__hint">{t("newGame.companyHint")}</span>
          </label>

          <label className="field">
            <span className="field__label">{t("newGame.seed")}</span>
            <span className="field__row">
              <input
                className="input"
                inputMode="numeric"
                value={seedText}
                onChange={(event) => setSeedText(event.target.value)}
              />
              <button type="button" className="btn btn--small" onClick={() => setSeedText(String(randomSeed()))}>
                {t("newGame.randomSeed")}
              </button>
            </span>
            <span className="field__hint">{t("newGame.seedHint")}</span>
          </label>
        </div>

        <div className="field">
          <span className="field__label">{t("newGame.difficulty")}</span>
          <div className="difficulty-grid" role="radiogroup" aria-label={t("newGame.difficulty")}>
            {difficulties.modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className="difficulty"
                data-active={mode.id === difficulty}
                role="radio"
                aria-checked={mode.id === difficulty}
                onClick={() => setDifficulty(mode.id)}
              >
                <span className="difficulty__name">{t(`difficulty.${mode.id}`)}</span>
                <span className="difficulty__money">{formatMoney(mode.startMoney, language, numberFormat)}</span>
                <span className="difficulty__desc">{t(`difficulty.${mode.id}.desc`)}</span>
                <span className="difficulty__stats">
                  {t("newGame.failure")} ×{mode.failureRateMult} · {t("newGame.events")} ×{mode.eventRateMult}
                </span>
                <span className="difficulty__stats">
                  {t("newGame.penalty")} ×{mode.slaPenaltyMult}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="summary">
          <span>
            {t("newGame.startMoney")}: <strong>{formatMoney(selected.startMoney, language, numberFormat)}</strong>
          </span>
          <span>
            {t("newGame.bankruptcy")}: <strong>{t(`newGame.bankruptcy.${selected.bankruptcy}`)}</strong>
          </span>
        </div>

        {error && <div className="field__error">{error}</div>}
      </form>
    </Modal>
  );
}
