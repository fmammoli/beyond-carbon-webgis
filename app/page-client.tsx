"use client";

import dynamic from "next/dynamic";

const MapContainer = dynamic(() => import("@/components/gis/map-container"), {
  ssr: false,
  loading: () => (
    <main className="grid h-[100dvh] w-full place-items-center bg-gradient-to-br from-cyan-50 via-sky-100 to-blue-200">
      <div className="rounded-xl border border-white/60 bg-white/85 px-5 py-3 text-sm shadow-lg backdrop-blur-sm">
        Loading WebGIS workspace...
      </div>
    </main>
  ),
});

export default function PageClient() {
  return <MapContainer />;
}
