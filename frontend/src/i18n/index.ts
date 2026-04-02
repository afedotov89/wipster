import { create } from "zustand";
import en from "./en";
import ru from "./ru";

export type Locale = "en" | "ru";

export type Translations = { [K in keyof typeof en]: (typeof en)[K] extends (...args: infer A) => string ? (...args: A) => string : string };

const locales: Record<Locale, Translations> = { en, ru } as Record<Locale, Translations>;

interface I18nState {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

function detectLocale(): Locale {
  const saved = localStorage.getItem("wipster-locale");
  if (saved === "en" || saved === "ru") return saved;
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ru")) return "ru";
  return "en";
}

export const useI18n = create<I18nState>((set) => {
  const initial = detectLocale();
  return {
    locale: initial,
    t: locales[initial],
    setLocale: (locale) => {
      localStorage.setItem("wipster-locale", locale);
      set({ locale, t: locales[locale] });
    },
  };
});
