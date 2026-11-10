import type { ComponentCondition, DifficultyId, PowerOffReason, Speed } from "../data";

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
  | "bankrupted"
  | "orderArrived"
  | "buildCompleted"
  | "partFailed"
  | "partRepaired"
  | "usedMarketUpdated"
  | "marketPriceChanged"
  | "breakerTripped"
  | "serversShutdown"
  | "serversRestarted"
  | "noiseComplaint"
  | "noiseFine"
  | "neighborsShutdown";

export interface SimEvent {
  id: number;
  kind: SimEventKind;
  /** Игровой час, на котором произошло событие. */
  hour: number;
  /** Сумма или новое значение — смысл зависит от kind. */
  amount?: number;
  /** Ссылка на объект события: id комплектующей или сборки. */
  ref?: string;
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

/* ── Железо (этап 3) ─────────────────────────────────────────────── */

/** Экземпляр комплектующей на складе. */
export interface PartInstance {
  id: number;
  componentId: string;
  condition: ComponentCondition;
  acquiredHour: number;
  purchasePrice: number;
  /** Заказ, из которого пришла деталь; null — стартовая сборка или подарок. */
  orderId: number | null;
  /** Для б/у: час проявления скрытого дефекта; null — дефекта нет. */
  defectAtHour: number | null;
}

/** Деталь внутри собранного сервера. */
export interface BuildPart {
  componentId: string;
  condition: ComponentCondition;
  purchasePrice: number;
  installedAtHour: number;
  defectAtHour: number | null;
  broken: boolean;
  /** Час окончания ремонта; null — деталь исправна. */
  repairDoneHour: number | null;
}

export type BuildStatus = "assembling" | "ready";

export interface HardwareBuild {
  id: number;
  /** Стартовый домашний ПК — не покупка игрока. */
  starter: boolean;
  status: BuildStatus;
  startedAtHour: number;
  readyAtHour: number;
  parts: BuildPart[];
  /** Слот локации, в котором стоит сервер; null — собран, но не размещён. */
  slot: number | null;
}

export type OrderKind = "new" | "used";
export type OrderStatus = "inTransit" | "delivered" | "cancelled" | "returned";

export interface OrderLine {
  componentId: string;
  quantity: number;
  unitPrice: number;
  condition: ComponentCondition;
}

export interface HardwareOrder {
  id: number;
  kind: OrderKind;
  lines: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
  status: OrderStatus;
  orderedAtHour: number;
  arriveAtHour: number;
  deliveredAtHour: number | null;
  /** Лот б/у рынка, если заказ сделан оттуда. */
  lotId: number | null;
}

export interface UsedLot {
  id: number;
  componentId: string;
  price: number;
  /** Скидка к новой цене, 0…1. */
  discount: number;
  listedAtHour: number;
  expiresAtHour: number;
}

export interface HardwareState {
  /** Запчасти на складе, ещё не установленные в серверы. */
  parts: PartInstance[];
  builds: HardwareBuild[];
  orders: HardwareOrder[];
  usedLots: UsedLot[];
  /** Месячный множитель цен новых деталей, 0,9…1,1. */
  marketPriceMult: number;
  /** Час последнего обновления б/у рынка; −1 — рынок ещё не создавался. */
  lastUsedMarketHour: number;
  nextPartId: number;
  nextBuildId: number;
  nextOrderId: number;
  nextLotId: number;
}

/* ── Локация, охлаждение и соседи (этап 4) ───────────────────────── */

export interface LocationState {
  /** id локации из location.json. */
  id: string;
  coolingId: string;
  /** Купленные варианты охлаждения: переключение между ними бесплатно. */
  ownedCooling: string[];
  internetPlanId: string;
  /** Почему серверы выключены; "none" — всё работает. */
  powerOff: PowerOffReason;
  /** Сколько часов подряд нагрузка превышает ёмкость автомата. */
  overloadHours: number;
  /** Раздражение соседей, 0…100. */
  irritation: number;
  lastComplaintHour: number;
  lastFineHour: number;
  insulated: boolean;
  /** Наружная температура, °C. */
  outsideTempC: number;
  /** Температура в комнате, °C. */
  roomTempC: number;
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
  hardware: HardwareState;
  location: LocationState;
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
