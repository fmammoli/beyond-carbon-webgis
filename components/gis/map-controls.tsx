"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Layers,
  Loader2,
  MapPinned,
  RefreshCcw,
  Satellite,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type CanopyLayerItem = {
  fileName: string;
  sourceName?: string;
  isVisible: boolean;
  opacity: number;
  isLoading?: boolean;
  jobStatus?: "idle" | "queued" | "running" | "succeeded" | "failed";
  progress?: number | null;
  etaSeconds?: number | null;
  statusMessage?: string;
  canDownload?: boolean;
  hasData?: boolean;
  error?: {
    code: string;
    message: string;
  } | null;
};

type MapControlsProps = {
  isSatelliteVisible: boolean;
  isBoundariesAndPlacesVisible: boolean;
  isLandcoverVisible: boolean;
  landcoverOpacity: number;
  onSatelliteChange: (visible: boolean) => void;
  onBoundariesAndPlacesChange: (visible: boolean) => void;
  onLandcoverChange: (visible: boolean) => void;
  onLandcoverOpacityChange: (opacity: number) => void;
  canopyLayers: CanopyLayerItem[];
  onCanopyLayerStart: (fileName: string) => void;
  onCanopyLayerDownload: (fileName: string) => void;
  onCanopyLayerVisibilityChange: (fileName: string, visible: boolean) => void;
  onCanopyLayerOpacityChange: (fileName: string, opacity: number) => void;
};

function formatEta(etaSeconds: number): string {
  const clamped = Math.max(0, Math.round(etaSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

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
  onSatelliteChange,
  onBoundariesAndPlacesChange,
  onLandcoverChange,
  onLandcoverOpacityChange,
  canopyLayers,
  onCanopyLayerStart,
  onCanopyLayerDownload,
  onCanopyLayerVisibilityChange,
  onCanopyLayerOpacityChange,
}: MapControlsProps) {
  return (
    <Card className="flex h-full min-h-0 w-[min(92vw,18rem)] flex-col border-white/30 bg-card/85 shadow-lg backdrop-blur-sm">
      <CardHeader className="py-1">
        <CardTitle className="flex items-center gap-1 text-sm font-semibold">
          <Layers className="size-4" />
          Layer Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pb-3 pr-2 pt-0">
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
        {canopyLayers.map((layer) => {
          const isProcessing = layer.jobStatus === "queued" || layer.jobStatus === "running";
          const isReady = layer.jobStatus === "succeeded";
          const isFailed = layer.jobStatus === "failed";
          const canStartJob = Boolean(layer.canDownload) && !isProcessing && !isReady;
          const clampedProgress = layer.progress === null || layer.progress === undefined
            ? null
            : Math.max(0, Math.min(100, Math.round(layer.progress)));
          const actionLabel = isProcessing
            ? layer.jobStatus === "queued"
              ? "Queued..."
              : clampedProgress !== null
                ? `Processing ${clampedProgress}%`
                : "Processing..."
            : isFailed
              ? "Retry"
              : "Generate CHM";
          const actionIcon = isProcessing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isFailed ? (
            <RefreshCcw className="size-3.5" />
          ) : (
            <Download className="size-3.5" />
          );

          return (
            <div
              key={layer.fileName}
              className="rounded-md border border-border/60 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <Layers className="size-4" />
                    <span className="truncate">Canopy Height</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {layer.sourceName ?? layer.fileName}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {canStartJob ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onCanopyLayerStart(layer.fileName)}
                      disabled={!layer.canDownload}
                    >
                      {actionIcon}
                      {actionLabel}
                    </Button>
                  ) : null}

                  {isProcessing ? (
                    <Button type="button" size="sm" variant="secondary" disabled>
                      {actionIcon}
                      {actionLabel}
                    </Button>
                  ) : null}

                  {isReady ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onCanopyLayerDownload(layer.fileName)}
                      >
                        <Download className="size-3.5" />
                        Download
                      </Button>
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <Switch
                        checked={layer.isVisible}
                        onCheckedChange={(checked) =>
                          onCanopyLayerVisibilityChange(layer.fileName, checked)
                        }
                        aria-label={`Toggle canopy height for ${layer.sourceName ?? layer.fileName}`}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              {layer.statusMessage || layer.error || isProcessing || isFailed ? (
                <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  {layer.error ? (
                    <span className="flex items-start gap-1 text-destructive">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {layer.error.code}: {layer.error.message}
                      </span>
                    </span>
                  ) : (
                    <span className="block min-w-0 break-words">
                      {layer.statusMessage ?? actionLabel}
                    </span>
                  )}
                </div>
              ) : null}

              {isProcessing ? (
                <div className="mt-1.5 space-y-1">
                  {clampedProgress !== null ? (
                    <>
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span className="tabular-nums">{clampedProgress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full bg-cyan-600 transition-[width] duration-300"
                          style={{ width: `${clampedProgress}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Waiting for progress update...</span>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    ETA: {layer.etaSeconds === null || layer.etaSeconds === undefined ? "estimating..." : formatEta(layer.etaSeconds)}
                  </div>
                </div>
              ) : null}

              {isReady && layer.isVisible ? (
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>Opacity</span>
                    <span className="tabular-nums">{Math.round(layer.opacity * 100)}%</span>
                  </div>
                  <Slider
                    value={[Math.round(layer.opacity * 100)]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(value) => {
                      const nextValue = Array.isArray(value) ? value[0] : value;
                      onCanopyLayerOpacityChange(
                        layer.fileName,
                        (nextValue ?? Math.round(layer.opacity * 100)) / 100,
                      );
                    }}
                    aria-label={`Set canopy opacity for ${layer.sourceName ?? layer.fileName}`}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export type { CanopyLayerItem };