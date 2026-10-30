import type { Speed } from "../data";

export type { Speed };

/** Состояние генератора случайных чисел. Сериализуется в сохранение как есть. */
export interface RngState {
  seed: number;
  s: number;
}

export interface GameTime {
  /** Сколько игровых часов прошло с начала игры. Тик = 1 час. */
  hour: number;
  speed: Speed;
  paused: boolean;
}

export type SimEventKind = "dayStarted" | "monthClosed" | "yearClosed";

export interface SimEvent {
  id: number;
  kind: SimEventKind;
  /** Игровой час, на котором произошло событие. */
  hour: number;
}

export interface GameStats {
  /** Всего посчитанных тиков — для оверлея F3 и тестов. */
  ticks: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: RngState;
  time: GameTime;
  money: number;
  stats: GameStats;
  /** Кольцевой буфер последних событий (новые в конце). */
  events: SimEvent[];
  nextEventId: number;
}

/** Игровая дата, производная от общего числа часов. */
export interface GameDate {
  totalHours: number;
  totalDays: number;
  year: number;
  month: number;
  dayOfMonth: number;
  hourOfDay: number;
}
