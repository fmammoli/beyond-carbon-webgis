"use client";

import { Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  ThreatMapOverlayDiagnostics,
  ThreatMapOverlayProgress,
} from "@/components/gis/threat-map-overlay";

type ExportsPanelProps = {
  onThreatMapClick: () => void;
  onCancelThreatMapGeneration: () => void;
  isThreatMapAiming: boolean;
  isThreatMapGenerating: boolean;
  threatMapProgress: ThreatMapOverlayProgress | null;
  threatMapDiagnostics: ThreatMapOverlayDiagnostics | null;
  threatMapError: string | null;
  disabled?: boolean;
};

export function ExportsPanel({
  onThreatMapClick,
  onCancelThreatMapGeneration,
  isThreatMapAiming,
  isThreatMapGenerating,
  threatMapProgress,
  threatMapDiagnostics,
  threatMapError,
  disabled = false,
}: ExportsPanelProps) {
  const isThreatMapButtonDisabled = disabled || isThreatMapGenerating;

  return (
    <div className="space-y-2.5">
      <Button
        type="button"
        size="sm"
        className="w-full justify-start"
        disabled={isThreatMapButtonDisabled}
        onClick={onThreatMapClick}
      >
        <Clapperboard className="size-4" aria-hidden />
        {isThreatMapGenerating ? "Threat Map (Processing...)" : "Threat Map"}
      </Button>
      {isThreatMapGenerating ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-start border-rose-300 text-rose-700 hover:bg-rose-50"
          onClick={onCancelThreatMapGeneration}
        >
          Cancel generation
        </Button>
      ) : null}
      {isThreatMapAiming ? (
        <div className="rounded-md border border-cyan-200 bg-cyan-50/70 px-3 py-2 text-xs text-cyan-900">
          Aim the square on the map, then click Generate from the map overlay.
        </div>
      ) : null}
      {isThreatMapGenerating && threatMapProgress ? (
        <div className="space-y-1 rounded-md border border-cyan-200 bg-white/85 px-3 py-2 text-xs text-slate-900">
          <p className="font-semibold">{threatMapProgress.phaseLabel}</p>
          <p>{threatMapProgress.statusLabel}</p>
          {threatMapProgress.percent !== null ? (
            <p>Progress: {threatMapProgress.percent}%</p>
          ) : null}
          {threatMapProgress.year !== null ? (
            <p>Year: {threatMapProgress.year}</p>
          ) : null}
          {threatMapProgress.frameIndex !== null && threatMapProgress.totalFrames !== null ? (
            <p>
              Frame: {threatMapProgress.frameIndex} / {threatMapProgress.totalFrames}
            </p>
          ) : null}
          {threatMapDiagnostics ? (
            <>
              <p className="font-mono text-[11px]">
                Request/Ready: {threatMapDiagnostics.requestedYear ?? "-"}/{threatMapDiagnostics.readyYear ?? "-"}
              </p>
              <p className="font-mono text-[11px]">
                Token: {threatMapDiagnostics.resolvedToken}/{threatMapDiagnostics.awaitToken}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {threatMapError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50/90 px-3 py-2 text-xs text-rose-900">
          {threatMapError}
        </div>
      ) : null}
      <p className="text-xs text-slate-700/90">
        Click Threat Map, aim the square on map, then click Generate.
      </p>
    </div>
  );
}
