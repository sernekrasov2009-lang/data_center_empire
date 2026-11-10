import { useMemo } from "react";
import { getComponent, hardware } from "../../data";
import { useT } from "../../i18n";
import { HOURS_PER_DAY } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatMoney } from "../format";

interface StockRow {
  key: string;
  componentId: string;
  condition: "new" | "used";
  quantity: number;
  value: number;
}

export function WarehouseScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const cancelOrder = useGameStore((state) => state.cancelOrder);
  const returnOrder = useGameStore((state) => state.returnOrder);

  const { parts, orders, builds } = game.hardware;
  const hour = game.time.hour;

  const stock = useMemo(() => {
    const map = new Map<string, StockRow>();
    for (const part of parts) {
      const key = `${part.componentId}:${part.condition}`;
      const row = map.get(key) ?? {
        key,
        componentId: part.componentId,
        condition: part.condition,
        quantity: 0,
        value: 0,
      };
      row.quantity += 1;
      row.value += part.purchasePrice;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((left, right) => {
      const leftComponent = getComponent(left.componentId);
      const rightComponent = getComponent(right.componentId);
      return leftComponent.type.localeCompare(rightComponent.type) || leftComponent.name.localeCompare(rightComponent.name);
    });
  }, [parts]);

  const stockValue = parts.reduce((sum, part) => sum + part.purchasePrice, 0);
  const brokenParts = builds.reduce(
    (sum, build) => sum + build.parts.filter((part) => part.broken).length,
    0,
  );
  const sortedOrders = orders.slice().sort((left, right) => right.id - left.id);

  return (
    <div className="warehouse">
      <div className="hardware__head">
        <div>
          <h1 className="hardware__title">{t("warehouse.title")}</h1>
          <p className="hardware__subtitle">{t("warehouse.subtitle")}</p>
        </div>
        <div className="warehouse__summary">
          <span className="badge">{t("warehouse.partsTotal", { count: parts.length })}</span>
          <span className="badge" data-state="ok">
            {t("warehouse.value", { value: formatMoney(stockValue, language, numberFormat) })}
          </span>
        </div>
      </div>

      <div className="warehouse__grid">
        <section className="panel">
          <div className="panel__label">{t("warehouse.stock")}</div>
          {stock.length === 0 ? (
            <p className="panel__hint">{t("warehouse.stockEmpty")}</p>
          ) : (
            <div className="stock-list">
              {stock.map((row) => {
                const component = getComponent(row.componentId);
                return (
                  <div className="stock-row" key={row.key}>
                    <div className="stock-row__name">
                      <strong>{component.name}</strong>
                      <small>
                        {t(`hardware.type.${component.type}`)} ·{" "}
                        {t(`hardware.condition.${row.condition}`)}
                      </small>
                    </div>
                    <div className="stock-row__qty">×{row.quantity}</div>
                    <div className="stock-row__value">
                      {formatMoney(row.value, language, numberFormat)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="panel__hint">{t("warehouse.spareHint")}</p>
        </section>

        <section className="panel">
          <div className="panel__label">{t("warehouse.repairs")}</div>
          <div className="warehouse__repair">
            <span className="warehouse__repair-value" data-state={brokenParts > 0 ? "danger" : "ok"}>
              {brokenParts}
            </span>
            <span>{t("warehouse.brokenParts", { count: brokenParts })}</span>
          </div>
          <p className="panel__hint">{t("warehouse.repairHint")}</p>
        </section>

        <section className="panel panel--wide">
          <div className="panel__label">{t("warehouse.orders")}</div>
          {sortedOrders.length === 0 ? (
            <p className="panel__hint">{t("warehouse.ordersEmpty")}</p>
          ) : (
            <div className="order-list">
              {sortedOrders.map((order) => {
                const canCancel =
                  order.status === "inTransit" &&
                  hour - order.orderedAtHour <= hardware.delivery.cancelHours;
                const canReturn =
                  order.status === "delivered" &&
                  order.deliveredAtHour !== null &&
                  hour - order.deliveredAtHour <= hardware.delivery.returnDays * HOURS_PER_DAY;
                const hoursLeft = Math.max(0, order.arriveAtHour - hour);
                return (
                  <article className="order-row" key={order.id}>
                    <div className="order-row__head">
                      <div>
                        <div className="order-row__title">
                          <span className="order-row__id">#{order.id}</span>{" "}
                          {t(`hardware.orderKind.${order.kind}`)}
                        </div>
                        <div className="order-row__lines">
                          {order.lines.map((line) => (
                            <span key={`${order.id}-${line.componentId}`}>
                              {getComponent(line.componentId).name} ×{line.quantity}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="order-row__money">
                        <span>{formatMoney(order.total, language, numberFormat)}</span>
                        <small>{t(`hardware.orderStatus.${order.status}`)}</small>
                      </div>
                    </div>
                    <div className="order-row__foot">
                      <span className="order-row__meta">
                        {order.status === "inTransit" &&
                          t("warehouse.arrivesIn", { hours: hoursLeft })}
                        {order.status === "delivered" &&
                          t("warehouse.delivered", {
                            day: order.deliveredAtHour === null ? "—" : Math.floor(order.deliveredAtHour / HOURS_PER_DAY) + 1,
                          })}
                        {order.status === "cancelled" && t("warehouse.cancelled")}
                        {order.status === "returned" && t("warehouse.returned")}
                      </span>
                      <span className="order-row__actions">
                        {order.status === "inTransit" && (
                          <button
                            type="button"
                            className="btn btn--small btn--danger"
                            disabled={!canCancel}
                            onClick={() => cancelOrder(order.id)}
                          >
                            {t("warehouse.cancel")}
                          </button>
                        )}
                        {order.status === "delivered" && (
                          <button
                            type="button"
                            className="btn btn--small"
                            disabled={!canReturn}
                            onClick={() => returnOrder(order.id)}
                          >
                            {t("warehouse.return")}
                          </button>
                        )}
                        {order.status === "inTransit" && !canCancel && (
                          <span className="order-row__note">{t("warehouse.cancelExpired")}</span>
                        )}
                        {order.status === "delivered" && !canReturn && (
                          <span className="order-row__note">{t("warehouse.returnExpired")}</span>
                        )}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
