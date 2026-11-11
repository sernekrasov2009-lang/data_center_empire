import { findComponent } from "../../data";
import { useT } from "../../i18n";
import { getGameDate } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatClock, formatMoney, formatMoneyExact } from "../format";

/** Событие «закрыт месяц» приходит в первый час нового месяца, поэтому отступаем на день. */
function closedMonthLabel(eventHour: number): { month: number; year: number } {
  const date = getGameDate(Math.max(0, eventHour - 1));
  return { month: date.month, year: date.year };
}

export function EventFeed(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
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
                  {event.kind === "billPaid" &&
                    t("feed.billPaid", {
                      amount: formatMoney(-(event.amount ?? 0), language, numberFormat),
                    })}
                  {event.kind === "electricityPriceChanged" &&
                    t("feed.tariff", { price: formatMoneyExact(event.amount ?? 0, language) })}
                  {event.kind === "moneyLow" &&
                    t("feed.moneyLow", {
                      money: formatMoney(event.amount ?? 0, language, numberFormat),
                    })}
                  {event.kind === "bankrupted" &&
                    t("feed.bankrupted", {
                      money: formatMoney(event.amount ?? 0, language, numberFormat),
                    })}
                  {event.kind === "orderArrived" &&
                    t("feed.orderArrived", {
                      amount: formatMoney(event.amount ?? 0, language, numberFormat),
                    })}
                  {event.kind === "buildCompleted" &&
                    t("feed.buildCompleted", {
                      amount: formatMoney(event.amount ?? 0, language, numberFormat),
                    })}
                  {event.kind === "partFailed" &&
                    t("feed.partFailed", {
                      part: event.ref ? (findComponent(event.ref)?.name ?? event.ref) : "—",
                    })}
                  {event.kind === "partRepaired" &&
                    t("feed.partRepaired", {
                      part: event.ref ? (findComponent(event.ref)?.name ?? event.ref) : "—",
                    })}
                  {event.kind === "usedMarketUpdated" && t("feed.usedMarketUpdated")}
                  {event.kind === "marketPriceChanged" &&
                    t("feed.marketPriceChanged", { mult: (event.amount ?? 1).toFixed(3) })}
                  {event.kind === "breakerTripped" &&
                    t("feed.breakerTripped", { load: Math.round(event.amount ?? 0) })}
                  {event.kind === "serversShutdown" &&
                    t("feed.serversShutdown", { temp: (event.amount ?? 0).toFixed(1) })}
                  {event.kind === "serversRestarted" && t("feed.serversRestarted")}
                  {event.kind === "noiseComplaint" &&
                    t("feed.noiseComplaint", { db: (event.amount ?? 0).toFixed(1) })}
                  {event.kind === "noiseFine" &&
                    t("feed.noiseFine", {
                      amount: formatMoney(-(event.amount ?? 0), language, numberFormat),
                    })}
                  {event.kind === "neighborsShutdown" && t("feed.neighborsShutdown")}
                  {event.kind === "ticketsOpened" &&
                    t("feed.ticketsOpened", { amount: event.amount ?? 0 })}
                  {event.kind === "ticketsResolved" &&
                    t("feed.ticketsResolved", { amount: event.amount ?? 0 })}
                  {event.kind === "reputationChanged" &&
                    t("feed.reputationChanged", { value: (event.amount ?? 0).toFixed(2) })}
                  {event.kind === "reviewPosted" &&
                    t("feed.reviewPosted", { value: (event.amount ?? 0).toFixed(1) })}
                  {event.kind === "slaMissed" &&
                    t("feed.slaMissed", { ref: event.ref ?? "—", amount: event.amount ?? 0 })}
                  {event.kind === "blackoutStarted" &&
                    t("feed.blackoutStarted", { amount: Math.round(event.amount ?? 0) })}
                  {event.kind === "blackoutEnded" && t("feed.blackoutEnded")}
                  {event.kind === "voltageSpike" &&
                    t("feed.voltageSpike", { ref: event.ref ?? "—" })}
                  {event.kind === "ddosStarted" &&
                    t("feed.ddosStarted", { amount: Math.round(event.amount ?? 0) })}
                  {event.kind === "ddosEnded" && t("feed.ddosEnded")}
                  {event.kind === "channelFailureStarted" &&
                    t("feed.channelFailureStarted", { amount: Math.round(event.amount ?? 0) })}
                  {event.kind === "channelFailureEnded" && t("feed.channelFailureEnded")}
                  {event.kind === "clientHacked" &&
                    t("feed.clientHacked", { amount: (event.amount ?? 0).toFixed(2) })}
                  {event.kind === "electricityPriceSpiked" &&
                    t("feed.electricityPriceSpiked", { amount: Math.round(event.amount ?? 0) })}
                  {event.kind === "locationMoved" && t("feed.locationMoved")}
                  {event.kind === "blackoutPrevented" &&
                    t("feed.blackoutPrevented", { amount: Math.round(event.amount ?? 0) })}
                  {event.kind === "spikePrevented" && t("feed.spikePrevented")}
                  {event.kind === "staffHired" && t("feed.staffHired")}
                  {event.kind === "staffFired" && t("feed.staffFired")}
                  {event.kind === "staffPromoted" &&
                    t("feed.staffPromoted", { amount: Math.round(event.amount ?? 0) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
