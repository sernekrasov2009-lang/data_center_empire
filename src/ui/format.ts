import type { Language } from "../i18n";

const MONEY_LOCALE: Record<Language, string> = { ru: "ru-RU", en: "en-US" };

/** $1 234, $1,2 тыс., $3,4 млн (DESIGN.md, разд. 20). */
export function formatMoney(value: number, language: Language): string {
  const locale = MONEY_LOCALE[language];
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);

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
  return `${sign}$${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(abs)}`;
}

export function formatInt(value: number, language: Language): string {
  return new Intl.NumberFormat(MONEY_LOCALE[language], { maximumFractionDigits: 0 }).format(value);
}

export function formatMs(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(2);
}

export function formatClock(hourOfDay: number): string {
  return `${String(hourOfDay).padStart(2, "0")}:00`;
}
