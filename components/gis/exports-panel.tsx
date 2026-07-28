"use client";

import { Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  THREAT_MAP_EXPORT_PRESETS,
  type ThreatMapExportPreset,
} from "@/lib/gis-constants";

type ExportsPanelProps = {
  onThreatMapClick: () => void;
  qualityPreset: ThreatMapExportPreset;
  onQualityPresetChange: (preset: ThreatMapExportPreset) => void;
  disabled?: boolean;
};

export function ExportsPanel({
  onThreatMapClick,
  qualityPreset,
  onQualityPresetChange,
  disabled = false,
}: ExportsPanelProps) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-700/90">Quality</p>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(THREAT_MAP_EXPORT_PRESETS).map(([presetId, presetConfig]) => {
            const isActive = qualityPreset === presetId;
            return (
              <Button
                key={presetId}
                type="button"
                size="sm"
                variant={isActive ? "default" : "outline"}
                className="h-8 px-2 text-xs"
                disabled={disabled}
                onClick={() => onQualityPresetChange(presetId as ThreatMapExportPreset)}
              >
                {presetConfig.label}
              </Button>
            );
          })}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="w-full justify-start"
        disabled={disabled}
        onClick={onThreatMapClick}
      >
        <Clapperboard className="size-4" aria-hidden />
        Threat Map
      </Button>
      <p className="text-xs text-slate-700/90">
        Generate a year-by-year MP4 from 1990 to 2024 using the 30 km aiming square.
      </p>
    </div>
  );
}
