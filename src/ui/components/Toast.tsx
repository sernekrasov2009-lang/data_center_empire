import { useT } from "../../i18n";
import { useGameStore } from "../../state/store";

export function Toast(): React.JSX.Element | null {
  const t = useT();
  const toast = useGameStore((state) => state.toast);
  const dismissToast = useGameStore((state) => state.dismissToast);

  if (!toast) return null;

  return (
    <div className="toast" role="status" data-kind={toast.kind} key={toast.id}>
      <span className="toast__text">{t(toast.key, toast.params)}</span>
      <button type="button" className="toast__close" onClick={dismissToast} aria-label={t("toast.close")}>
        ✕
      </button>
    </div>
  );
}
