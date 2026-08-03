import "server-only";

import type { Locale } from "@/lib/i18n";

export type DictionaryTree = {
  [key: string]: string | DictionaryTree;
};

const dictionaries = {
  en: () => import("@/dictionaries/en.json").then((module) => module.default),
  id: () => import("@/dictionaries/id.json").then((module) => module.default),
} satisfies Record<Locale, () => Promise<DictionaryTree>>;

export type Dictionary = Awaited<ReturnType<(typeof dictionaries)[Locale]>>;

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  return dictionaries[locale]();
}