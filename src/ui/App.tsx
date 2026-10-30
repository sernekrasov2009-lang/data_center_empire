import { DebugOverlay } from "./components/DebugOverlay";
import { DashboardScreen } from "./components/DashboardScreen";
import { EventFeed } from "./components/EventFeed";
import { NavRail } from "./components/NavRail";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useGameLoop } from "../state/useGameLoop";
import { useGameStore } from "../state/store";
import { useHotkeys } from "./useHotkeys";

export function App(): React.JSX.Element {
  useGameLoop();
  useHotkeys();
  const debugVisible = useGameStore((state) => state.debugVisible);

  return (
    <div className="app">
      <TopBar />
      <div className="app__body">
        <NavRail />
        <main className="work">
          <DashboardScreen />
        </main>
        <EventFeed />
      </div>
      <StatusBar />
      {debugVisible && <DebugOverlay />}
    </div>
  );
}
