import { useEffect } from "react";
import { useT } from "../i18n";
import { useGameLoop } from "../state/useGameLoop";
import { useGameStore } from "../state/store";
import { DebugOverlay } from "./components/DebugOverlay";
import { Toast } from "./components/Toast";
import { ConfirmDialog } from "./overlays/ConfirmDialog";
import { GameOverDialog } from "./overlays/GameOverDialog";
import { NewGameDialog } from "./overlays/NewGameDialog";
import { PauseMenu } from "./overlays/PauseMenu";
import { SettingsDialog } from "./overlays/SettingsDialog";
import { SlotsDialog } from "./overlays/SlotsDialog";
import { GameScreen } from "./screens/GameScreen";
import { MainMenu } from "./screens/MainMenu";
import { useAppearance } from "./useAppearance";
import { useHotkeys } from "./useHotkeys";

function OverlayHost(): React.JSX.Element | null {
  const overlay = useGameStore((state) => state.overlay);

  if (overlay === "newGame") return <NewGameDialog />;
  if (overlay === "slots") return <SlotsDialog />;
  if (overlay === "pause") return <PauseMenu />;
  if (overlay === "settings") return <SettingsDialog />;
  if (overlay === "gameOver") return <GameOverDialog />;
  return null;
}

export function App(): React.JSX.Element {
  const t = useT();
  const boot = useGameStore((state) => state.boot);
  const settingsReady = useGameStore((state) => state.settingsReady);
  const screen = useGameStore((state) => state.screen);
  const debugVisible = useGameStore((state) => state.debugVisible);

  useAppearance();
  useGameLoop();
  useHotkeys();

  useEffect(() => {
    void boot();
  }, [boot]);

  if (!settingsReady) {
    return (
      <div className="boot" role="status">
        <span className="led" aria-hidden="true" />
        {t("boot.loading")}
      </div>
    );
  }

  return (
    <div className="app" data-screen={screen}>
      {screen === "menu" ? <MainMenu /> : <GameScreen />}
      <OverlayHost />
      <ConfirmDialog />
      <Toast />
      {debugVisible && <DebugOverlay />}
    </div>
  );
}
