import { useState, type ReactNode } from "react";
import type { Speed } from "../../data";
import { useT } from "../../i18n";
import type { Language } from "../../i18n/language";
import { HOTKEY_ACTIONS } from "../../state/hotkeys";
import type {
  AnimationsMode,
  AutosaveMode,
  HintsMode,
  NumberFormat,
  WindowMode,
} from "../../state/settings";
import { useGameStore } from "../../state/store";
import { HotkeyField } from "../components/HotkeyField";
import { Modal } from "../components/Modal";

type SettingsTab = "game" | "video" | "audio" | "controls" | "accessibility";

const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "game", label: "settings.tab.game" },
  { id: "video", label: "settings.tab.video" },
  { id: "audio", label: "settings.tab.audio" },
  { id: "controls", label: "settings.tab.controls" },
  { id: "accessibility", label: "settings.tab.accessibility" },
];

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <div className={wide ? "field field--wide" : "field"}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__box" aria-hidden="true" />
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="field slider">
      <span className="field__label">
        {label}
        <span className="field__value">
          {value}
          {suffix ?? ""}
        </span>
      </span>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function SettingsDialog(): React.JSX.Element {
  const t = useT();
  const settings = useGameStore((state) => state.settings);
  const monitors = useGameStore((state) => state.monitors);
  const closeOverlay = useGameStore((state) => state.closeOverlay);
  const updateSettings = useGameStore((state) => state.updateSettings);
  const resetSection = useGameStore((state) => state.resetSection);
  const resetHotkeys = useGameStore((state) => state.resetHotkeys);
  const setHotkey = useGameStore((state) => state.setHotkey);

  const [tab, setTab] = useState<SettingsTab>("game");

  const resetCurrent = () => {
    if (tab === "controls") resetHotkeys();
    else resetSection(tab);
  };

  return (
    <Modal
      title={t("settings.title")}
      subtitle={t("settings.subtitle")}
      closeLabel={t("settings.close")}
      onClose={closeOverlay}
      size="lg"
      testId="settings-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={resetCurrent}>
            {t("settings.resetSection")}
          </button>
          <button type="button" className="btn btn--primary" onClick={closeOverlay}>
            {t("settings.close")}
          </button>
        </>
      }
    >
      <div className="settings">
        <div className="tabs" role="tablist" aria-label={t("settings.title")}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="tab"
              data-active={tab === item.id}
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              data-testid={`settings-tab-${item.id}`}
            >
              {t(item.label)}
            </button>
          ))}
        </div>

        <div className="settings__pane" role="tabpanel">
          {tab === "game" && (
            <div className="form-grid">
              <Field label={t("settings.game.language")}>
                <select
                  className="select"
                  value={settings.game.language}
                  onChange={(event) => updateSettings("game", { language: event.target.value as Language })}
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </Field>

              <Field label={t("settings.game.defaultSpeed")}>
                <select
                  className="select"
                  value={settings.game.defaultSpeed}
                  onChange={(event) =>
                    updateSettings("game", { defaultSpeed: Number(event.target.value) as Exclude<Speed, 0> })
                  }
                >
                  <option value={1}>×1</option>
                  <option value={5}>×5</option>
                  <option value={20}>×20</option>
                  <option value={60}>×60</option>
                </select>
              </Field>

              <Field label={t("settings.game.autosave")}>
                <select
                  className="select"
                  value={settings.game.autosave}
                  onChange={(event) => updateSettings("game", { autosave: event.target.value as AutosaveMode })}
                >
                  <option value="never">{t("settings.game.autosave.never")}</option>
                  <option value="month">{t("settings.game.autosave.month")}</option>
                  <option value="5min">{t("settings.game.autosave.5min")}</option>
                </select>
              </Field>

              <Field label={t("settings.game.numberFormat")}>
                <select
                  className="select"
                  value={settings.game.numberFormat}
                  onChange={(event) => updateSettings("game", { numberFormat: event.target.value as NumberFormat })}
                >
                  <option value="short">{t("settings.game.numberFormat.short")}</option>
                  <option value="full">{t("settings.game.numberFormat.full")}</option>
                </select>
              </Field>

              <Field label={t("settings.game.hints")}>
                <select
                  className="select"
                  value={settings.game.hints}
                  onChange={(event) => updateSettings("game", { hints: event.target.value as HintsMode })}
                >
                  <option value="all">{t("settings.game.hints.all")}</option>
                  <option value="important">{t("settings.game.hints.important")}</option>
                  <option value="off">{t("settings.game.hints.off")}</option>
                </select>
              </Field>

              <div className="field field--wide toggle-list">
                <Toggle
                  label={t("settings.game.autosaveOnCritical")}
                  hint={t("settings.game.autosaveOnCritical.hint")}
                  checked={settings.game.autosaveOnCritical}
                  onChange={(checked) => updateSettings("game", { autosaveOnCritical: checked })}
                />
                <Toggle
                  label={t("settings.game.confirmExpensive")}
                  checked={settings.game.confirmExpensive}
                  onChange={(checked) => updateSettings("game", { confirmExpensive: checked })}
                />
                <Toggle
                  label={t("settings.game.confirmDangerous")}
                  checked={settings.game.confirmDangerous}
                  onChange={(checked) => updateSettings("game", { confirmDangerous: checked })}
                />
              </div>
            </div>
          )}

          {tab === "video" && (
            <div className="form-grid">
              <Field label={t("settings.video.mode")} hint={t("settings.video.mode.hint")}>
                <select
                  className="select"
                  value={settings.video.mode}
                  onChange={(event) => updateSettings("video", { mode: event.target.value as WindowMode })}
                >
                  <option value="window">{t("settings.video.mode.window")}</option>
                  <option value="borderless">{t("settings.video.mode.borderless")}</option>
                  <option value="fullscreen">{t("settings.video.mode.fullscreen")}</option>
                </select>
              </Field>

              <Field label={t("settings.video.monitor")}>
                <select
                  className="select"
                  value={settings.video.monitor}
                  onChange={(event) => updateSettings("video", { monitor: Number(event.target.value) })}
                >
                  {monitors.map((monitor) => (
                    <option key={monitor.index} value={monitor.index}>
                      {monitor.label} · {monitor.width}×{monitor.height}
                      {monitor.primary ? ` (${t("settings.video.monitor.primary")})` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("settings.video.fpsLimit")}>
                <select
                  className="select"
                  value={settings.video.fpsLimit}
                  onChange={(event) =>
                    updateSettings("video", { fpsLimit: Number(event.target.value) as 30 | 60 | 120 | 0 })
                  }
                >
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                  <option value={120}>120</option>
                  <option value={0}>{t("settings.video.fpsLimit.unlimited")}</option>
                </select>
              </Field>

              <Field label={t("settings.video.animations")}>
                <select
                  className="select"
                  value={settings.video.animations}
                  onChange={(event) => updateSettings("video", { animations: event.target.value as AnimationsMode })}
                >
                  <option value="on">{t("settings.video.animations.on")}</option>
                  <option value="reduced">{t("settings.video.animations.reduced")}</option>
                  <option value="off">{t("settings.video.animations.off")}</option>
                </select>
              </Field>

              <div className="field field--wide toggle-list">
                <Toggle
                  label={t("settings.video.vsync")}
                  hint={t("settings.video.vsync.hint")}
                  checked={settings.video.vsync}
                  onChange={(checked) => updateSettings("video", { vsync: checked })}
                />
              </div>

              <Slider
                label={t("settings.video.uiScale")}
                value={settings.video.uiScale}
                min={75}
                max={200}
                step={5}
                suffix="%"
                onChange={(value) => updateSettings("video", { uiScale: value })}
              />
              <Slider
                label={t("settings.video.fontScale")}
                value={settings.video.fontScale}
                min={85}
                max={150}
                step={5}
                suffix="%"
                onChange={(value) => updateSettings("video", { fontScale: value })}
              />
            </div>
          )}

          {tab === "audio" && (
            <div className="form-grid">
              <Slider
                label={t("settings.audio.master")}
                value={settings.audio.master}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(value) => updateSettings("audio", { master: value })}
              />
              <Slider
                label={t("settings.audio.effects")}
                value={settings.audio.effects}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(value) => updateSettings("audio", { effects: value })}
              />
              <Slider
                label={t("settings.audio.hum")}
                value={settings.audio.hum}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(value) => updateSettings("audio", { hum: value })}
              />
              <Slider
                label={t("settings.audio.alarms")}
                value={settings.audio.alarms}
                min={0}
                max={100}
                step={5}
                suffix="%"
                onChange={(value) => updateSettings("audio", { alarms: value })}
              />
              <div className="field field--wide toggle-list">
                <Toggle
                  label={t("settings.audio.muteOnBlur")}
                  checked={settings.audio.muteOnBlur}
                  onChange={(checked) => updateSettings("audio", { muteOnBlur: checked })}
                />
                <p className="field__hint">{t("settings.audio.note")}</p>
              </div>
            </div>
          )}

          {tab === "controls" && (
            <div className="controls">
              <p className="field__hint">{t("settings.controls.hint")}</p>
              {HOTKEY_ACTIONS.map((action) => (
                <div key={action} className="controls__row">
                  <span className="controls__name">{t(`hotkeys.action.${action}`)}</span>
                  <HotkeyField
                    action={action}
                    slot={0}
                    binding={settings.hotkeys[action][0]}
                    onChange={(binding) => setHotkey(action, 0, binding)}
                  />
                  <HotkeyField
                    action={action}
                    slot={1}
                    binding={settings.hotkeys[action][1]}
                    onChange={(binding) => setHotkey(action, 1, binding)}
                  />
                </div>
              ))}
            </div>
          )}

          {tab === "accessibility" && (
            <div className="form-grid">
              <div className="field field--wide toggle-list">
                <Toggle
                  label={t("settings.accessibility.colorblind")}
                  hint={t("settings.accessibility.colorblind.hint")}
                  checked={settings.accessibility.colorblind}
                  onChange={(checked) => updateSettings("accessibility", { colorblind: checked })}
                />
                <Toggle
                  label={t("settings.accessibility.highContrast")}
                  hint={t("settings.accessibility.highContrast.hint")}
                  checked={settings.accessibility.highContrast}
                  onChange={(checked) => updateSettings("accessibility", { highContrast: checked })}
                />
                <Toggle
                  label={t("settings.accessibility.visualAlarms")}
                  hint={t("settings.accessibility.visualAlarms.hint")}
                  checked={settings.accessibility.visualAlarms}
                  onChange={(checked) => updateSettings("accessibility", { visualAlarms: checked })}
                />
              </div>

              <Field label={t("settings.accessibility.largeFont")} hint={t("settings.accessibility.largeFont.hint")}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => updateSettings("video", { fontScale: settings.video.fontScale >= 125 ? 100 : 125 })}
                >
                  {settings.video.fontScale >= 125
                    ? t("settings.accessibility.largeFont.disable")
                    : t("settings.accessibility.largeFont.enable")}
                </button>
              </Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
