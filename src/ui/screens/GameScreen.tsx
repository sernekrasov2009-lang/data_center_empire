import { DashboardScreen } from "../components/DashboardScreen";
import { EventFeed } from "../components/EventFeed";
import { NavRail } from "../components/NavRail";
import { StatusBar } from "../components/StatusBar";
import { TopBar } from "../components/TopBar";

export function GameScreen(): React.JSX.Element {
  return (
    <>
      <TopBar />
      <div className="app__body">
        <NavRail />
        <main className="work">
          <DashboardScreen />
        </main>
        <EventFeed />
      </div>
      <StatusBar />
    </>
  );
}
