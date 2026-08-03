import PageClient from "@/app/page-client";
import { hasLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";

export default async function LocalizedHomePage({
  params,
}: PageProps<"/[lang]">) {
  const { lang } = await params;

  if (!hasLocale(lang)) {
    notFound();
  }

  return <PageClient />;
}