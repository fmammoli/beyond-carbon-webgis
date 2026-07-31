"use client";

import { Button } from "@/components/ui/button";
import type { ThreatMapPixelRect } from "@/lib/threat-map-export";
import type { CaptureMapScreenFocusRect } from "@/lib/map-capture-export";

type ThreatMapOverlayProgress = {
  phaseLabel: string;
  statusLabel: string;
  percent: number | null;
  frameIndex: number | null;
  totalFrames: number | null;
  year: number | null;
};

type ThreatMapOverlayDiagnostics = {
  requestedYear: number | null;
  readyYear: number | null;
  awaitToken: number;
  resolvedToken: number;
  renderedCoverage: number;
  frameLoading: boolean;
  matched: boolean;
};

type ThreatMapOverlayProps = {
  isVisible: boolean;
  pixelRect: (ThreatMapPixelRect | CaptureMapScreenFocusRect) | null;
  sideKilometers: number;
  minYear: number;
  maxYear: number;
  canGenerate: boolean;
  displayedError: string | null;
  onCancel: () => void;
  onGenerate: () => void;
  generateLabel?: string;
  footerText?: string;
};

export function ThreatMapOverlay({
  isVisible,
  pixelRect,
  sideKilometers,
  minYear,
  maxYear,
  canGenerate,
  displayedError,
  onCancel,
  onGenerate,
  generateLabel,
  footerText,
}: ThreatMapOverlayProps) {
  if (!isVisible || !pixelRect) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[65]">
      <div
        className="absolute left-0 right-0 top-0 bg-black/50"
        style={{ height: `${Math.max(0, pixelRect.top)}px` }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 bg-black/50"
        style={{ top: `${Math.max(0, pixelRect.top + pixelRect.height)}px` }}
      />
      <div
        className="absolute bg-black/50"
        style={{
          left: 0,
          top: `${Math.max(0, pixelRect.top)}px`,
          width: `${Math.max(0, pixelRect.left)}px`,
          height: `${Math.max(1, pixelRect.height)}px`,
        }}
      />
      <div
        className="absolute bg-black/50"
        style={{
          left: `${Math.max(0, pixelRect.left + pixelRect.width)}px`,
          top: `${Math.max(0, pixelRect.top)}px`,
          right: 0,
          height: `${Math.max(1, pixelRect.height)}px`,
        }}
      />

      <div
        className="absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]"
        style={{
          left: `${pixelRect.left}px`,
          top: `${pixelRect.top}px`,
          width: `${pixelRect.width}px`,
          height: `${pixelRect.height}px`,
        }}
      />

      <div
        className="pointer-events-auto absolute flex items-center gap-2"
        style={{
          left: `${Math.max(16, pixelRect.left)}px`,
          top: `${Math.max(12, pixelRect.top - 44)}px`,
        }}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          {generateLabel ?? "Generate"}
        </Button>
      </div>

      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-white/80 bg-white/92 px-3 py-2 text-xs text-slate-800 shadow-lg">
        {footerText ?? `Aim a fixed ${sideKilometers} km square, then generate MP4 (${minYear}-${maxYear}).`}
      </div>

      {displayedError ? (
        <div className="pointer-events-none absolute bottom-20 left-1/2 max-w-[min(90vw,36rem)] -translate-x-1/2 rounded-md border border-rose-200 bg-rose-50/95 px-3 py-2 text-xs text-rose-900 shadow-lg">
          {displayedError}
        </div>
      ) : null}

    </div>
  );
}

export type {
  ThreatMapOverlayDiagnostics,
  ThreatMapOverlayProgress,
};
