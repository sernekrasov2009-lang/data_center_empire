import { useT } from "../../i18n";
import { useGameStore, type GameView } from "../../state/store";

interface NavItem {
  key: string;
  ready: boolean;
  view?: GameView;
}

const ITEMS: readonly NavItem[] = [
  { key: "nav.dashboard", ready: true, view: "dashboard" },
  { key: "nav.build", ready: true, view: "build" },
  { key: "nav.warehouse", ready: true, view: "warehouse" },
  { key: "nav.location", ready: true, view: "location" },
  { key: "nav.services", ready: true, view: "services" },
  { key: "nav.infra", ready: false },
  { key: "nav.staff", ready: true, view: "staff" },
  { key: "nav.research", ready: true, view: "research" },
  { key: "nav.market", ready: false },
  { key: "nav.finance", ready: false },
  { key: "nav.journal", ready: false },
  { key: "nav.stats", ready: false },
  { key: "nav.settings", ready: false },
];

export function NavRail(): React.JSX.Element {
  const t = useT();
  const view = useGameStore((state) => state.view);
  const setView = useGameStore((state) => state.setView);

  return (
    <nav className="nav" aria-label={t("nav.title")}>
      <div className="nav__title">{t("nav.title")}</div>
      <ul className="nav__list">
        {ITEMS.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className="nav__item"
              data-active={item.ready && item.view === view}
              disabled={!item.ready}
              title={item.ready ? undefined : t("nav.soon")}
              onClick={() => {
                if (item.view) setView(item.view);
              }}
            >
              <span>{t(item.key)}</span>
              {!item.ready && <span className="nav__badge">{t("nav.soon")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
