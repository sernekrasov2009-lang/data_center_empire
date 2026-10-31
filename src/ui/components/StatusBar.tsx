import { useT } from "../../i18n";
import { formatBinding } from "../../state/hotkeys";
import { useGameStore } from "../../state/store";
import { formatMs } from "../format";

export function StatusBar(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const hotkeys = useGameStore((state) => state.settings.hotkeys);
  const fps = useGameStore((state) => state.perf.fps);
  const simMs = useGameStore((state) => state.perf.simMsAvg);

  return (
    <footer className="statusbar">
      <div className="statusbar__hints">
        <span>
          {formatBinding(hotkeys.pause[0], language)} — {t("hotkeys.action.pause")}
        </span>
        <span>
          {formatBinding(hotkeys.speed1[0], language)}–{formatBinding(hotkeys.speed4[0], language)} —{" "}
          {t("hud.speed")}
        </span>
        <span>
          {formatBinding(hotkeys.quickSave[0], language)} / {formatBinding(hotkeys.quickLoad[0], language)} —{" "}
          {t("status.hint.saveLoad")}
        </span>
        <span>
          {formatBinding(hotkeys.debug[0], language)} — {t("status.hint.debug")}
        </span>
        <span>
          {formatBinding(hotkeys.pauseMenu[0], language)} — {t("status.hint.menu")}
        </span>
      </div>
      <div className="statusbar__perf">{t("status.perf", { fps, ms: formatMs(simMs) })}</div>
    </footer>
  );
}
