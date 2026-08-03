"use client";

import { createContext, startTransition, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { Dictionary, DictionaryTree } from "@/lib/dictionaries";
import { hasLocale, type Locale } from "@/lib/i18n";

type I18nContextValue = {
  locale: Locale;
  t: (key: string, fallback?: string) => string;
  setLocale: (nextLocale: Locale) => void;
  isSwitchingLocale: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveDictionaryValue(dictionary: DictionaryTree, key: string): string | null {
  const segments = key.split(".");
  let current: string | DictionaryTree | undefined = dictionary;

  for (const segment of segments) {
    if (!current || typeof current === "string") {
      return null;
    }

    current = current[segment];
  }

  return typeof current === "string" ? current : null;
}

export function I18nProvider({
  children,
  locale,
  dictionary,
}: {
  children: ReactNode;
  locale: Locale;
  dictionary: Dictionary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSwitchingLocale, setIsSwitchingLocale] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setIsSwitchingLocale(false);
  }, [locale, pathname]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, fallback) => resolveDictionaryValue(dictionary, key) ?? fallback ?? key,
    setLocale: (nextLocale) => {
      if (nextLocale === locale) {
        return;
      }

      const segments = (pathname ?? "/").split("/").filter(Boolean);
      const remainderSegments = segments.length > 0 && hasLocale(segments[0] ?? "")
        ? segments.slice(1)
        : segments;
      const nextPath = remainderSegments.length > 0
        ? `/${nextLocale}/${remainderSegments.join("/")}`
        : `/${nextLocale}`;
      const queryString = typeof window === "undefined"
        ? ""
        : window.location.search.replace(/^\?/, "");
      const nextUrl = queryString ? `${nextPath}?${queryString}` : nextPath;

      setIsSwitchingLocale(true);
      startTransition(() => {
        router.replace(nextUrl);
      });
    },
    isSwitchingLocale,
  }), [dictionary, isSwitchingLocale, locale, pathname, router]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }

  return context;
}