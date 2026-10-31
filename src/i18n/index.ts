import { useMemo } from "react";
import en from "./en.json";
import ru from "./ru.json";
import { useGameStore } from "../state/store";
import type { Language } from "./language";

export type { Language } from "./language";
export { LANGUAGES, isLanguage } from "./language";

const dictionaries: Record<Language, Record<string, string>> = {
  ru: ru as Record<string, string>,
  en: en as Record<string, string>,
};

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Перевод по ключу. Неизвестный ключ возвращается как есть — так его видно в интерфейсе. */
export function translate(language: Language, key: string, params?: Record<string, string | number>): string {
  const template = dictionaries[language][key] ?? dictionaries.ru[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Хук: функция перевода, привязанная к выбранному языку из настроек. */
export function useT(): Translate {
  const language = useGameStore((state) => state.settings.game.language);
  return useMemo(
    () => (key: string, params?: Record<string, string | number>) => translate(language, key, params),
    [language],
  );
}
