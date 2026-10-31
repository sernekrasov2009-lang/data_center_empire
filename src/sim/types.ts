import type { DifficultyId, Speed } from "../data";

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

export type SimEventKind =
  | "dayStarted"
  | "monthClosed"
  | "yearClosed"
  | "billPaid"
  | "electricityPriceChanged"
  | "moneyLow"
  | "bankrupted";

export interface SimEvent {
  id: number;
  kind: SimEventKind;
  /** Игровой час, на котором произошло событие. */
  hour: number;
  /** Сумма или новое значение — смысл зависит от kind. */
  amount?: number;
}

export interface GameStats {
  /** Всего посчитанных тиков — для оверлея F3 и тестов. */
  ticks: number;
}

/** Из чего сложился счёт за месяц. */
export interface ExpenseBreakdown {
  electricity: number;
  internet: number;
  rent: number;
}

/** Отчёт за закрытый месяц. */
export interface MonthlyReport {
  /** Игровой час, на котором выставлен счёт (первый час нового месяца). */
  hour: number;
  year: number;
  /** Номер закрытого месяца, 1–12. */
  month: number;
  revenue: number;
  expenses: ExpenseBreakdown;
  totalExpenses: number;
  /** revenue − totalExpenses. */
  net: number;
  moneyAfter: number;
}

/** Динамическая часть экономики. Ставки и тарифы живут в economy.json. */
export interface EconomyState {
  /** Начисления текущего месяца (электричество копится по часам). */
  accrual: ExpenseBreakdown;
  /** Последние закрытые месяцы, новые в конце. */
  reports: MonthlyReport[];
  /** Итоги за всю игру. */
  lifetime: {
    revenue: number;
    expenses: number;
  };
  /** Множитель цены электричества: дрейфует раз в год в пределах ±20%. */
  electricityPriceMult: number;
  /** Предупреждение о минусе уже показано (чтобы не повторяться). */
  lowMoneyWarned: boolean;
}

export interface GameOverInfo {
  hour: number;
  money: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: RngState;
  time: GameTime;
  money: number;
  companyName: string;
  difficulty: DifficultyId;
  economy: EconomyState;
  /** Заполняется, когда игра закончена (банкротство). */
  gameOver: GameOverInfo | null;
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
  /** 1–12. */
  month: number;
  /** 1–30. */
  dayOfMonth: number;
  /** 0–23. */
  hourOfDay: number;
}
