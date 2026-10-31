import { useEffect } from "react";
import { useGameStore } from "./store";

/**
 * Один requestAnimationFrame-цикл на всё приложение: считает длительность кадра,
 * отдаёт её в симуляцию и раз в полсекунды обновляет FPS в оверлее F3.
 * Лимит FPS из настроек прореживает вызовы симуляции, накопленное время не теряется.
 */
export function useGameLoop(): void {
  const advance = useGameStore((state) => state.advance);
  const setPerf = useGameStore((state) => state.setPerf);
  const fpsLimit = useGameStore((state) => state.settings.video.fpsLimit);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let lastStep = last;
    let pendingMs = 0;
    let frames = 0;
    let windowMs = 0;
    const minStepMs = fpsLimit > 0 ? 1000 / fpsLimit : 0;

    const loop = (now: number) => {
      const delta = Math.max(0, now - last);
      last = now;
      pendingMs += delta;

      if (minStepMs === 0 || now - lastStep >= minStepMs - 0.5) {
        const stepMs = pendingMs;
        pendingMs = 0;
        lastStep = now;
        advance(stepMs);
      }

      frames += 1;
      windowMs += delta;
      if (windowMs >= 500) {
        setPerf({ fps: Math.round((frames * 1000) / windowMs) });
        frames = 0;
        windowMs = 0;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [advance, setPerf, fpsLimit]);
}
