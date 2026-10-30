import { useT } from "../../i18n";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatClock } from "../format";

/** Событие «закрыт месяц» приходит в первый час нового месяца, поэтому отступаем на день. */
function closedMonthLabel(eventHour: number): { month: number; year: number } {
  const date = getGameDate(Math.max(0, eventHour - 1));
  return { month: date.month, year: date.year };
}

export function EventFeed(): React.JSX.Element {
  const t = useT();
  const events = useGameStore((state) => state.events);

  return (
    <aside className="feed" aria-label={t("feed.title")}>
      <div className="feed__title">{t("feed.title")}</div>
      {events.length === 0 ? (
        <p className="feed__empty">{t("feed.empty")}</p>
      ) : (
        <ul className="feed__list">
          {events.map((event) => {
            const date = getGameDate(event.hour);
            const closed = closedMonthLabel(event.hour);
            return (
              <li key={event.id} className="feed__item" data-kind={event.kind}>
                <span className="feed__time">
                  {t("hud.day", { day: date.dayOfMonth })} {formatClock(date.hourOfDay)}
                </span>
                <span className="feed__text">
                  {event.kind === "dayStarted" && t("feed.dayStarted", { day: date.totalDays + 1 })}
                  {event.kind === "monthClosed" && t("feed.monthClosed", { month: closed.month, year: closed.year })}
                  {event.kind === "yearClosed" && t("feed.yearClosed", { year: closed.year })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
