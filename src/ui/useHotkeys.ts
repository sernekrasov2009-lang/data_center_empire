import { useEffect } from "react";
import { actionForEvent } from "../state/hotkeys";
import { useGameStore } from "../state/store";
import type { Speed } from "../sim";

const SPEED_BY_ACTION: Partial<Record<string, Speed>> = {
  speed1: 1,
  speed2: 5,
  speed3: 20,
  speed4: 60,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

/** Горячие клавиши из настроек: пауза, скорости, сохранения, оверлей, меню паузы. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Поле переназначения клавиши перехватывает ввод целиком.
      if (document.documentElement.dataset.hotkeyCapture === "on") return;

      const state = useGameStore.getState();
      if (!state.settingsReady) return;

      const action = actionForEvent(state.settings.hotkeys, event);
      if (!action) return;

      // Esc: закрывает верхний диалог, иначе открывает меню паузы.
      if (action === "pauseMenu") {
        // Экран банкротства закрыть нельзя — только загрузить сохранение или выйти.
        if (state.overlay === "gameOver") {
          event.preventDefault();
          return;
        }
        if (state.confirm) {
          event.preventDefault();
          state.resolveConfirm(false);
          return;
        }
        if (state.overlay) {
          event.preventDefault();
          if (state.overlay === "pause") state.resume();
          else state.closeOverlay();
          return;
        }
        if (state.screen === "game") {
          event.preventDefault();
          state.openPause();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (action === "debug") {
        event.preventDefault();
        state.toggleDebug();
        return;
      }

      // Остальные действия имеют смысл только в игре и без открытых диалогов.
      if (state.screen !== "game") return;

      if (action === "pause") {
        if (state.overlay) return;
        event.preventDefault();
        state.togglePause();
        return;
      }

      const speed = SPEED_BY_ACTION[action];
      if (speed !== undefined) {
        if (state.overlay) return;
        event.preventDefault();
        state.setSpeed(speed);
        return;
      }

      if (action === "quickSave") {
        event.preventDefault();
        if (state.game.gameOver) return;
        void state.quickSave();
        return;
      }

      if (action === "quickLoad") {
        event.preventDefault();
        void state.quickLoad();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
