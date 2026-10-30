import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { platform } from "../../platform";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatInt, formatMs } from "../format";

interface HeapInfo {
  usedJSHeapSize: number;
}

function readHeapMb(): number | null {
  const perf = performance as Performance & { memory?: HeapInfo };
  if (!perf.memory) return null;
  return Math.round((perf.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
}

export function DebugOverlay(): React.JSX.Element {
  const t = useT();
  const game = useGameStore((state) => state.game);
  const perf = useGameStore((state) => state.perf);
  const toggleDebug = useGameStore((state) => state.toggleDebug);
  const [heapMb, setHeapMb] = useState<number | null>(() => readHeapMb());

  useEffect(() => {
    const timer = window.setInterval(() => setHeapMb(readHeapMb()), 2000);
    return () => window.clearInterval(timer);
  }, []);

  const date = getGameDate(game.time.hour);

  return (
    <section className="debug" aria-label={t("debug.title")}>
      <header className="debug__head">
        <span>{t("debug.title")}</span>
        <button type="button" className="ghost-btn ghost-btn--small" onClick={toggleDebug} title={t("debug.close")}>
          F3 ✕
        </button>
      </header>
      <dl className="debug__grid">
        <dt>{t("debug.fps")}</dt>
        <dd>{perf.fps}</dd>

        <dt>{t("debug.tickMs")}</dt>
        <dd>{formatMs(perf.simMsAvg)}</dd>

        <dt>{t("debug.ticksPerSecond")}</dt>
        <dd>{perf.ticksPerSecond.toFixed(1)}</dd>

        <dt>{t("debug.ticks")}</dt>
        <dd>{formatInt(game.stats.ticks, "en")}</dd>

        <dt>{t("debug.hour")}</dt>
        <dd>
          Г{date.year} М{date.month} Д{date.dayOfMonth} {String(date.hourOfDay).padStart(2, "0")}:00
        </dd>

        <dt>{t("debug.speed")}</dt>
        <dd>{game.time.paused ? t("hud.paused") : `×${game.time.speed}`}</dd>

        <dt>{t("debug.seed")}</dt>
        <dd>{game.seed}</dd>

        <dt>{t("debug.groups")}</dt>
        <dd>{t("common.empty")}</dd>

        <dt>{t("debug.pools")}</dt>
        <dd>{t("common.empty")}</dd>

        <dt>{t("debug.memory")}</dt>
        <dd>{heapMb === null ? t("common.empty") : heapMb.toFixed(1)}</dd>

        <dt>{t("debug.build")}</dt>
        <dd>{platform.versions.app}</dd>

        <dt>{t("debug.platform")}</dt>
        <dd>{platform.platform}</dd>

        <dt>{t("debug.renderer")}</dt>
        <dd>
          {platform.versions.electron || "—"} / {platform.versions.chrome || "—"}
        </dd>
      </dl>
    </section>
  );
}
