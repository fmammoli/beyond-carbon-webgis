"use client";

import type { ReactNode } from "react";
import {
  Layers,
  MapPinned,
  Satellite,
} from "lucide-react";

import { useI18n } from "@/components/providers/i18n-provider";
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
  isChmIndonesiaVisible: boolean;
  chmIndonesiaOpacity: number;
  isChmKetapangVisible: boolean;
  chmKetapangOpacity: number;
  vectorLayerItems: MapControlVectorLayerItem[];
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
  onAgbChange: (visible: boolean) => void;
  onAgbOpacityChange: (opacity: number) => void;
  onChmIndonesiaChange: (visible: boolean) => void;
  onChmIndonesiaOpacityChange: (opacity: number) => void;
  onChmKetapangChange: (visible: boolean) => void;
  onChmKetapangOpacityChange: (opacity: number) => void;
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
  const { t } = useI18n();

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
            <span>{t("mapControls.opacity", "Opacity")}</span>
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
  isChmIndonesiaVisible,
  chmIndonesiaOpacity,
  isChmKetapangVisible,
  chmKetapangOpacity,
  vectorLayerItems,
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onLandcoverOpacityChange,
  onAgbChange,
  onAgbOpacityChange,
  onChmIndonesiaChange,
  onChmIndonesiaOpacityChange,
  onChmKetapangChange,
  onChmKetapangOpacityChange,
  onVectorLayerChange,
  onVectorLayerOpacityChange,
  embedded = false,
}: MapControlsProps) {
  const { t } = useI18n();

  const controlsContent = (
    <div className="space-y-2">
        <ToggleRow
          icon={<Satellite className="size-4" />}
          label={t("mapControls.satelliteBasemap", "Satellite Basemap")}
          checked={isSatelliteVisible}
          onCheckedChange={onSatelliteChange}
          switchAriaLabel={t("mapControls.aria.toggleSatelliteBasemap", "Toggle satellite basemap")}
        />
        <ToggleRow
          icon={<MapPinned className="size-4" />}
          label={t("mapControls.placeLabelsBorders", "Place Labels & Borders")}
          checked={isBoundariesAndPlacesVisible}
          onCheckedChange={onBoundariesAndPlacesChange}
          switchAriaLabel={t("mapControls.aria.togglePlaceLabelsBorders", "Toggle country borders and place labels")}
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label={t("mapControls.landcoverLayer", "Landcover Layer")}
          checked={isLandcoverVisible}
          opacity={landcoverOpacity}
          onCheckedChange={onLandcoverChange}
          onOpacityChange={onLandcoverOpacityChange}
          switchAriaLabel={t("mapControls.aria.toggleLandcoverLayer", "Toggle landcover layer")}
          sliderAriaLabel={t("mapControls.aria.setLandcoverOpacity", "Set landcover opacity")}
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label={t("mapControls.aboveGroundBiomassLayer", "Above Ground Biomass Layer")}
          checked={isAgbVisible}
          opacity={agbOpacity}
          onCheckedChange={onAgbChange}
          onOpacityChange={onAgbOpacityChange}
          switchAriaLabel={t("mapControls.aria.toggleAboveGroundBiomassLayer", "Toggle above ground biomass layer")}
          sliderAriaLabel={t("mapControls.aria.setAboveGroundBiomassOpacity", "Set above ground biomass opacity")}
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label={t("mapControls.canopyHeightModelIndonesia", "Canopy Height Model (Indonesia)")}
          checked={isChmIndonesiaVisible}
          opacity={chmIndonesiaOpacity}
          onCheckedChange={onChmIndonesiaChange}
          onOpacityChange={onChmIndonesiaOpacityChange}
          switchAriaLabel={t("mapControls.aria.toggleCanopyHeightModelIndonesia", "Toggle canopy height model Indonesia layer")}
          sliderAriaLabel={t("mapControls.aria.setCanopyHeightModelIndonesiaOpacity", "Set canopy height model Indonesia opacity")}
        />
        <ToggleOpacityRow
          icon={<Layers className="size-4" />}
          label={t("mapControls.canopyHeightModelKetapang", "Canopy Height Model (Ketapang)")}
          checked={isChmKetapangVisible}
          opacity={chmKetapangOpacity}
          onCheckedChange={onChmKetapangChange}
          onOpacityChange={onChmKetapangOpacityChange}
          switchAriaLabel={t("mapControls.aria.toggleCanopyHeightModelKetapang", "Toggle canopy height model Ketapang layer")}
          sliderAriaLabel={t("mapControls.aria.setCanopyHeightModelKetapangOpacity", "Set canopy height model Ketapang opacity")}
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
            switchAriaLabel={`${t("mapControls.aria.toggleLayer", "Toggle layer")}: ${item.fileName}`}
            sliderAriaLabel={`${t("mapControls.aria.setOpacityFor", "Set opacity for")}: ${item.fileName}`}
          />
        ))}
    </div>
  );

  if (embedded) {
    return <div className="h-full min-h-0 overflow-y-auto pr-1">{controlsContent}</div>;
  }

  return (
    <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-white/30 bg-card/85 shadow-lg backdrop-blur-sm">
      <CardHeader className="py-1">
        <CardTitle className="flex items-center gap-1 text-sm font-semibold">
          <Layers className="size-4" />
          {t("mapControls.panelTitle", "Layer Controls")}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pb-3 pr-2 pt-0">
        {controlsContent}
      </CardContent>
    </Card>
  );
}