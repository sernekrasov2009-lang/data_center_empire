import { execSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

try {
  execSync("npm run build:electron", { cwd: root, stdio: "inherit" });
} catch {
  console.error("[dev] Не удалось собрать main-процесс Electron.");
  process.exit(1);
}

const server = await createServer({ root });
await server.listen();

const localUrls = server.resolvedUrls?.local ?? [];
const url = localUrls.find((candidate) => candidate.includes("127.0.0.1")) ?? localUrls[0] ?? "http://127.0.0.1:5173/";

// Ждём, пока сервер реально начнёт отвечать: иначе окно поймает ERR_CONNECTION_REFUSED.
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok || response.status < 500) break;
  } catch {
    // ещё не готов
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

console.log(`[dev] Интерфейс: ${url}`);

const electronPath = (await import("electron")).default;
const electronArgs = ["."];
if (process.env.UPTIME_DEBUG_PORT) {
  electronArgs.push(`--remote-debugging-port=${process.env.UPTIME_DEBUG_PORT}`);
}
const child = spawn(electronPath, electronArgs, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

let shuttingDown = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server.close();
  } catch {
    // Сервер мог уже закрыться.
  }
  process.exit(typeof code === "number" ? code : 0);
}

child.on("close", (code) => {
  void shutdown(code);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill();
  });
}
