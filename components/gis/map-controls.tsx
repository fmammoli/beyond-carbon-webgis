"use client";

import { Layers, MapPinned, Satellite } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type MapControlsProps = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  isLandcoverVisible: boolean;
  showLandcoverCodes: boolean;
  landcoverOpacity: number;
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onShowLandcoverCodesChange: (show: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
};

export function MapControls({
  isSatelliteVisible,
  isBoundariesAndPlacesVisible,
  isLandcoverVisible,
  showLandcoverCodes,
  landcoverOpacity,
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onShowLandcoverCodesChange,
  onLandcoverOpacityChange,
}: MapControlsProps) {
  const opacityPercent = Math.round(landcoverOpacity * 100);

  return (
    <Card className="w-72 border-white/30 bg-card/85 shadow-lg backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4" />
          Layer Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Satellite className="size-4" />
            <span>Satellite Basemap</span>
          </div>
          <Switch
            checked={isSatelliteVisible}
            onCheckedChange={onSatelliteChange}
            aria-label="Toggle satellite basemap"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <MapPinned className="size-4" />
            <span>Place Labels & Borders</span>
          </div>
          <Switch
            checked={isBoundariesAndPlacesVisible}
            onCheckedChange={onBoundariesAndPlacesChange}
            aria-label="Toggle country borders and place labels"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Layers className="size-4" />
            <span>Landcover Layer</span>
          </div>
          <Switch
            checked={isLandcoverVisible}
            onCheckedChange={onLandcoverChange}
            aria-label="Toggle landcover layer"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Layers className="size-4" />
            <span>Raw Pixel Codes</span>
          </div>
          <Switch
            checked={showLandcoverCodes}
            onCheckedChange={onShowLandcoverCodesChange}
            aria-label="Render landcover as raw class codes"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Landcover Opacity</span>
            <span className="tabular-nums">{opacityPercent}%</span>
          </div>
          <Slider
            value={[opacityPercent]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => {
              const nextValue = Array.isArray(value) ? value[0] : value;
              onLandcoverOpacityChange((nextValue ?? opacityPercent) / 100);
            }}
            aria-label="Set landcover layer opacity"
          />
        </div>
      </CardContent>
    </Card>
  );
}