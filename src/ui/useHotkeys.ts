import { useEffect } from "react";
import { useGameStore } from "../state/store";
import type { Speed } from "../sim";

const SPEED_KEYS: Record<string, Speed> = {
  "1": 1,
  "2": 5,
  "3": 20,
  "4": 60,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

/** Горячие клавиши этапа 0: пауза, скорости, оверлей F3. F11 обрабатывает main-процесс. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      const store = useGameStore.getState();

      if (event.code === "Space") {
        event.preventDefault();
        store.togglePause();
        return;
      }

      if (event.key === "F3") {
        event.preventDefault();
        store.toggleDebug();
        return;
      }

      const speed = SPEED_KEYS[event.key];
      if (speed !== undefined) {
        event.preventDefault();
        store.setSpeed(speed);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
