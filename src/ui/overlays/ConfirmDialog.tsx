import { useT } from "../../i18n";
import { useGameStore } from "../../state/store";

export function ConfirmDialog(): React.JSX.Element | null {
  const t = useT();
  const confirm = useGameStore((state) => state.confirm);
  const resolveConfirm = useGameStore((state) => state.resolveConfirm);

  if (!confirm) return null;

  return (
    <div className="overlay overlay--confirm">
      <div className="modal modal--sm" role="alertdialog" aria-modal="true" aria-label={t(confirm.titleKey)}>
        <header className="modal__head">
          <h2 className="modal__title">{t(confirm.titleKey)}</h2>
        </header>
        <div className="modal__body">
          <p className="confirm__text">{t(confirm.textKey, confirm.params)}</p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn" onClick={() => resolveConfirm(false)} data-testid="confirm-cancel">
            {t("confirm.cancel")}
          </button>
          <button
            type="button"
            className={confirm.danger ? "btn btn--danger" : "btn btn--primary"}
            onClick={() => resolveConfirm(true)}
            data-testid="confirm-ok"
          >
            {confirm.confirmKey ? t(confirm.confirmKey) : t("confirm.ok")}
          </button>
        </footer>
      </div>
    </div>
  );
}
