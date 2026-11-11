import {
  GAME_SPEEDS,
  DIFFICULTY_IDS,
  economy as economyData,
  findComponent,
  getLocationDefinition,
  hardware as hardwareData,
  locationData,
  servicesData,
  type ServiceId,
  type DifficultyId,
  type PowerOffReason,
} from "../data";
import {
  DEFAULT_COMPANY_NAME,
  GAME_STATE_VERSION,
  createEconomy,
  createHardware,
  createLocation,
  createReputation,
  createRng,
  createServices,
  cloneReputation,
  createWorldEvents,
  refreshUsedMarket,
  type ServiceState,
  type ServicesState,
} from "../sim";
import type {
  BuildPart,
  EconomyState,
  ExpenseBreakdown,
  GameState,
  HardwareBuild,
  HardwareOrder,
  HardwareState,
  LocationState,
  MonthlyReport,
  PartInstance,
  ReputationState,
  SimEvent,
  UsedLot,
} from "../sim";
import { SAVE_FORMAT, type SaveEnvelope, type SaveMeta, type SaveSlotId } from "./types";

/** Ошибка чтения сохранения: показывается игроку понятным текстом. */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asDifficulty(value: unknown): DifficultyId {
  return typeof value === "string" && (DIFFICULTY_IDS as readonly string[]).includes(value)
    ? (value as DifficultyId)
    : "normal";
}

const EVENT_KINDS: readonly SimEvent["kind"][] = [
  "dayStarted",
  "monthClosed",
  "yearClosed",
  "billPaid",
  "electricityPriceChanged",
  "moneyLow",
  "bankrupted",
  "orderArrived",
  "buildCompleted",
  "partFailed",
  "partRepaired",
  "usedMarketUpdated",
  "marketPriceChanged",
  "breakerTripped",
  "serversShutdown",
  "serversRestarted",
  "noiseComplaint",
  "noiseFine",
  "neighborsShutdown",
  "clientsJoined",
  "clientsLeft",
];

function asEvents(value: unknown): SimEvent[] {
  if (!Array.isArray(value)) return [];
  const events: SimEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const kind = item.kind;
    if (typeof kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(kind)) continue;
    const event: SimEvent = {
      id: asNumber(item.id, 0),
      kind: kind as SimEvent["kind"],
      hour: Math.max(0, Math.floor(asNumber(item.hour, 0))),
    };
    if (typeof item.amount === "number" && Number.isFinite(item.amount)) event.amount = item.amount;
    if (typeof item.ref === "string" && item.ref) event.ref = item.ref;
    events.push(event);
  }
  return events;
}

function asExpenses(value: unknown): ExpenseBreakdown {
  const source = isRecord(value) ? value : {};
  return {
    electricity: Math.max(0, asNumber(source.electricity, 0)),
    internet: Math.max(0, asNumber(source.internet, 0)),
    rent: Math.max(0, asNumber(source.rent, 0)),
  };
}

function asReport(value: unknown): MonthlyReport | null {
  if (!isRecord(value)) return null;
  const expenses = asExpenses(value.expenses);
  const totalExpenses = Math.max(0, asNumber(value.totalExpenses, expenses.electricity + expenses.internet + expenses.rent));
  const revenue = asNumber(value.revenue, 0);
  return {
    hour: Math.max(0, Math.floor(asNumber(value.hour, 0))),
    year: Math.max(1, Math.floor(asNumber(value.year, 1))),
    month: Math.min(12, Math.max(1, Math.floor(asNumber(value.month, 1)))),
    revenue,
    expenses,
    totalExpenses,
    net: asNumber(value.net, revenue - totalExpenses),
    moneyAfter: asNumber(value.moneyAfter, 0),
  };
}

function asEconomy(value: unknown): EconomyState {
  if (!isRecord(value)) return createEconomy();

  const reports = Array.isArray(value.reports)
    ? value.reports
        .map(asReport)
        .filter((report): report is MonthlyReport => report !== null)
        .slice(-economyData.reports.historySize)
    : [];

  const lifetime = isRecord(value.lifetime) ? value.lifetime : {};
  const { priceMinMult, priceMaxMult } = economyData.electricity;
  const priceMult = asNumber(value.electricityPriceMult, 1);

  return {
    accrual: asExpenses(value.accrual),
    reports,
    lifetime: {
      revenue: asNumber(lifetime.revenue, 0),
      expenses: Math.max(0, asNumber(lifetime.expenses, 0)),
    },
    electricityPriceMult: Math.min(priceMaxMult, Math.max(priceMinMult, priceMult)),
    lowMoneyWarned: value.lowMoneyWarned === true,
  };
}

function asGameOver(value: unknown): GameState["gameOver"] {
  if (!isRecord(value)) return null;
  return {
    hour: Math.max(0, Math.floor(asNumber(value.hour, 0))),
    money: asNumber(value.money, 0),
  };
}

function asOptionalHour(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function asPart(value: unknown): PartInstance | null {
  if (!isRecord(value)) return null;
  const componentId = typeof value.componentId === "string" ? value.componentId : "";
  if (!findComponent(componentId)) return null;
  const id = Math.floor(asNumber(value.id, 0));
  if (id < 1) return null;

  return {
    id,
    componentId,
    condition: value.condition === "used" ? "used" : "new",
    acquiredHour: Math.max(0, Math.floor(asNumber(value.acquiredHour, 0))),
    purchasePrice: Math.max(0, asNumber(value.purchasePrice, 0)),
    orderId:
      typeof value.orderId === "number" && Number.isFinite(value.orderId)
        ? Math.max(1, Math.floor(value.orderId))
        : null,
    defectAtHour: asOptionalHour(value.defectAtHour),
  };
}

function asBuildPart(value: unknown): BuildPart | null {
  if (!isRecord(value)) return null;
  const componentId = typeof value.componentId === "string" ? value.componentId : "";
  if (!findComponent(componentId)) return null;

  return {
    componentId,
    condition: value.condition === "used" ? "used" : "new",
    purchasePrice: Math.max(0, asNumber(value.purchasePrice, 0)),
    installedAtHour: Math.max(0, Math.floor(asNumber(value.installedAtHour, 0))),
    defectAtHour: asOptionalHour(value.defectAtHour),
    broken: value.broken === true,
    repairDoneHour: asOptionalHour(value.repairDoneHour),
  };
}

function asBuild(value: unknown): HardwareBuild | null {
  if (!isRecord(value)) return null;
  const id = Math.floor(asNumber(value.id, 0));
  if (id < 1) return null;
  const parts = Array.isArray(value.parts)
    ? value.parts.map(asBuildPart).filter((part): part is BuildPart => part !== null)
    : [];
  if (parts.length === 0) return null;

  const startedAtHour = Math.max(0, Math.floor(asNumber(value.startedAtHour, 0)));
  const readyAtHour = Math.max(startedAtHour, Math.floor(asNumber(value.readyAtHour, startedAtHour)));
  const status = value.status === "assembling" ? "assembling" : "ready";
  const slot =
    typeof value.slot === "number" && Number.isInteger(value.slot) && value.slot >= 0
      ? value.slot
      : null;
  return {
    id,
    starter: value.starter === true,
    status,
    startedAtHour,
    readyAtHour,
    parts,
    slot,
  };
}

function asOrder(value: unknown): HardwareOrder | null {
  if (!isRecord(value)) return null;
  const id = Math.floor(asNumber(value.id, 0));
  if (id < 1) return null;

  const lines = Array.isArray(value.lines)
    ? value.lines
        .map((line) => {
          if (!isRecord(line)) return null;
          const componentId = typeof line.componentId === "string" ? line.componentId : "";
          if (!findComponent(componentId)) return null;
          const quantity = Math.floor(asNumber(line.quantity, 0));
          if (quantity < 1 || quantity > 99) return null;
          return {
            componentId,
            quantity,
            unitPrice: Math.max(0, asNumber(line.unitPrice, 0)),
            condition: line.condition === "used" ? ("used" as const) : ("new" as const),
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null)
    : [];
  if (lines.length === 0) return null;

  const subtotal = Math.max(
    0,
    asNumber(value.subtotal, lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)),
  );
  const shipping = Math.max(0, asNumber(value.shipping, 0));
  const statuses: readonly HardwareOrder["status"][] = [
    "inTransit",
    "delivered",
    "cancelled",
    "returned",
  ];
  const status = typeof value.status === "string" && (statuses as readonly string[]).includes(value.status)
    ? (value.status as HardwareOrder["status"])
    : "delivered";

  return {
    id,
    kind: value.kind === "used" ? "used" : "new",
    lines,
    subtotal,
    shipping,
    total: Math.max(0, asNumber(value.total, subtotal + shipping)),
    status,
    orderedAtHour: Math.max(0, Math.floor(asNumber(value.orderedAtHour, 0))),
    arriveAtHour: Math.max(0, Math.floor(asNumber(value.arriveAtHour, 0))),
    deliveredAtHour: asOptionalHour(value.deliveredAtHour),
    lotId:
      typeof value.lotId === "number" && Number.isFinite(value.lotId)
        ? Math.max(1, Math.floor(value.lotId))
        : null,
  };
}

function asUsedLot(value: unknown): UsedLot | null {
  if (!isRecord(value)) return null;
  const componentId = typeof value.componentId === "string" ? value.componentId : "";
  if (!findComponent(componentId)) return null;
  const id = Math.floor(asNumber(value.id, 0));
  const price = asNumber(value.price, 0);
  if (id < 1 || price <= 0) return null;

  const listedAtHour = Math.max(0, Math.floor(asNumber(value.listedAtHour, 0)));
  return {
    id,
    componentId,
    price,
    discount: Math.min(1, Math.max(0, asNumber(value.discount, 0))),
    listedAtHour,
    expiresAtHour: Math.max(
      listedAtHour,
      Math.floor(asNumber(value.expiresAtHour, listedAtHour + hardwareData.market.usedLotDays * 24)),
    ),
  };
}

function asHardware(value: unknown): HardwareState {
  if (!isRecord(value)) return createHardware();

  const parts = Array.isArray(value.parts)
    ? value.parts.map(asPart).filter((part): part is PartInstance => part !== null)
    : [];
  const builds = Array.isArray(value.builds)
    ? value.builds.map(asBuild).filter((build): build is HardwareBuild => build !== null)
    : [];
  const orders = Array.isArray(value.orders)
    ? value.orders.map(asOrder).filter((order): order is HardwareOrder => order !== null)
    : [];
  const usedLots = Array.isArray(value.usedLots)
    ? value.usedLots.map(asUsedLot).filter((lot): lot is UsedLot => lot !== null)
    : [];

  if (builds.length === 0 && parts.length === 0 && orders.length === 0) {
    return createHardware();
  }

  const maxPart = parts.reduce((max, part) => Math.max(max, part.id), 0);
  const maxBuild = builds.reduce((max, build) => Math.max(max, build.id), 0);
  const maxOrder = orders.reduce((max, order) => Math.max(max, order.id), 0);
  const maxLot = usedLots.reduce((max, lot) => Math.max(max, lot.id), 0);

  return {
    parts,
    builds,
    orders,
    usedLots,
    marketPriceMult: Math.min(1.5, Math.max(0.5, asNumber(value.marketPriceMult, 1))),
    lastUsedMarketHour: Math.max(-1, Math.floor(asNumber(value.lastUsedMarketHour, -1))),
    nextPartId: Math.max(1, maxPart + 1, Math.floor(asNumber(value.nextPartId, 1))),
    nextBuildId: Math.max(1, maxBuild + 1, Math.floor(asNumber(value.nextBuildId, 1))),
    nextOrderId: Math.max(1, maxOrder + 1, Math.floor(asNumber(value.nextOrderId, 1))),
    nextLotId: Math.max(1, maxLot + 1, Math.floor(asNumber(value.nextLotId, 1))),
  };
}

function asLocation(value: unknown): LocationState {
  const fallback = createLocation();
  if (!isRecord(value)) return fallback;

  const id =
    typeof value.id === "string" && locationData.locations.some((definition) => definition.id === value.id)
      ? value.id
      : fallback.id;
  const definition = getLocationDefinition(id);
  const coolingId =
    typeof value.coolingId === "string" && locationData.cooling.some((option) => option.id === value.coolingId)
      ? value.coolingId
      : definition.defaultCoolingId;

  const owned = Array.isArray(value.ownedCooling)
    ? value.ownedCooling.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && locationData.cooling.some((option) => option.id === candidate),
      )
    : [];
  if (!owned.includes(coolingId)) owned.push(coolingId);

  const internetPlanId =
    typeof value.internetPlanId === "string" && definition.internetPlans.includes(value.internetPlanId)
      ? value.internetPlanId
      : definition.defaultInternetPlanId;

  const offReasons: readonly PowerOffReason[] = [
    "breaker",
    "overheat",
    "neighbors",
    "blackout",
    "channelFailure",
    "moving",
  ];
  const powerOff =
    typeof value.powerOff === "string" && (offReasons as readonly string[]).includes(value.powerOff)
      ? (value.powerOff as PowerOffReason)
      : "none";

  const minGap = locationData.noise.minComplaintGapHours;
  return {
    id,
    coolingId,
    ownedCooling: owned,
    internetPlanId,
    powerOff,
    overloadHours: Math.max(0, Math.floor(asNumber(value.overloadHours, 0))),
    irritation: Math.min(100, Math.max(0, asNumber(value.irritation, 0))),
    lastComplaintHour: Math.max(-minGap, Math.floor(asNumber(value.lastComplaintHour, -minGap))),
    lastFineHour: Math.max(-minGap, Math.floor(asNumber(value.lastFineHour, -minGap))),
    insulated: value.insulated === true,
    upsOwned: value.upsOwned === true,
    stabilizerOwned: value.stabilizerOwned === true,
    movingUntilHour:
      typeof value.movingUntilHour === "number" && Number.isFinite(value.movingUntilHour)
        ? Math.max(0, Math.floor(value.movingUntilHour))
        : null,
    outsideTempC: Math.min(60, Math.max(-40, asNumber(value.outsideTempC, fallback.outsideTempC))),
    roomTempC: Math.min(120, Math.max(-20, asNumber(value.roomTempC, fallback.roomTempC))),
  };
}

/** Санитизация блока услуг: цена и лимит в границах, клиенты с корректными ссылками. */
function asServices(value: unknown, hardware: HardwareState): ServicesState {
  const fallback = createServices();
  if (!isRecord(value)) return fallback;

  const validIds = new Set<string>(servicesData.services.map((service) => service.id));
  const entries = Array.isArray(value.services)
    ? value.services
        .map((item): ServiceState | null => {
          if (!isRecord(item)) return null;
          const id = typeof item.id === "string" && validIds.has(item.id)
            ? (item.id as ServiceState["id"])
            : null;
          if (id === null) return null;
          const priceMult = asNumber(item.priceMult, 1);
          const limit = Math.floor(asNumber(item.clientLimit, 0));
          return {
            id: id as ServiceState["id"],
            priceMult: Math.min(
              servicesData.demand.priceMaxMult,
              Math.max(servicesData.demand.priceMinMult, priceMult),
            ),
            enabled: item.enabled === true,
            clientLimit: Math.min(100000, Math.max(0, limit)),
          };
        })
        .filter((entry): entry is ServiceState => entry !== null)
    : [];

  const services: ServiceState[] = fallback.services.map((base) => {
    const found = entries.find((entry) => entry.id === base.id);
    return found ?? base;
  });

  const buildIds = new Set<number>(hardware.builds.map((build) => build.id));

  const clients = Array.isArray(value.clients)
    ? value.clients
        .map((item) => {
          if (!isRecord(item)) return null;
          const serviceId = typeof item.serviceId === "string" && validIds.has(item.serviceId)
            ? (item.serviceId as ServiceState["id"])
            : null;
          const buildId = Math.floor(asNumber(item.buildId, 0));
          const id = Math.floor(asNumber(item.id, 0));
          if (serviceId === null || !buildIds.has(buildId) || id < 1) return null;
          return {
            id,
            serviceId: serviceId as ServiceId,
            buildId,
            sinceHour: Math.max(0, Math.floor(asNumber(item.sinceHour, 0))),
            pricePerMonth: Math.max(0, asNumber(item.pricePerMonth, 0)),
          };
        })
        .filter((client): client is NonNullable<typeof client> => client !== null)
    : [];

  const maxClientId = clients.reduce((max, client) => Math.max(max, client.id), 0);

  return {
    services,
    clients,
    monthRevenue: Math.max(0, asNumber(value.monthRevenue, 0)),
    lastHourRevenue: Math.max(0, asNumber(value.lastHourRevenue, 0)),
    nextClientId: Math.max(1, maxClientId + 1, Math.floor(asNumber(value.nextClientId, 1))),
    slaPenalty: {},
  };
}

/** Читает блок репутации; повреждённый заменяется стартовым состоянием. */
function asReputation(value: unknown): ReputationState {
  const fallback = createReputation();
  if (!isRecord(value)) return fallback;

  const clamped = Math.min(
    Math.max(asNumber(value.value, fallback.value), 0.05),
    3,
  );
  const openTickets = Array.isArray(value.openTickets)
    ? value.openTickets
        .map((item) => {
          if (!isRecord(item)) return null;
          const id = Math.floor(asNumber(item.id, 0));
          if (id < 1) return null;
          return {
            id,
            openedHour: Math.max(0, Math.floor(asNumber(item.openedHour, 0))),
            clientId:
              typeof item.clientId === "number" && Number.isInteger(item.clientId) && item.clientId > 0
                ? item.clientId
                : null,
          };
        })
        .filter((ticket): ticket is ReputationState["openTickets"][number] => ticket !== null)
        .slice(0, 500)
    : [];

  return {
    ...cloneReputation(fallback),
    value: clamped,
    downtimeHours: Math.max(0, asNumber(value.downtimeHours, 0)),
    poorQualityHours: Math.max(0, asNumber(value.poorQualityHours, 0)),
    hoursWithClients: Math.max(0, asNumber(value.hoursWithClients, 0)),
    goodHours: Math.max(0, asNumber(value.goodHours, 0)),
    openTickets,
    nextTicketId: Math.max(
      1,
      openTickets.reduce((max, ticket) => Math.max(max, ticket.id), 0) + 1,
      Math.floor(asNumber(value.nextTicketId, 1)),
    ),
    lastUptime: [],
    lastReviewRating: null,
  };
}

/**
 * Приводит слоты сборок в согласованный вид: один сервер — один слот,
 * лишние слоты снимаются, готовые серверы автоматически занимают свободные места.
 */
function reconcileSlots(game: GameState): GameState {
  const definition = getLocationDefinition(game.location.id);
  const used = new Set<number>();

  const builds = game.hardware.builds.map((build) => {
    const slot = build.slot;
    if (
      build.status === "ready" &&
      slot !== null &&
      Number.isInteger(slot) &&
      slot >= 0 &&
      slot < definition.slots &&
      !used.has(slot)
    ) {
      used.add(slot);
      return build;
    }
    return slot === null ? build : { ...build, slot: null };
  });

  const ordered = builds
    .slice()
    .sort((left, right) => Number(right.starter) - Number(left.starter) || left.id - right.id);
  const assigned = new Map<number, number>();
  for (const build of ordered) {
    if (build.status !== "ready" || build.slot !== null) continue;
    for (let slot = 0; slot < definition.slots; slot += 1) {
      if (used.has(slot)) continue;
      used.add(slot);
      assigned.set(build.id, slot);
      break;
    }
  }

  if (assigned.size === 0 && builds.every((build, index) => build === game.hardware.builds[index])) {
    return game;
  }

  return {
    ...game,
    hardware: {
      ...game.hardware,
      builds: builds.map((build) =>
        assigned.has(build.id) ? { ...build, slot: assigned.get(build.id) ?? null } : build,
      ),
    },
  };
}

/**
 * Приводит сохранение любой поддерживаемой версии к текущему GameState.
 * Бросает SaveError, если данные не похожи на сохранение игры.
 */
export function migrateGame(raw: unknown): GameState {
  if (!isRecord(raw)) {
    throw new SaveError("Файл сохранения повреждён: ожидался объект.");
  }

  const version = asNumber(raw.version, 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new SaveError("Файл сохранения повреждён: неизвестная версия.");
  }

  const time = isRecord(raw.time) ? raw.time : null;
  if (!time) {
    throw new SaveError("Файл сохранения повреждён: нет игрового времени.");
  }

  const hour = asNumber(time.hour, Number.NaN);
  if (!Number.isFinite(hour) || hour < 0) {
    throw new SaveError("Файл сохранения повреждён: некорректный игровой час.");
  }

  const rawSpeed = asNumber(time.speed, 1);
  const speed = (GAME_SPEEDS as readonly number[]).includes(rawSpeed) ? rawSpeed : 1;
  const rawRng = isRecord(raw.rng) ? raw.rng : null;

  const game: GameState = {
    version: GAME_STATE_VERSION,
    seed: asNumber(raw.seed, 0) >>> 0,
    rng: rawRng
      ? { seed: asNumber(rawRng.seed, 0) >>> 0, s: asNumber(rawRng.s, 0) >>> 0 }
      : createRng(asNumber(raw.seed, 0)),
    time: {
      hour: Math.floor(hour),
      speed: speed as GameState["time"]["speed"],
      paused: time.paused !== false,
    },
    money: asNumber(raw.money, 0),
    companyName: typeof raw.companyName === "string" && raw.companyName.trim() ? raw.companyName : DEFAULT_COMPANY_NAME,
    difficulty: asDifficulty(raw.difficulty),
    economy: asEconomy(raw.economy),
    hardware: asHardware(raw.hardware),
    location: asLocation(raw.location),
    // блок services зависит от сборок, поэтому после hardware
    services: asServices(raw.services, asHardware(raw.hardware)),
    reputation: asReputation(raw.reputation),
    world: createWorldEvents(),
    gameOver: asGameOver(raw.gameOver),
    stats: { ticks: Math.max(0, Math.floor(isRecord(raw.stats) ? asNumber(raw.stats.ticks, 0) : 0)) },
    events: asEvents(raw.events),
    nextEventId: Math.max(1, Math.floor(asNumber(raw.nextEventId, 1))),
  };

  // Миграция 1 → 2: появились название компании и режим сложности.
  if (version < 2) {
    game.difficulty = "normal";
    game.companyName = DEFAULT_COMPANY_NAME;
  }

  // Миграция 3 → 4: появилось железо. Пустой б/у рынок наполняем сразу.
  // Миграция 4 → 5: появилась локация; готовые серверы получают слоты.
  // Миграция 5 → 6: появились услуги и клиенты; пустой блок создаётся с дефолтами.
  // Миграция 6 → 7: появилась репутация/аптайм/тикеты; санитизируется как блок выше.
  // Миграция 7 → 8: появились мировые события; активных при загрузке нет.
  const withSlots = reconcileSlots(game);
  return refreshUsedMarket(withSlots).state;
}

export interface ParsedSave {
  meta: SaveMeta | null;
  game: GameState;
  /** Версия, с которой пришлось мигрировать (если отличается от текущей). */
  migratedFrom: number | null;
}

/** Принимает и конверт, и «голый» GameState (старые сейвы). */
export function parseSave(raw: unknown, fallbackSlot: SaveSlotId = "slot1"): ParsedSave {
  const isEnvelope = isRecord(raw) && raw.format === SAVE_FORMAT && isRecord(raw.game);
  const gameRaw = isEnvelope && isRecord(raw) ? raw.game : raw;

  const game = migrateGame(gameRaw);
  const metaRaw = isEnvelope && isRecord(raw) && isRecord(raw.meta) ? raw.meta : null;
  const meta: SaveMeta | null = metaRaw
    ? {
        slot: (typeof metaRaw.slot === "string" ? metaRaw.slot : fallbackSlot) as SaveSlotId,
        companyName: typeof metaRaw.companyName === "string" ? metaRaw.companyName : game.companyName,
        difficulty: asDifficulty(metaRaw.difficulty),
        day: asNumber(metaRaw.day, 0),
        year: asNumber(metaRaw.year, 1),
        month: asNumber(metaRaw.month, 1),
        dayOfMonth: asNumber(metaRaw.dayOfMonth, 1),
        hourOfDay: asNumber(metaRaw.hourOfDay, 0),
        money: asNumber(metaRaw.money, game.money),
        savedAt: typeof metaRaw.savedAt === "string" ? metaRaw.savedAt : new Date(0).toISOString(),
        saveVersion: asNumber(metaRaw.saveVersion, 1),
        gameVersion: typeof metaRaw.gameVersion === "string" ? metaRaw.gameVersion : "0.0.0",
      }
    : null;

  const migratedFrom = (isRecord(gameRaw) && typeof gameRaw.version === "number" ? gameRaw.version : GAME_STATE_VERSION) <
  GAME_STATE_VERSION
    ? asNumber(isRecord(gameRaw) ? gameRaw.version : 1, 1)
    : null;

  return { meta, game, migratedFrom };
}

export function buildEnvelope(meta: SaveMeta, game: GameState): SaveEnvelope {
  return { format: SAVE_FORMAT, version: GAME_STATE_VERSION, meta, game };
}
