import type { Language } from "../i18n/language";
import type { NumberFormat } from "../state/settings";

const MONEY_LOCALE: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

/** $1 234, $1,2 тыс., $3,4 млн (DESIGN.md, разд. 20). */
export function formatMoney(value: number, language: Language, mode: NumberFormat = "short"): string {
  const locale = MONEY_LOCALE[language];
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);

  if (mode === "full") {
    const digits = abs < 1000 ? 2 : 0;
    return `${sign}$${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(abs)}`;
  }

  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(millions);
    return `${sign}$${text} ${language === "ru" ? "млн" : "M"}`;
  }
  if (abs >= 10_000) {
    const thousands = abs / 1_000;
    const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(thousands);
    return `${sign}$${text} ${language === "ru" ? "тыс." : "K"}`;
  }
  return `${sign}$${new Intl.NumberFormat(locale, { maximumFractionDigits: abs < 1000 ? 2 : 0 }).format(abs)}`;
}

export function formatInt(value: number, language: Language): string {
  return new Intl.NumberFormat(MONEY_LOCALE[language], { maximumFractionDigits: 0 }).format(value);
}

/** Точная цена маленьких величин: $0,12 за кВт·ч. */
export function formatMoneyExact(value: number, language: Language): string {
  const sign = value < 0 ? "−" : "";
  const text = new Intl.NumberFormat(MONEY_LOCALE[language], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(Math.abs(value));
  return `${sign}$${text}`;
}

export function formatMs(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(2);
}

export function formatClock(hourOfDay: number): string {
  return `${String(hourOfDay).padStart(2, "0")}:00`;
}

export function formatSavedAt(iso: string, language: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(MONEY_LOCALE[language], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
