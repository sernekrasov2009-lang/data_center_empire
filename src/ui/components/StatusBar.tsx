import { useT } from "../../i18n";
import { useGameStore } from "../../state/store";
import { formatMs } from "../format";

export function StatusBar(): React.JSX.Element {
  const t = useT();
  const fps = useGameStore((state) => state.perf.fps);
  const simMs = useGameStore((state) => state.perf.simMsAvg);

  return (
    <footer className="statusbar">
      <div className="statusbar__hints">
        <span>{t("status.hint.pause")}</span>
        <span>{t("status.hint.speeds")}</span>
        <span>{t("status.hint.debug")}</span>
        <span>{t("status.hint.fullscreen")}</span>
      </div>
      <div className="statusbar__perf">{t("status.perf", { fps, ms: formatMs(simMs) })}</div>
    </footer>
  );
}
