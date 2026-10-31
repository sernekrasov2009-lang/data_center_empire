import { useT, type Translate } from "../../i18n";
import { getGameDate } from "../../sim";
import { SAVE_SLOTS, type SaveMeta, type SaveSlotId } from "../../save/types";
import { useGameStore } from "../../state/store";
import { Modal } from "../components/Modal";
import { formatClock, formatMoney, formatSavedAt } from "../format";

function slotTitle(slot: SaveSlotId, t: Translate): string {
  if (slot === "autosave") return t("slots.autosave");
  if (slot === "quicksave") return t("slots.quicksave");
  return t("slots.manual", { n: Number(slot.slice("slot".length)) });
}

function slotDate(meta: SaveMeta, t: Translate): string {
  const date = getGameDate(meta.day * 24 + meta.hourOfDay);
  return `${t("hud.year", { year: date.year })} · ${t("hud.month", { month: date.month })} · ${t("hud.day", {
    day: date.dayOfMonth,
  })} ${formatClock(date.hourOfDay)}`;
}

export function SlotsDialog(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const mode = useGameStore((state) => state.slotMode);
  const saves = useGameStore((state) => state.saves);
  const busy = useGameStore((state) => state.savesBusy);
  const screen = useGameStore((state) => state.screen);
  const dirty = useGameStore((state) => state.dirty);
  const closeOverlay = useGameStore((state) => state.closeOverlay);
  const saveSlot = useGameStore((state) => state.saveSlot);
  const loadSlot = useGameStore((state) => state.loadSlot);
  const exportSave = useGameStore((state) => state.exportSave);
  const importSave = useGameStore((state) => state.importSave);
  const requestConfirm = useGameStore((state) => state.requestConfirm);

  const bySlot = new Map(saves.map((meta) => [meta.slot, meta]));

  const doSave = (slot: SaveSlotId) => {
    const meta = bySlot.get(slot);
    if (meta) {
      requestConfirm({
        titleKey: "slots.confirm.overwrite.title",
        textKey: "slots.confirm.overwrite.text",
        params: { slot: slotTitle(slot, t) },
        confirmKey: "slots.save",
        danger: true,
        action: () => {
          void useGameStore.getState().saveSlot(slot);
        },
      });
      return;
    }
    void saveSlot(slot);
  };

  const doLoad = (slot: SaveSlotId) => {
    if (screen === "game" && dirty) {
      requestConfirm({
        titleKey: "slots.confirm.load.title",
        textKey: "slots.confirm.load.text",
        params: { slot: slotTitle(slot, t) },
        confirmKey: "slots.load",
        danger: true,
        action: () => {
          void useGameStore.getState().loadSlot(slot);
        },
      });
      return;
    }
    void loadSlot(slot);
  };

  const doDelete = (slot: SaveSlotId) => {
    requestConfirm({
      titleKey: "slots.confirm.delete.title",
      textKey: "slots.confirm.delete.text",
      params: { slot: slotTitle(slot, t) },
      confirmKey: "slots.delete",
      danger: true,
      action: () => {
        void useGameStore.getState().removeSlot(slot);
      },
    });
  };

  return (
    <Modal
      title={mode === "save" ? t("slots.title.save") : t("slots.title.load")}
      subtitle={t("slots.subtitle")}
      closeLabel={t("slots.close")}
      onClose={closeOverlay}
      size="lg"
      testId="slots-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => void importSave()} disabled={busy}>
            {t("slots.import")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void exportSave()}
            disabled={busy || screen !== "game"}
            title={screen !== "game" ? t("slots.exportHint") : undefined}
          >
            {t("slots.export")}
          </button>
          <button type="button" className="btn btn--primary" onClick={closeOverlay}>
            {t("slots.close")}
          </button>
        </>
      }
    >
      <ul className="slots">
        {SAVE_SLOTS.map((slot) => {
          const meta = bySlot.get(slot);
          const special = slot === "autosave" || slot === "quicksave";
          const canSave = slot !== "autosave";
          return (
            <li key={slot} className="slot" data-empty={!meta} data-special={special}>
              <div className="slot__head">
                <span className="slot__name">{slotTitle(slot, t)}</span>
                {meta && <span className="badge">{t(`difficulty.${meta.difficulty}`)}</span>}
              </div>

              {meta ? (
                <div className="slot__meta">
                  <span className="slot__company">{meta.companyName}</span>
                  <span>{slotDate(meta, t)}</span>
                  <span className="slot__money">{formatMoney(meta.money, language, numberFormat)}</span>
                  <span className="slot__saved">{t("slots.savedAt", { at: formatSavedAt(meta.savedAt, language) })}</span>
                </div>
              ) : (
                <p className="slot__empty">{t("slots.empty")}</p>
              )}

              <div className="slot__actions">
                {mode === "save" && canSave && (
                  <button type="button" className="btn btn--small btn--primary" onClick={() => doSave(slot)} disabled={busy}>
                    {meta ? t("slots.overwrite") : t("slots.save")}
                  </button>
                )}
                {mode === "save" && !canSave && <span className="slot__note">{t("slots.autosaveNote")}</span>}
                {mode === "load" && meta && (
                  <button type="button" className="btn btn--small btn--primary" onClick={() => doLoad(slot)} disabled={busy}>
                    {t("slots.load")}
                  </button>
                )}
                {meta && (
                  <button type="button" className="btn btn--small btn--danger" onClick={() => doDelete(slot)} disabled={busy}>
                    {t("slots.delete")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
