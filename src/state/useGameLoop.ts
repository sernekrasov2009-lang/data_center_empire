import { useEffect } from "react";
import { useGameStore } from "./store";

/**
 * Один requestAnimationFrame-цикл на всё приложение: считает длительность кадра,
 * отдаёт её в симуляцию и раз в полсекунды обновляет FPS в оверлее F3.
 */
export function useGameLoop(): void {
  const advance = useGameStore((state) => state.advance);
  const setPerf = useGameStore((state) => state.setPerf);

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    let frames = 0;
    let windowMs = 0;

    const loop = (now: number) => {
      const delta = Math.max(0, now - last);
      last = now;

      advance(delta);

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
  }, [advance, setPerf]);
}
