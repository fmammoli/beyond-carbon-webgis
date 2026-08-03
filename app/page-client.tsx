"use client";

import dynamic from "next/dynamic";

import { useI18n } from "@/components/providers/i18n-provider";

function LoadingWorkspace() {
  const { t } = useI18n();

  return (
    <main className="grid h-[100dvh] w-full place-items-center bg-gradient-to-br from-cyan-50 via-sky-100 to-blue-200">
      <div className="rounded-xl border border-white/60 bg-white/85 px-5 py-3 text-sm shadow-lg backdrop-blur-sm">
        {t("shell.loadingWorkspace", "Loading WebGIS workspace...")}
      </div>
    </main>
  );
}

const MapContainer = dynamic(() => import("@/components/gis/map-container"), {
  ssr: false,
  loading: LoadingWorkspace,
});

export default function PageClient() {
  return <MapContainer />;
}
