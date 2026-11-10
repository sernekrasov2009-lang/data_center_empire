/**
 * Дымовой CDP-тест этапа 4: локация, слоты, охлаждение, интернет, шум.
 * Запуск: dev-режим с UPTIME_DEBUG_PORT=9222, затем `node tools/cdp-stage4.mjs`.
 */

const CDP = "http://127.0.0.1:9222";
let sessionId;
let msgId = 0;
let ws;
const pending = new Map();
const results = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(wsUrl);
    ws.onopen = resolve;
    ws.onerror = reject;
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
  });
}

function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
}

async function evalJs(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`JS error: ${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("Нет открытой страницы");

  await connect(page.webSocketDebuggerUrl);
  const attached = await send("Target.attachToTarget", {
    targetId: page.id,
    flatten: true,
  });
  sessionId = attached.sessionId;

  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await evalJs("window.focus()");
  const state = await evalJs("window.uptime ? 'ready' : 'missing'");
  check("мост window.uptime доступен", state === "ready");

  // Новая игра из главного меню: сначала «Новая игра», затем старт формы.
  await sleep(1500);
  const inMenu = await evalJs("!!document.querySelector('.menu')");
  if (inMenu) {
    await evalJs(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const newGame = buttons.find((b) => /новая игра|new game/i.test(b.textContent));
        if (newGame) newGame.click();
        return true;
      })()
    `);
    await sleep(1500);
    const formText = await evalJs("(document.querySelector('.work') ?? document.body).innerText.slice(0, 1200)");
    console.log("форма новой игры:", /seed|название|сложность/i.test(formText) ? "открыта" : "не найдена");
    await evalJs(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const start = buttons.find((b) => b.textContent.trim() === 'Начать' || b.textContent.trim() === 'Start');
        if (start) start.click();
        return true;
      })()
    `);
    await sleep(2500);
  }

  const playing = await evalJs("!!document.querySelector('.nav')");
  check("игра запущена, навигация видна", playing);
  if (!playing) {
    console.log(await evalJs("document.body.innerText.slice(0, 600)"));
    throw new Error("Не удалось запустить игру");
  }

  // Экран локации.
  await evalJs(`
    (() => {
      const items = Array.from(document.querySelectorAll('.nav button, .nav li, .nav__item'));
      const target = items.find((item) => /Локация|Location/i.test(item.textContent));
      if (target) target.click();
      return true;
    })()
  `);
  await sleep(400);
  let bodyText = await evalJs("document.querySelector('.work').innerText");
  for (let attempt = 0; attempt < 6 && !/Локация и стойки|Location & racks/.test(bodyText); attempt += 1) {
    await sleep(400);
    bodyText = await evalJs("document.querySelector('.work').innerText");
  }
  check("открыт экран «Локация и стойки»", /Локация и стойки|Location & racks/.test(bodyText));

  const workText = await evalJs(
    "(document.querySelector('.work') ?? document.body).innerText",
  );
  const slotsCount = await evalJs("document.querySelectorAll('.loc-slot').length");
  check("два слота размещения", slotsCount === 2, `найдено ${slotsCount}`);
  check("панель питания", /ПИТАНИЕ|POWER/.test(workText));
  check("панель температуры", /ТЕМПЕРАТУРА|TEMPERATURE/.test(workText));
  check("панель шума и соседей", /ШУМ И СОСЕДИ|NOISE/.test(workText));
  check("панель интернета", /ИНТЕРНЕТ|INTERNET/.test(workText));

  // Охлаждение: покупаем вентилятор за $30 (если хватает денег).
  await evalJs(`
    (() => {
      const options = Array.from(document.querySelectorAll('.loc-option'));
      const fan = options.find((o) => /Вентилятор|Fan/.test(o.textContent));
      if (fan) {
        const btn = fan.querySelector('button');
        if (btn && !btn.disabled) btn.click();
      }
      return true;
    })()
  `);
  await sleep(600);
  const fanActive = await evalJs(
    "document.querySelectorAll('.loc-option[data-current=true]').length",
  );
  check("охлаждение активно (вентилятор)", fanActive === 1, `активных: ${fanActive}`);

  // Интернет: переключаем на 300 Мбит.
  await evalJs(`
    (() => {
      const plans = Array.from(document.querySelectorAll('.loc-plan'));
      const target = plans.find((p) => {
        const btn = p.querySelector('button');
        return btn && !btn.disabled && /300\\s*Мбит|300\\s*Mbit/.test(p.textContent);
      });
      if (target) target.querySelector('button').click();
      return true;
    })()
  `);
  await sleep(600);
  const planCurrent = await evalJs(`
    (() => {
      const plans = Array.from(document.querySelectorAll('.loc-plan[data-current=true]'));
      return plans.map((p) => p.textContent.trim()).join('; ');
    })()
  `);
  check("тариф 300 Мбит включён", /300/.test(String(planCurrent)), String(planCurrent));

  // Снятие сервера со слота и возврат в другой слот.
  await evalJs(`
    (() => {
      const slots = Array.from(document.querySelectorAll('.loc-slot'));
      const filled = slots.find((s) => s.dataset.filled === 'true');
      if (filled) {
        const select = filled.querySelector('.select');
        if (select) {
          select.value = '';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return true;
    })()
  `);
  await sleep(800);
  const emptySlots = await evalJs(
    "document.querySelectorAll('.loc-slot[data-filled=false]').length",
  );
  check("сервер снят со слота", emptySlots >= 1, `пустых: ${emptySlots}`);

  await evalJs(`
    (() => {
      const slots = Array.from(document.querySelectorAll('.loc-slot'));
      const empty = slots.find((s) => s.dataset.filled === 'false');
      if (empty) {
        const select = empty.querySelector('.select');
        const option = select ? Array.from(select.options).find((o) => o.value !== '') : null;
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return true;
    })()
  `);
  await sleep(800);
  const filledAfter = await evalJs(
    "document.querySelectorAll('.loc-slot[data-filled=true]').length",
  );
  check("сервер возвращён в слот", filledAfter >= 1, `занятых: ${filledAfter}`);

  // Шумоизоляция: покупаем, если хватает денег.
  await evalJs(`
    (() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((b) => /Шумоизоляц|Soundproof/.test(b.textContent));
      if (target && !target.disabled) target.click();
      return true;
    })()
  `);
  await sleep(600);
  const insulatedBadge = await evalJs(`
    (() => Array.from(document.querySelectorAll('.badge'))
      .some((b) => /Шумоизоляц|Soundproof/.test(b.textContent)))()
  `);
  check("шумоизоляция установлена", insulatedBadge);

  // Дашборд чек-лист этапа 4.
  await evalJs(`
    (() => {
      const btn = Array.from(document.querySelectorAll('.nav button'))
        .find((b) => /Дашборд|Dashboard/i.test(b.textContent));
      if (btn) btn.click();
      return true;
    })()
  `);
  await sleep(500);
  let dashText = await evalJs("(document.querySelector('.work') ?? document.body).innerText");
  for (let attempt = 0; attempt < 6 && !/этап 4|stage 4/i.test(dashText); attempt += 1) {
    await sleep(400);
    dashText = await evalJs("(document.querySelector('.work') ?? document.body).innerText");
  }
  check("дашборд показывает этап 4", /этап 4|stage 4/i.test(dashText));

  ws.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("дымовой тест упал:", error.message);
  process.exit(1);
});
