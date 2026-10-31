export type Language = "ru" | "en";

export const LANGUAGES: readonly Language[] = ["ru", "en"];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}
