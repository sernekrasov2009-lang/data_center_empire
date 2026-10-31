import { describe, expect, it } from "vitest";
import { createDefaultSettings, defaultSection, mergeSettings, SETTINGS_VERSION } from "../src/state/settings";

describe("настройки", () => {
  it("создаёт полный набор значений по умолчанию", () => {
    const settings = createDefaultSettings();
    expect(settings.version).toBe(SETTINGS_VERSION);
    expect(settings.game.language).toBe("ru");
    expect(settings.game.defaultSpeed).toBe(1);
    expect(settings.game.autosave).toBe("month");
    expect(settings.video.mode).toBe("window");
    expect(settings.video.fpsLimit).toBe(60);
    expect(settings.video.uiScale).toBe(100);
    expect(settings.audio.master).toBe(60);
    expect(settings.hotkeys.pause[0]).toBe("Space");
    expect(settings.window.width).toBeGreaterThanOrEqual(1280);
  });

  it("возвращает значения по умолчанию для пустого файла", () => {
    expect(mergeSettings(null).settings).toEqual(createDefaultSettings());
  });

  it("дополняет частичный файл и сохраняет корректные значения", () => {
    const { settings, issues } = mergeSettings({
      game: { language: "en", defaultSpeed: 20, autosave: "5min" },
      video: { uiScale: 125, fpsLimit: 120 },
      audio: { master: 35 },
    });

    expect(settings.game.language).toBe("en");
    expect(settings.game.defaultSpeed).toBe(20);
    expect(settings.game.autosave).toBe("5min");
    expect(settings.video.uiScale).toBe(125);
    expect(settings.video.fpsLimit).toBe(120);
    expect(settings.audio.master).toBe(35);
    // Не заданные поля берутся из умолчаний.
    expect(settings.game.numberFormat).toBe("short");
    expect(issues).toEqual([]);
  });

  it("обрезает числа в допустимый диапазон", () => {
    const { settings } = mergeSettings({
      video: { uiScale: 999, fontScale: 1, monitor: 99 },
      audio: { master: -10, effects: 400 },
    });
    expect(settings.video.uiScale).toBe(200);
    expect(settings.video.fontScale).toBe(85);
    expect(settings.video.monitor).toBe(15);
    expect(settings.audio.master).toBe(0);
    expect(settings.audio.effects).toBe(100);
  });

  it("заменяет неизвестные значения на умолчания", () => {
    const { settings } = mergeSettings({
      game: { language: "de", defaultSpeed: 2, autosave: "hourly", numberFormat: "scientific", hints: "some" },
      video: { mode: "maximized", fpsLimit: 45, animations: "cinematic" },
      accessibility: { colorblind: "yes" },
    });

    expect(settings.game.language).toBe("ru");
    expect(settings.game.defaultSpeed).toBe(1);
    expect(settings.game.autosave).toBe("month");
    expect(settings.game.numberFormat).toBe("short");
    expect(settings.game.hints).toBe("all");
    expect(settings.video.mode).toBe("window");
    expect(settings.video.fpsLimit).toBe(60);
    expect(settings.video.animations).toBe("on");
    expect(settings.accessibility.colorblind).toBe(false);
  });

  it("принимает лимит FPS «без ограничения»", () => {
    const { settings } = mergeSettings({ video: { fpsLimit: 0 } });
    expect(settings.video.fpsLimit).toBe(0);
  });

  it("чистит конфликтующие горячие клавиши из файла", () => {
    const { settings } = mergeSettings({
      hotkeys: {
        pause: ["KeyP", "KeyP"],
        speed1: ["Space", "Digit1"],
      },
    });
    expect(settings.hotkeys.pause[0]).toBe("KeyP");
    expect(settings.hotkeys.pause[1]).toBeNull();
    expect(settings.hotkeys.speed1[0]).toBe("Space");
  });

  it("помечает старую версию файла", () => {
    const { issues } = mergeSettings({ version: 0 });
    expect(issues.join("\n")).toContain("версия");
  });

  it("даёт независимые значения для сброса вкладки", () => {
    const game = defaultSection("game");
    game.language = "en";
    expect(createDefaultSettings().game.language).toBe("ru");
  });
});
