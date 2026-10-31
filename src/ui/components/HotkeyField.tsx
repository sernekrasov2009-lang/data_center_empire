import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { eventToBinding, findConflict, formatBinding, type HotkeyAction, type HotkeyBinding } from "../../state/hotkeys";
import { useGameStore } from "../../state/store";

interface HotkeyFieldProps {
  action: HotkeyAction;
  slot: 0 | 1;
  binding: HotkeyBinding;
  onChange: (binding: HotkeyBinding) => void;
}

/** Кнопка-перехватчик: нажмите, затем нужную комбинацию. Esc — отмена, Delete — очистка. */
export function HotkeyField({ action, slot, binding, onChange }: HotkeyFieldProps): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const hotkeys = useGameStore((state) => state.settings.hotkeys);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;

    const root = document.documentElement;
    root.dataset.hotkeyCapture = "on";

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        setCapturing(false);
        setError(null);
        return;
      }

      if (event.code === "Backspace" || event.code === "Delete") {
        onChange(null);
        setCapturing(false);
        setError(null);
        return;
      }

      const next = eventToBinding(event);
      if (!next) return;

      const conflict = findConflict(hotkeys, action, next);
      if (conflict) {
        setError(t("settings.controls.conflict", { action: t(`hotkeys.action.${conflict.action}`) }));
        return;
      }

      onChange(next);
      setCapturing(false);
      setError(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      delete root.dataset.hotkeyCapture;
    };
  }, [capturing, action, hotkeys, onChange, t]);

  return (
    <div className="hotkey">
      <div className="hotkey__row">
        <button
          type="button"
          className="input hotkey__btn"
          data-capturing={capturing}
          aria-pressed={capturing}
          onClick={() => {
            setError(null);
            setCapturing((value) => !value);
          }}
          title={t("settings.controls.hint")}
        >
          {capturing ? t("settings.controls.press") : formatBinding(binding, language)}
        </button>
        <button
          type="button"
          className="hotkey__clear"
          onClick={() => {
            onChange(null);
            setError(null);
          }}
          disabled={!binding}
          title={t("settings.controls.clear")}
          aria-label={t("settings.controls.clear")}
        >
          ✕
        </button>
      </div>
      <span className="hotkey__slot">
        {slot === 0 ? t("settings.controls.primary") : t("settings.controls.secondary")}
      </span>
      {error && <div className="field__error">{error}</div>}
    </div>
  );
}
