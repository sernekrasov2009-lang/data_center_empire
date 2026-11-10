/**
 * Баланс-симулятор (DESIGN.md, разд. 11): игра бот-стратегией без UI.
 * Запуск: npm run balance-sim [-- --seed 1337 --days 720 --csv dist/balance-sim.csv]
 */
import { pathToFileURL, fileURLToPath } from "node:url";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const seed = Number(argValue("seed", 1337));
const days = Number(argValue("days", 720));
const csvPath = argValue("csv", "");

// Загружаем симуляцию из исходников через Vite в режиме SSR,
// чтобы не дублировать логику и не собирать Electron-бандл.
const { createServer } = await import("vite");
const server = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

const simPath = fileURLToPath(new URL("../src/sim/index.ts", import.meta.url));
const simUrl = pathToFileURL(simPath).href;
const sim = await server.ssrLoadModule(simUrl);

try {
  await server.close();
} catch {
  // Сервер уже мог закрыться.
}

const { createGame, advanceTicks, botDay, summarizeDay } = sim;

const state0 = createGame({ seed, difficulty: "normal" });
let state = state0;

const rows = [];
const decisionsLog = [];
const milestones = [
  { name: "firstClient", label: "Первый клиент", day: null },
  { name: "revenue1000", label: "$1000 выручки за месяц", day: null },
  { name: "secondServer", label: "Второй сервер", day: null },
];
let stagnationStart = null;
const stagnations = [];
let lastBlocker = null;

for (let day = 1; day <= days; day += 1) {
  const tick = advanceTicks(state, 24);
  state = tick.state;

  const bot = botDay(state);
  state = bot.state;
  for (const decision of bot.decisions) {
    decisionsLog.push(`день ${day}: ${decision.kind} — ${decision.detail}`);
  }
  if (bot.blocker) lastBlocker = bot.blocker;

  const summary = summarizeDay(state, day);
  rows.push(summary);

  // Вехи.
  if (milestones[0].day === null && state.services.clients.length > 0) milestones[0].day = day;
  const report = state.economy.reports.at(-1);
  if (milestones[1].day === null && report && report.revenue >= 1000) milestones[1].day = day;
  if (milestones[2].day === null && state.hardware.builds.length >= 2) milestones[2].day = day;

  // Застой: 30 дней без решений бота (нет окупаемых покупок).
  const decidedToday = bot.decisions.some(
    (decision) => decision.kind === "orderServer" || decision.kind === "buildServer",
  );
  if (decidedToday) {
    if (stagnationStart !== null) {
      stagnations.push({ from: stagnationStart, to: day - 1 });
      stagnationStart = null;
    }
  } else if (stagnationStart === null && day > 7) {
    stagnationStart = day;
  }

  if (state.gameOver) break;
}

if (stagnationStart !== null) {
  stagnations.push({ from: stagnationStart, to: days });
}

// Сводка.
const last = rows.at(-1) ?? { money: 0, clients: 0, servers: 0 };
const first = rows.at(0) ?? { money: 0, clients: 0, servers: 0 };

console.log("Баланс-симулятор Uptime Empire");
console.log(`seed ${seed}, ${days} дней (${(days / 30).toFixed(1)} мес)`);
console.log("");
console.log("Вехи (DESIGN.md §10.2, доступные в текущей механике):");
for (const milestone of milestones) {
  console.log(
    milestone.day === null
      ? `  — ${milestone.label}: не достигнута`
      : `  ✓ ${milestone.label}: день ${milestone.day}`,
  );
}
console.log("");
console.log("Финал:");
console.log(`  деньги: $${last.money.toFixed(2)}`);
console.log(`  клиенты: ${last.clients}`);
console.log(`  серверы: ${last.servers}`);
console.log(`  банкротство: ${state.gameOver ? "да" : "нет"}`);
console.log("");
console.log("Застои (30+ дней без окупаемых покупок):");
const longStagnations = stagnations.filter((period) => period.to - period.from >= 30);
if (longStagnations.length > 0 && lastBlocker) {
  console.log(`  причина последнего застоя: ${lastBlocker}`);
}
if (longStagnations.length === 0) {
  console.log("  нет");
} else {
  for (const period of longStagnations) {
    console.log(`  дни ${period.from}–${period.to} (${period.to - period.from} дней)`);
  }
}
console.log("");
console.log("Последние решения бота (до 15):");
for (const line of decisionsLog.slice(-15)) {
  console.log(`  ${line}`);
}

if (csvPath) {
  const fs = await import("node:fs");
  const lines = ["day,money,revenue,expenses,clients,servers"];
  for (const row of rows) {
    lines.push(
      [row.day, row.money, row.revenue, row.expenses, row.clients, row.servers].join(","),
    );
  }
  fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
  console.log(`\nCSV: ${csvPath}`);
}
