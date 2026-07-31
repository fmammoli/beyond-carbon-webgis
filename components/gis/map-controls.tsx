"use client";

import type { ReactNode } from "react";
import {
  Layers,
  MapPinned,
  Satellite,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { MapControlVectorLayerItem } from "@/hooks/use-map-vector-layers";

type MapControlsProps = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  isLandcoverVisible: boolean;
  landcoverOpacity: number;
  isAgbVisible: boolean;
  agbOpacity: number;
  isChmVisible: boolean;
  chmOpacity: number;
  vectorLayerItems: MapControlVectorLayerItem[];
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
  onAgbChange: (visible: boolean) => void;
  onAgbOpacityChange: (opacity: number) => void;
  onChmChange: (visible: boolean) => void;
  onChmOpacityChange: (opacity: number) => void;
  onVectorLayerChange: (fileName: string, visible: boolean) => void;
  onVectorLayerOpacityChange: (fileName: string, opacity: number) => void;
  embedded?: boolean;
};

type ToggleOpacityRowProps = {
  icon: ReactNode;
  label: string;
  checked: boolean;
  opacity: number;
  onCheckedChange: (checked: boolean) => void;
  onOpacityChange: (opacity: number) => void;
  switchAriaLabel: string;
  sliderAriaLabel: string;
};

type ToggleRowProps = {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  switchAriaLabel: string;
};

function ToggleRow({
  icon,
  label,
  checked,
  onCheckedChange,
  switchAriaLabel,
}: ToggleRowProps) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 text-sm">
          {icon}
          <span>{label}</span>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={switchAriaLabel} />
      </div>
    </div>
  );
}

function ToggleOpacityRow({
  icon,
  label,
  checked,
  opacity,
  onCheckedChange,
  onOpacityChange,
  switchAriaLabel,
  sliderAriaLabel,
}: ToggleOpacityRowProps) {
  const opacityPercent = Math.round(opacity * 100);

  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 text-sm">
          {icon}
          <span>{label}</span>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={switchAriaLabel} />
      </div>
      {checked ? (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Opacity</span>
            <span className="tabular-nums">{opacityPercent}%</span>
          </div>
          <Slider
            value={[opacityPercent]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => {
              const nextValue = Array.isArray(value) ? value[0] : value;
              onOpacityChange((nextValue ?? opacityPercent) / 100);
            }}
            aria-label={sliderAriaLabel}
          />
        </div>
      ) : null}
    </div>
  );
}

export function MapControls({
  isSatelliteVisible,
  isBoundariesAndPlacesVisible,
  isLandcoverVisible,
  landcoverOpacity,
  isAgbVisible,
  agbOpacity,
  isChmVisible,
  chmOpacity,
  vectorLayerItems,
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onLandcoverOpacityChange,
  onAgbChange,
  onAgbOpacityChange,
  onChmChange,
  onChmOpacityChange,
  onVectorLayerChange,
  onVectorLayerOpacityChange,
  embedded = false,
}: MapControlsProps) {
  const controlsContent = (
    <div className="space-y-2">
        <ToggleRow
          icon={<Satellite className="size-4" />}
          label="Satellite Basemap"
          checked={isSatelliteVisible}
          onCheckedChange={onSatelliteChange}
          switchAriaLabel="Toggle satellite basemap"
        />
        <ToggleRow
          icon={<MapPinned className="size-4" />}
          label="Place Labels & Borders"
          checked={isBoundariesAndPlacesVisible}
          onCheckedChange={onBoundariesAndPlacesChange}
          switchAriaLabel="Toggle country borders and place labels"
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label="Landcover Layer"
          checked={isLandcoverVisible}
          opacity={landcoverOpacity}
          onCheckedChange={onLandcoverChange}
          onOpacityChange={onLandcoverOpacityChange}
          switchAriaLabel="Toggle landcover layer"
          sliderAriaLabel="Set landcover opacity"
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label="Above Ground Biomass Layer"
          checked={isAgbVisible}
          opacity={agbOpacity}
          onCheckedChange={onAgbChange}
          onOpacityChange={onAgbOpacityChange}
          switchAriaLabel="Toggle above ground biomass layer"
          sliderAriaLabel="Set above ground biomass opacity"
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label="Canopy Height Model Layer"
          checked={isChmVisible}
          opacity={chmOpacity}
          onCheckedChange={onChmChange}
          onOpacityChange={onChmOpacityChange}
          switchAriaLabel="Toggle canopy height model layer"
          sliderAriaLabel="Set canopy height model opacity"
        />
        {vectorLayerItems.map((item) => (
          <ToggleOpacityRow
            key={item.fileName}
            icon={<span className="size-3.5 rounded-full border border-slate-300" style={{ backgroundColor: item.color }} />}
            label={item.fileName}
            checked={item.isVisible}
            opacity={item.opacity}
            onCheckedChange={(checked) => onVectorLayerChange(item.fileName, checked)}
            onOpacityChange={(opacity) => onVectorLayerOpacityChange(item.fileName, opacity)}
            switchAriaLabel={`Toggle ${item.fileName}`}
            sliderAriaLabel={`Set opacity for ${item.fileName}`}
          />
        ))}
    </div>
  );

  if (embedded) {
    return <div className="min-h-0 flex-1 overflow-y-auto pr-1">{controlsContent}</div>;
  }

  return (
    <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-white/30 bg-card/85 shadow-lg backdrop-blur-sm">
      <CardHeader className="py-1">
        <CardTitle className="flex items-center gap-1 text-sm font-semibold">
          <Layers className="size-4" />
          Layer Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pb-3 pr-2 pt-0">
        {controlsContent}
      </CardContent>
    </Card>
  );
}