"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Layers, MapPlus } from "lucide-react";

import { Legend, type ActiveLegendLayer } from "@/components/gis/legend";
import { MapControls, type CanopyLayerItem } from "@/components/gis/map-controls";
import { TimeSlider } from "@/components/gis/time-slider";
import { Button } from "@/components/ui/button";
import type { PmtilesZoomRange } from "@/lib/pmtiles-source";

type HoveredClassInfo = {
  color: string;
  label: string;
  labelId: string;
};

type HoverPixelPanelInfo = {
  code: number | null;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  requestedZoom: number | null;
  sourceZoom: number | null;
};

type MapTopPanelsProps = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  isLandcoverVisible: boolean;
  landcoverOpacity: number;
  canopyLayers: CanopyLayerItem[];
  activeLegendLayers: ActiveLegendLayer[];
  isLegendOpen: boolean;
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
  onCanopyLayerStart: (fileName: string) => void;
  onCanopyLayerDownload: (fileName: string) => void;
  onCanopyLayerVisibilityChange: (fileName: string, visible: boolean) => void;
  onCanopyLayerOpacityChange: (fileName: string, opacity: number) => void;
  onLegendOpenChange: (open: boolean) => void;
  primaryAction?: ReactNode;
};

type MapBottomSliderProps = {
  year: number;
  minYear: number;
  maxYear: number;
  isPlaying: boolean;
  canAdvance: boolean;
  isFrameLoading: boolean;
  isPreloadingYears: boolean;
  onYearChange: (year: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
};

type HoverClassTooltipProps = {
  hoveredClass: HoveredClassInfo | null;
  hoverTooltipStyle: CSSProperties | null;
  isVisible: boolean;
};

type PixelInspectorPanelProps = {
  hoverPixelInfo: HoverPixelPanelInfo | null;
  hoveredClass: HoveredClassInfo | null;
  pmtilesZoomRange: PmtilesZoomRange | null;
  isVisible: boolean;
};

export function MapTopPanels({
  isSatelliteVisible,
  isBoundariesAndPlacesVisible,
  isLandcoverVisible,
  landcoverOpacity,
  canopyLayers,
  activeLegendLayers,
  isLegendOpen,
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onLandcoverOpacityChange,
  onCanopyLayerStart,
  onCanopyLayerDownload,
  onCanopyLayerVisibilityChange,
  onCanopyLayerOpacityChange,
  onLegendOpenChange,
  primaryAction,
}: MapTopPanelsProps) {
  const [isLayerControlsOpen, setIsLayerControlsOpen] = useState(true);
  const [isCommunityPanelOpen, setIsCommunityPanelOpen] = useState(true);

  return (
    <div className="absolute left-3 right-3 top-3 md:left-5 md:right-5 md:top-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="flex h-[calc(100dvh-5.5rem)] w-full min-h-0 flex-col gap-2 md:h-[calc(100dvh-6.5rem)] md:w-auto md:min-w-[18rem]">
          <div
            className={`pointer-events-auto min-h-0 self-start ${
              isLayerControlsOpen ? "flex-[1_1_0%]" : "flex-none"
            }`}
          >
            {isLayerControlsOpen ? (
              <div className="relative h-full">
                <MapControls
                  isSatelliteVisible={isSatelliteVisible}
                  isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
                  isLandcoverVisible={isLandcoverVisible}
                  landcoverOpacity={landcoverOpacity}
                  onSatelliteChange={onSatelliteChange}
                  onBoundariesAndPlacesChange={onBoundariesAndPlacesChange}
                  onLandcoverChange={onLandcoverChange}
                  onLandcoverOpacityChange={onLandcoverOpacityChange}
                  onCanopyLayerStart={onCanopyLayerStart}
                  canopyLayers={canopyLayers}
                  onCanopyLayerDownload={onCanopyLayerDownload}
                  onCanopyLayerVisibilityChange={onCanopyLayerVisibilityChange}
                  onCanopyLayerOpacityChange={onCanopyLayerOpacityChange}
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  className="absolute right-2 top-2 z-10 bg-background/80"
                  onClick={() => setIsLayerControlsOpen(false)}
                  aria-label="Collapse layer controls"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="bg-card/90"
                onClick={() => setIsLayerControlsOpen(true)}
                aria-label="Expand layer controls"
              >
                <Layers className="size-4" />
              </Button>
            )}
          </div>

          {primaryAction ? (
            <div
              className={`pointer-events-auto min-h-0 pb-1 ${
                isCommunityPanelOpen ? "flex-[1_1_0%]" : "flex-none"
              }`}
            >
              {isCommunityPanelOpen ? (
                <div className="relative h-full">
                  {primaryAction}
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="outline"
                    className="absolute right-2 top-2 z-10 bg-background/80"
                    onClick={() => setIsCommunityPanelOpen(false)}
                    aria-label="Collapse community map panel"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="bg-cyan-50/90 text-cyan-900"
                  onClick={() => setIsCommunityPanelOpen(true)}
                  aria-label="Expand community map panel"
                >
                  <MapPlus className="size-4" />
                </Button>
              )}
            </div>
          ) : null}
        </div>

        <div className="pointer-events-auto self-start md:ml-auto">
          <Legend
            open={isLegendOpen}
            onOpenChange={onLegendOpenChange}
            activeLayers={activeLegendLayers}
          />
        </div>
      </div>
    </div>
  );
}

export function MapBottomSlider({
  year,
  minYear,
  maxYear,
  isPlaying,
  canAdvance,
  isFrameLoading,
  isPreloadingYears,
  onYearChange,
  onPlayingChange,
}: MapBottomSliderProps) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 md:bottom-3">
      <div className="pointer-events-auto w-fit">
        <TimeSlider
          year={year}
          minYear={minYear}
          maxYear={maxYear}
          isPlaying={isPlaying}
          canAdvance={canAdvance}
          isFrameLoading={isFrameLoading}
          isPreloadingYears={isPreloadingYears}
          onYearChange={onYearChange}
          onPlayingChange={onPlayingChange}
        />
      </div>
    </div>
  );
}

export function HoverClassTooltip({
  hoveredClass,
  hoverTooltipStyle,
  isVisible,
}: HoverClassTooltipProps) {
  if (!isVisible || !hoverTooltipStyle || !hoveredClass) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-40 max-w-48 rounded-md border border-white/35 bg-black/75 px-2.5 py-1.5 text-[11px] text-white shadow-lg backdrop-blur-sm duration-100 ease-out animate-in fade-in-0 zoom-in-95 slide-in-from-left-1 transition-[left,top]"
      style={hoverTooltipStyle}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-xs ring-1 ring-white/60"
          style={{ backgroundColor: hoveredClass.color }}
        />
        <div className="min-w-0 leading-tight">
          <div className="truncate">{hoveredClass.label}</div>
          <div className="truncate text-white/75">{hoveredClass.labelId}</div>
        </div>
      </div>
    </div>
  );
}

export function PixelInspectorPanel({
  hoverPixelInfo,
  hoveredClass,
  pmtilesZoomRange,
  isVisible,
}: PixelInspectorPanelProps) {
  if (!isVisible || !hoverPixelInfo) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-28 right-3 w-[min(92vw,22rem)] rounded-xl border border-white/30 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm md:bottom-36 md:right-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">Pixel Inspector</span>
        <span className="text-[11px] text-amber-200">Classified mode</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Code</span>
        <span className="font-mono tabular-nums">
          {hoverPixelInfo.code === null ? "NoData" : hoverPixelInfo.code}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>RGBA</span>
        <span className="font-mono tabular-nums">
          {hoverPixelInfo.red}, {hoverPixelInfo.green}, {hoverPixelInfo.blue}, {hoverPixelInfo.alpha}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Requested z</span>
        <span className="font-mono tabular-nums">{hoverPixelInfo.requestedZoom ?? "-"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Source z used</span>
        <span className="font-mono tabular-nums">{hoverPixelInfo.sourceZoom ?? "-"}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>PMTiles z-range</span>
        <span className="font-mono tabular-nums">
          {pmtilesZoomRange
            ? `${pmtilesZoomRange.minZoom}-${pmtilesZoomRange.maxZoom}`
            : "unknown"}
        </span>
      </div>
      {hoverPixelInfo.requestedZoom !== null &&
      hoverPixelInfo.sourceZoom !== null &&
      hoverPixelInfo.requestedZoom !== hoverPixelInfo.sourceZoom ? (
        <div className="mt-1 text-[11px] text-amber-100/90">
          Overzoom active: rendering from source z{hoverPixelInfo.sourceZoom}.
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>Legend</span>
        {hoveredClass ? (
          <span className="flex items-center gap-2 text-right">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-xs ring-1 ring-white/60"
              style={{ backgroundColor: hoveredClass.color }}
            />
            <span className="truncate">{hoveredClass.label}</span>
          </span>
        ) : (
          <span className="text-white/80">Unmapped</span>
        )}
      </div>
      <div className="mt-2 text-[11px] text-amber-100/90">
        Landcover classes are decoded from rendered PMTiles colors.
      </div>
    </div>
  );
}

export function FloatingStatusMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-28 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg md:bottom-36">
      {message}
    </div>
  );
}