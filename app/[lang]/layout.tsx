import { notFound } from "next/navigation";

import { I18nProvider } from "@/components/providers/i18n-provider";
import { getDictionary } from "@/lib/dictionaries";
import { hasLocale, locales } from "@/lib/i18n";

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;

  if (!hasLocale(lang)) {
    notFound();
  }

  const dictionary = await getDictionary(lang);

  return (
    <I18nProvider locale={lang} dictionary={dictionary}>
      {children}
    </I18nProvider>
  );
}