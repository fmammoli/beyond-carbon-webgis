"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Map from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import "ol/ol.css";

import {
  DEFAULT_LANDCOVER_OPACITY,
  DEFAULT_R2_PMTILES_BASE_URL,
  DEFAULT_YEAR,
  MAX_YEAR,
  MIN_YEAR,
  PLAY_PREFETCH_MAX_VISIBLE_TILES,
  PLAY_PREFETCH_TILE_CONCURRENCY,
  PLAY_PREFETCH_YEAR_WINDOW,
} from "@/lib/gis-constants";
import { Legend } from "@/components/gis/legend";
import { MapCanvas, type MapCanvasReadyPayload } from "@/components/gis/map-canvas";
import { MapControls } from "@/components/gis/map-controls";
import { PmtilesLayer } from "@/components/gis/pmtiles-layer";
import { TimeSlider } from "@/components/gis/time-slider";
import { VectorDropzone } from "@/components/gis/vector-dropzone";
import { MAPBIOMAS_CLASS_LOOKUP, MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP } from "@/lib/mapbiomas-colors";
import {
  getPmtilesZoomRange,
  prefetchAllPmtilesYears,
  prefetchViewportPmtilesYears,
  type PmtilesRenderMode,
  type PmtilesTileRequest,
  type PmtilesZoomRange,
} from "@/lib/pmtiles-source";

type MapContextState = {
  map: Map | null;
};

type HoverPixelInfo = {
  code: number | null;
  red: number;
  green: number;
  blue: number;
  alpha: number;
  requestedZoom: number | null;
  sourceZoom: number | null;
};

function resolveClassCodeFromRenderedRgb(red: number, green: number, blue: number): number | null {
  const tolerance = 2;

  for (const [codeText, color] of Object.entries(MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP)) {
    const [targetRed, targetGreen, targetBlue] = color;
    const isMatch =
      Math.abs(targetRed - red) <= tolerance &&
      Math.abs(targetGreen - green) <= tolerance &&
      Math.abs(targetBlue - blue) <= tolerance;

    if (isMatch) {
      return Number(codeText);
    }
  }

  return null;
}

function collectViewportTileRequests(map: Map, maxTiles: number): PmtilesTileRequest[] {
  const size = map.getSize();
  if (!size) {
    return [];
  }

  const view = map.getView();
  const projection = view.getProjection();
  const zoom = Math.max(0, Math.round(view.getZoom() ?? 0));
  const source = new XYZ({ crossOrigin: "anonymous" });
  const tileGrid = source.getTileGridForProjection(projection);

  if (!tileGrid) {
    return [];
  }

  const extent = view.calculateExtent(size);
  const tileRange = tileGrid.getTileRangeForExtentAndZ(extent, zoom);
  const collected: PmtilesTileRequest[] = [];

  for (let x = tileRange.minX; x <= tileRange.maxX; x += 1) {
    for (let y = tileRange.minY; y <= tileRange.maxY; y += 1) {
      collected.push({ z: zoom, x, y });

      if (collected.length >= maxTiles) {
        return collected;
      }
    }
  }

  return collected;
}

export default function MapContainer() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLandcoverVisible, setIsLandcoverVisible] = useState(true);
  const [showLandcoverCodes, setShowLandcoverCodes] = useState(false);
  const [landcoverOpacity, setLandcoverOpacity] = useState(DEFAULT_LANDCOVER_OPACITY);
  const [isSatelliteVisible, setIsSatelliteVisible] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const [isPreloadingYears, setIsPreloadingYears] = useState(false);
  const [hoverPixelInfo, setHoverPixelInfo] = useState<HoverPixelInfo | null>(null);
  const [pmtilesZoomRangeState, setPmtilesZoomRangeState] = useState<{
    cacheKey: string;
    range: PmtilesZoomRange | null;
  } | null>(null);
  const [pmtilesLayer, setPmtilesLayer] = useState<TileLayer<XYZ> | null>(null);
  const [mapContext, setMapContext] = useState<MapContextState>({
    map: null,
  });
  const hasPrefetchedAllYearsRef = useRef(false);

  const pmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_PMTILES_BASE_URL ?? DEFAULT_R2_PMTILES_BASE_URL;
  const missingPmtilesUrl = !pmtilesBaseUrl;

  const onMapReady = useCallback((payload: MapCanvasReadyPayload) => {
    setMapContext({
      map: payload.map,
    });
  }, []);

  const floatingMessage = useMemo(() => {
    if (missingPmtilesUrl) {
      return "Set NEXT_PUBLIC_R2_PMTILES_BASE_URL to load annual landcover PMTiles.";
    }

    return statusMessage;
  }, [missingPmtilesUrl, statusMessage]);

  const landcoverRenderMode: PmtilesRenderMode = showLandcoverCodes
    ? "raw-codes"
    : "classified";
  const pmtilesZoomRangeKey = missingPmtilesUrl ? null : `${pmtilesBaseUrl}:${year}`;
  const pmtilesZoomRange =
    pmtilesZoomRangeKey && pmtilesZoomRangeState?.cacheKey === pmtilesZoomRangeKey
      ? pmtilesZoomRangeState.range
      : null;

  useEffect(() => {
    if (!pmtilesZoomRangeKey) {
      return;
    }

    let isCancelled = false;

    getPmtilesZoomRange(pmtilesBaseUrl, year)
      .then((range) => {
        if (isCancelled) {
          return;
        }

        setPmtilesZoomRangeState({ cacheKey: pmtilesZoomRangeKey, range });
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setPmtilesZoomRangeState({ cacheKey: pmtilesZoomRangeKey, range: null });
      });

    return () => {
      isCancelled = true;
    };
  }, [pmtilesBaseUrl, pmtilesZoomRangeKey, year]);

  useEffect(() => {
    if (!isPlaying || missingPmtilesUrl || hasPrefetchedAllYearsRef.current) {
      return;
    }

    hasPrefetchedAllYearsRef.current = true;
    setIsPreloadingYears(true);

    let isCancelled = false;

    prefetchAllPmtilesYears(pmtilesBaseUrl)
      .catch(() => {
        // Warmup is best-effort and should never break playback.
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPreloadingYears(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isPlaying, missingPmtilesUrl, pmtilesBaseUrl]);

  useEffect(() => {
    if (!isPlaying || missingPmtilesUrl || !mapContext.map || !isLandcoverVisible) {
      return;
    }

    const minPrefetchYear = Math.max(MIN_YEAR, year - PLAY_PREFETCH_YEAR_WINDOW);
    const maxPrefetchYear = Math.min(MAX_YEAR, year + PLAY_PREFETCH_YEAR_WINDOW);
    const yearsToPrefetch: number[] = [];

    for (let candidateYear = minPrefetchYear; candidateYear <= maxPrefetchYear; candidateYear += 1) {
      yearsToPrefetch.push(candidateYear);
    }

    const tileRequests = collectViewportTileRequests(
      mapContext.map,
      PLAY_PREFETCH_MAX_VISIBLE_TILES,
    );

    void prefetchViewportPmtilesYears(pmtilesBaseUrl, yearsToPrefetch, tileRequests, {
      maxTiles: PLAY_PREFETCH_MAX_VISIBLE_TILES,
      maxConcurrency: PLAY_PREFETCH_TILE_CONCURRENCY,
    });
  }, [
    isLandcoverVisible,
    isPlaying,
    mapContext.map,
    missingPmtilesUrl,
    pmtilesBaseUrl,
    year,
  ]);

  useEffect(() => {
    if (!mapContext.map || !pmtilesLayer) {
      return;
    }

    const readPixelComponent = (
      pixelData: Uint8ClampedArray | Uint8Array | Float32Array | DataView,
      index: number,
      fallback: number,
    ): number => {
      if (pixelData instanceof DataView) {
        return pixelData.byteLength > index ? pixelData.getUint8(index) : fallback;
      }

      return pixelData.length > index ? Number(pixelData[index]) : fallback;
    };

    const handlePointerMove = (
      event: MapBrowserEvent<PointerEvent | KeyboardEvent | WheelEvent>,
    ) => {
      if (event.dragging || !isLandcoverVisible) {
        setHoverPixelInfo(null);
        return;
      }

      const pixelData = pmtilesLayer.getData(event.pixel);
      if (!pixelData || pixelData.byteLength === 0) {
        setHoverPixelInfo(null);
        return;
      }

      const red = readPixelComponent(pixelData, 0, 0);
      const green = readPixelComponent(pixelData, 1, red);
      const blue = readPixelComponent(pixelData, 2, red);
      const alpha = readPixelComponent(pixelData, 3, 255);

      const code =
        alpha === 0
          ? null
          : showLandcoverCodes
            ? red
            : resolveClassCodeFromRenderedRgb(red, green, blue);

      const viewZoom = event.map.getView().getZoom();
      const requestedZoom = Number.isFinite(viewZoom) ? Math.round(viewZoom ?? 0) : null;
      const sourceZoom =
        requestedZoom === null || !pmtilesZoomRange
          ? requestedZoom
          : Math.max(pmtilesZoomRange.minZoom, Math.min(pmtilesZoomRange.maxZoom, requestedZoom));

      setHoverPixelInfo((previous) => {
        if (
          previous &&
          previous.code === code &&
          previous.red === red &&
          previous.green === green &&
          previous.blue === blue &&
          previous.alpha === alpha &&
          previous.requestedZoom === requestedZoom &&
          previous.sourceZoom === sourceZoom
        ) {
          return previous;
        }

        return { code, red, green, blue, alpha, requestedZoom, sourceZoom };
      });
    };

    mapContext.map.on("pointermove", handlePointerMove);

    return () => {
      mapContext.map?.un("pointermove", handlePointerMove);
    };
  }, [isLandcoverVisible, mapContext.map, pmtilesLayer, pmtilesZoomRange, showLandcoverCodes]);

  const hoveredClass =
    hoverPixelInfo?.code !== null && hoverPixelInfo?.code !== undefined
      ? MAPBIOMAS_CLASS_LOOKUP[hoverPixelInfo.code]
      : null;

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden bg-gradient-to-br from-cyan-50 via-sky-100 to-blue-200 text-foreground">
      <MapCanvas satelliteVisible={isSatelliteVisible} onReady={onMapReady} />

      {!missingPmtilesUrl ? (
        <PmtilesLayer
          map={mapContext.map}
          year={year}
          visible={isLandcoverVisible}
          opacity={landcoverOpacity}
          renderMode={landcoverRenderMode}
          baseUrl={pmtilesBaseUrl}
          onLayerReady={setPmtilesLayer}
          onFrameLoadingChange={setIsFrameLoading}
        />
      ) : null}

      <VectorDropzone map={mapContext.map} onMessage={setStatusMessage} />

      <div className="pointer-events-none absolute inset-0 z-50">
        <div className="pointer-events-auto absolute left-3 top-3 md:left-5 md:top-5">
          <MapControls
            isSatelliteVisible={isSatelliteVisible}
            isLandcoverVisible={isLandcoverVisible}
            showLandcoverCodes={showLandcoverCodes}
            landcoverOpacity={landcoverOpacity}
            onSatelliteChange={setIsSatelliteVisible}
            onLandcoverChange={setIsLandcoverVisible}
            onShowLandcoverCodesChange={setShowLandcoverCodes}
            onLandcoverOpacityChange={setLandcoverOpacity}
          />
        </div>

        <div className="pointer-events-auto absolute right-3 top-3 md:right-5 md:top-5">
          <Legend open={isLegendOpen} onOpenChange={setIsLegendOpen} />
        </div>

        <div className="pointer-events-auto absolute bottom-4 left-1/2 w-full -translate-x-1/2 px-3 md:bottom-6 md:px-5">
          <div className="mx-auto w-fit">
            <TimeSlider
              year={year}
              minYear={MIN_YEAR}
              maxYear={MAX_YEAR}
              isPlaying={isPlaying}
              canAdvance={!isFrameLoading}
              isPreloadingYears={isPreloadingYears}
              onYearChange={setYear}
              onPlayingChange={setIsPlaying}
            />
          </div>
        </div>

        {hoverPixelInfo && mapContext.map && pmtilesLayer && isLandcoverVisible ? (
          <div className="pointer-events-none absolute bottom-28 right-3 w-[min(92vw,22rem)] rounded-xl border border-white/30 bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-sm md:bottom-36 md:right-5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Pixel Inspector</span>
              {showLandcoverCodes ? (
                <span className="text-[11px] text-emerald-200">Raw-code mode</span>
              ) : (
                <span className="text-[11px] text-amber-200">Classified mode</span>
              )}
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
              <span className="font-mono tabular-nums">
                {hoverPixelInfo.requestedZoom ?? "-"}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>Source z used</span>
              <span className="font-mono tabular-nums">
                {hoverPixelInfo.sourceZoom ?? "-"}
              </span>
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
            {!showLandcoverCodes ? (
              <div className="mt-2 text-[11px] text-amber-100/90">
                Enable Raw Pixel Codes for codification QA.
              </div>
            ) : null}
          </div>
        ) : null}

        {floatingMessage ? (
          <div className="pointer-events-none absolute bottom-28 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg md:bottom-36">
            {floatingMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}