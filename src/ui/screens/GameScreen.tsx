import { useGameStore } from "../../state/store";
import { BuildScreen } from "../components/BuildScreen";
import { DashboardScreen } from "../components/DashboardScreen";
import { EventFeed } from "../components/EventFeed";
import { NavRail } from "../components/NavRail";
import { StatusBar } from "../components/StatusBar";
import { TopBar } from "../components/TopBar";
import { WarehouseScreen } from "../components/WarehouseScreen";

export function GameScreen(): React.JSX.Element {
  const view = useGameStore((state) => state.view);

  return (
    <>
      <TopBar />
      <div className="app__body">
        <NavRail />
        <main className="work">
          {view === "build" && <BuildScreen />}
          {view === "warehouse" && <WarehouseScreen />}
          {view === "dashboard" && <DashboardScreen />}
        </main>
        <EventFeed />
      </div>
      <StatusBar />
    </>
  );
}
