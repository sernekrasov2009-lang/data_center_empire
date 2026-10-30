import { useT } from "../../i18n";
import { GAME_SPEEDS, type Speed } from "../../data";
import { useGameStore } from "../../state/store";

const SPEED_LABEL: Record<Exclude<Speed, 0>, string> = {
  1: "speed.x1",
  5: "speed.x5",
  20: "speed.x20",
  60: "speed.x60",
};

interface SpeedControlsProps {
  paused: boolean;
}

export function SpeedControls({ paused }: SpeedControlsProps): React.JSX.Element {
  const t = useT();
  const speed = useGameStore((state) => state.game.time.speed);
  const setSpeed = useGameStore((state) => state.setSpeed);
  const togglePause = useGameStore((state) => state.togglePause);

  return (
    <div className="speeds" role="group" aria-label={t("hud.speed")} title={t("speed.hint")}>
      <button
        type="button"
        className="speed-btn"
        data-active={paused}
        onClick={togglePause}
        aria-pressed={paused}
        title={t("speed.pause")}
      >
        ⏸
      </button>
      {GAME_SPEEDS.map((value) => (
        <button
          key={value}
          type="button"
          className="speed-btn"
          data-active={!paused && speed === value}
          onClick={() => setSpeed(value)}
          aria-pressed={!paused && speed === value}
        >
          {t(SPEED_LABEL[value])}
        </button>
      ))}
    </div>
  );
}
