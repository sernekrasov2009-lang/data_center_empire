import type {
  ComponentCondition,
  DifficultyId,
  PowerOffReason,
  ServiceId,
  Speed,
  StaffRoleId,
} from "../data";

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
  | "neighborsShutdown"
  | "clientsJoined"
  | "clientsLeft"
  | "ticketsOpened"
  | "ticketsResolved"
  | "reputationChanged"
  | "reviewPosted"
  | "slaMissed"
  | "blackoutStarted"
  | "blackoutEnded"
  | "voltageSpike"
  | "ddosStarted"
  | "ddosEnded"
  | "channelFailureStarted"
  | "channelFailureEnded"
  | "clientHacked"
  | "electricityPriceSpiked"
  | "locationMoved"
  | "upsBought"
  | "stabilizerBought"
  | "blackoutPrevented"
  | "spikePrevented"
  | "staffHired"
  | "staffFired"
  | "staffPromoted";

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
  staff: number;
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
  /** ИБП: держит короткие блэкауты (этап 9). */
  upsOwned: boolean;
  /** Стабилизатор: гасит скачки напряжения (этап 9). */
  stabilizerOwned: boolean;
  /** Час, до которого длится переезд (powerOff = "moving"); null — не переезжаем. */
  movingUntilHour: number | null;
  /** Наружная температура, °C. */
  outsideTempC: number;
  /** Температура в комнате, °C. */
  roomTempC: number;
}

/* ── Услуги и клиенты (этап 5) ────────────────────────────────────── */

/** Выставленные игроком параметры одной услуги. */
export interface ServiceState {
  id: ServiceId;
  /** Цена $/мес; хранится как доля от рыночной (1 = рыночная). */
  priceMult: number;
  enabled: boolean;
  /** 0 — без ограничения. */
  clientLimit: number;
}

/** Один клиент: подписан на услугу и живёт на конкретном сервере. */
export interface ClientState {
  id: number;
  serviceId: ServiceId;
  /** Сборка, на которой размещён клиент. */
  buildId: number;
  /** Игровой час, с которого клиент платит. */
  sinceHour: number;
  /** Фактическая цена $/мес на момент подписки. */
  pricePerMonth: number;
}

export interface ServicesState {
  services: ServiceState[];
  clients: ClientState[];
  /** Выручка, накопленная с начала месяца, $. */
  monthRevenue: number;
  /** Выручка, начисленная за последний полный час, $ (для панели). */
  lastHourRevenue: number;
  nextClientId: number;
  /** Дополнительный месячный отток из-за нарушений SLA, по услугам (этап 7). */
  slaPenalty: Partial<Record<ServiceId, number>>;
}

/* ── Репутация, аптайм и тикеты (этап 7) ──────────────────────────── */

/** Открытый тикет поддержки. */
export interface SupportTicket {
  id: number;
  /** Игровой час поступления. */
  openedHour: number;
  /** id клиента, от которого тикет; null — анонимный (от отказов). */
  clientId: number | null;
}

/** Аптайм за закрытый месяц по одной услуге. */
export interface ServiceUptime {
  serviceId: ServiceId;
  /** Доля часов месяца, когда услуга была доступна клиентам, 0…1. */
  uptime: number;
}

export interface ReputationState {
  /** Текущая репутация R, 0,2…1,5 (DESIGN.md, разд. 6). */
  value: number;
  /** Часы месяца, когда хоть один сервер с клиентами был недоступен. */
  downtimeHours: number;
  /** Часы месяца с плохим качеством: перегрев или выбитый автомат. */
  poorQualityHours: number;
  /** Часы месяца, когда вообще были клиенты (знаменатель аптайма). */
  hoursWithClients: number;
  /** Часы месяца, когда сервисы работали и без перегрева. */
  goodHours: number;
  /** Открытые тикеты поддержки. */
  openTickets: SupportTicket[];
  nextTicketId: number;
  /** Аптайм последнего закрытого месяца, по услугам. */
  lastUptime: ServiceUptime[];
  /** Рейтинг последнего отзыва, 1–5; null — ещё не было. */
  lastReviewRating: number | null;
}

/* ── Случайные события и аварии (этап 8) ───────────────────────────── */

/** Активное временное событие с концом в конкретный час. */
export interface ActiveEventState {
  id: number;
  kind: "blackout" | "ddos" | "channelFailure";
  startedAtHour: number;
  endAtHour: number;
}

export interface WorldEventsState {
  /** Активные события (не больше одного каждого вида). */
  active: ActiveEventState[];
  nextActiveEventId: number;
  /** Временный множитель цены электричества от события «скачок цены», 1 = нет. */
  electricityPriceEventMult: number;
  /** Сколько часов осталось действия множителя цены (0 — неактивен). */
  electricityPriceEventHoursLeft: number;
}

export interface StaffMember {
  /** Уникальный id сотрудника. */
  id: number;
  roleId: StaffRoleId;
  /** Уровень 1–5, растёт со стажем. */
  level: number;
  /** Игровой час найма. */
  hiredAtHour: number;
}

export interface StaffState {
  employees: StaffMember[];
  nextEmployeeId: number;
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
  services: ServicesState;
  reputation: ReputationState;
  world: WorldEventsState;
  staff: StaffState;
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
