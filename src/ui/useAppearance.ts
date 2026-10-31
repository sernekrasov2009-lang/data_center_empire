import { useEffect } from "react";
import { useGameStore } from "../state/store";

/**
 * Применяет настройки оформления к корню документа: масштаб, шрифт,
 * анимации, палитру для дальтоников и высокий контраст.
 * Цвета и размеры меняются CSS-переменными, поэтому перерисовка React не нужна.
 */
export function useAppearance(): void {
  const uiScale = useGameStore((state) => state.settings.video.uiScale);
  const fontScale = useGameStore((state) => state.settings.video.fontScale);
  const animations = useGameStore((state) => state.settings.video.animations);
  const colorblind = useGameStore((state) => state.settings.accessibility.colorblind);
  const highContrast = useGameStore((state) => state.settings.accessibility.highContrast);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ui-scale", String(uiScale / 100));
    root.style.setProperty("--ui-inverse", `${10000 / uiScale}%`);
    root.style.setProperty("--font-size", `${((14 * fontScale) / 100).toFixed(2)}px`);
    root.dataset.animations = animations;
    root.dataset.colorblind = colorblind ? "on" : "off";
    root.dataset.contrast = highContrast ? "high" : "normal";
  }, [uiScale, fontScale, animations, colorblind, highContrast]);
}
