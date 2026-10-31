import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import ru from "../src/i18n/ru.json";

function filesUnder(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else result.push(full);
  }
  return result;
}

/** Убирает комментарии, чтобы правила не срабатывали на упоминания в тексте. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

function simSources(): { file: string; code: string }[] {
  return filesUnder(path.join(process.cwd(), "src", "sim")).map((file) => ({
    file,
    code: stripComments(fs.readFileSync(file, "utf8")),
  }));
}

describe("словари и правила проекта", () => {
  it("ru и en содержат одинаковый набор ключей", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it("не содержит пустых переводов", () => {
    const empty = [...Object.entries(ru), ...Object.entries(en)]
      .filter(([, value]) => typeof value !== "string" || value.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("симуляция не использует Math.random", () => {
    const offenders = simSources()
      .filter(({ code }) => /Math\s*\.\s*random\s*\(/.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("симуляция не импортирует React, DOM или Electron", () => {
    const forbidden = /from\s+["'](react|react-dom|electron)(\/[^"']*)?["']/;
    const offenders = simSources()
      .filter(({ code }) => forbidden.test(code))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
