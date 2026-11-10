/**
 * Дымовой CDP-тест этапа 5: услуги и клиенты.
 * Запуск: dev-режим с UPTIME_DEBUG_PORT=9222, затем `node tools/cdp-stage5.mjs`.
 * Правила из этапа 4: не вызывать Page.reload, текст читать из .work,
 * кликать по .nav button, после клика ждать и ретраить.
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

/** Ждёт, пока текст .work удовлетворит предикат. */
async function waitForText(predicate, attempts = 8, stepMs = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const text = await evalJs("(document.querySelector('.work') ?? document.body).innerText");
    if (predicate(text)) return text;
    await sleep(stepMs);
  }
  return null;
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
  check("мост window.uptime доступен", (await evalJs("window.uptime ? 'ready' : 'missing'")) === "ready");

  // Новая игра из главного меню: сначала «Новая игра», затем «Начать».
  await sleep(1500);
  const inMenu = await evalJs("!!document.querySelector('.menu')");
  if (inMenu) {
    await evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => /новая игра|new game/i.test(b.textContent));
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(1500);
    await evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent.trim() === 'Начать' || b.textContent.trim() === 'Start');
      if (btn) btn.click();
      return true;
    })()`);
    await sleep(2500);
  }
  check("игра запущена, навигация видна", (await evalJs("!!document.querySelector('.nav')")) === true);

  // Экран услуг.
  await evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('.nav button'))
      .find((b) => /Услуги и клиенты|Services/i.test(b.textContent));
    if (btn) btn.click();
    return true;
  })()`);
  const servicesText = await waitForText((text) => /Услуги и клиенты|Services & clients/i.test(text));
  check("открыт экран «Услуги и клиенты»", servicesText !== null);

  const panels = await evalJs("document.querySelectorAll('.services .panel').length");
  check("три карточки услуг и панель загрузки", panels >= 4, `панелей: ${panels}`);

  const hasLanding = /Сайт-визитка|Landing site/i.test(servicesText ?? "");
  const hasCms = /Сайт на CMS|CMS website/i.test(servicesText ?? "");
  const hasChatbot = /чат-бот|Chatbot/i.test(servicesText ?? "");
  check("карточка сайт-визитки", hasLanding);
  check("карточка CMS", hasCms);
  check("карточка чат-ботов", hasChatbot);

  // Включаем первую услугу.
  const enableResult = await evalJs(`(() => {
    const buttons = Array.from(document.querySelectorAll('.services .panel button'))
      .filter((b) => /Включить|Enable/i.test(b.textContent) && !b.disabled);
    if (buttons.length === 0) return 'no-button';
    buttons[0].click();
    return 'clicked';
  })()`);
  await sleep(700);
  const enabledBadge = await evalJs(
    "Array.from(document.querySelectorAll('.services .panel .btn')).filter((b) => /Выключить|Disable/i.test(b.textContent)).length",
  );
  check("услуга включена (кнопка сменилась на «Выключить»)", enableResult === "clicked" && enabledBadge >= 1,
    `disable-кнопок: ${enabledBadge}`);

  // Слайдер цены: двигаем на 0,5 (минимум).
  const sliderSet = await evalJs(`(() => {
    const slider = document.querySelector('.svc-slider');
    if (!slider) return 'no-slider';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(slider, String(slider.min));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return 'set';
  })()`);
  await sleep(500);
  const sliderValue2 = await evalJs(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const slider of Array.from(document.querySelectorAll('.svc-slider'))) {
      setter.call(slider, String(slider.min));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const value = document.querySelector('.svc-slider__value');
    return value ? value.textContent : 'none';
  })()`);
  await sleep(700);
  const sliderValue = await evalJs("document.querySelector('.svc-slider') ? document.querySelector('.svc-slider__value').textContent : 'none'");
  check("цена двигается слайдером (50%)", sliderSet === "set" && sliderValue.includes("50%"), sliderValue);
  // Лимит клиентов.
  const limitSet = await evalJs(`(() => {
    const input = document.querySelector('.svc-input');
    if (!input) return 'no-input';
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`);
  check("лимит клиентов редактируется", limitSet === "set", limitSet);

  // Ускоряем время: ×60 на сутки — ждём клиентов.
  await evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === '×60');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(300);
  await evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === '⏸' || /пауза|pause/i.test(b.textContent));
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(300);
  await evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === '⏸' || /пауза|pause/i.test(b.textContent));
    if (btn) btn.click();
    return true;
  })()`);
  // ~24 игровых часов на ×60 = 24 реальных секунды.
  const clientText = await waitForText(
    (text) => /Клиентов: [1-9]/i.test(text),
    20,
    1500,
  );
  check("клиенты приходят при включённой услуге", clientText !== null);

  // Дашборд: счёт с выручкой.
  await evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('.nav button'))
      .find((b) => /Дашборд|Dashboard/i.test(b.textContent));
    if (btn) btn.click();
    return true;
  })()`);
  const dashText = await waitForText((text) => /СЧЁТ ЗА МЕСЯЦ|MONTHLY BILL/i.test(text));
  check("дашборд открыт и показывает счёт", dashText !== null);
  const hasRevenue = /Доход|Income|Выручка/i.test(dashText ?? "");
  check("в счёте отражается доход", hasRevenue);

  ws.close();
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("дымовой тест упал:", error.message);
  process.exit(1);
});
