"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Map from "ol/Map";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import type TileLayer from "ol/layer/Tile";
import type WebGLTile from "ol/layer/WebGLTile";
import XYZ from "ol/source/XYZ";
import { getView, withHigherResolutions, withExtentCenter } from "ol/View";
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
import { createGeoTIFFLayer } from "@/lib/geotiff-layer";
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
  pixelX: number;
  pixelY: number;
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
  const [isBoundariesAndPlacesVisible, setIsBoundariesAndPlacesVisible] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
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
  const [canopyLayers, setCanopyLayers] = useState<Record<string, { tileUrls: string[]; isLoading: boolean; isVisible: boolean; layers?: WebGLTile[] }>>(
    {},
  );
  const hasPrefetchedAllYearsRef = useRef(false);

  const pmtilesBaseUrl =
    process.env.NEXT_PUBLIC_R2_PMTILES_BASE_URL ?? DEFAULT_R2_PMTILES_BASE_URL;
  const missingPmtilesUrl = !pmtilesBaseUrl;

  const onMapReady = useCallback((payload: MapCanvasReadyPayload) => {
    setMapContext({
      map: payload.map,
    });
  }, []);

  const onCanopyExtractionStart = useCallback((fileName: string) => {
    setCanopyLayers((prev) => ({
      ...prev,
      [fileName]: {
        tileUrls: [],
        isLoading: true,
        isVisible: true,
      },
    }));
    setStatusMessage(`Loading canopy tiles for ${fileName}...`);
  }, []);

  const onCanopyExtractionComplete = useCallback((fileName: string, tileUrls: string[]) => {
    setCanopyLayers((prev) => ({
      ...prev,
      [fileName]: {
        tileUrls,
        isLoading: false,
        isVisible: true,
      },
    }));

    setStatusMessage(`Loaded ${tileUrls.length} canopy tile${tileUrls.length !== 1 ? "s" : ""} for ${fileName}.`);
  }, []);

  const onCanopyExtractionError = useCallback((fileName: string, error: string) => {
    setCanopyLayers((prev) => {
      const updated = { ...prev };
      delete updated[fileName];
      return updated;
    });
    setStatusMessage(`Canopy extraction failed for ${fileName}: ${error}`);
  }, []);

  const onCanopyLayerVisibilityChange = useCallback((fileName: string, isVisible: boolean) => {
    setCanopyLayers((prev) => {
      const existing = prev[fileName];
      if (!existing) return prev;
      
      // Update visibility on all layers immediately
      if (existing.layers) {
        for (const layer of existing.layers) {
          layer.setVisible(isVisible);
        }
      }
      
      return {
        ...prev,
        [fileName]: { ...existing, isVisible },
      };
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

  // Handle creating and adding GeoTIFF layers to the map
  useEffect(() => {
    if (!mapContext.map) {
      return;
    }

    const createAndAddLayers = async () => {
      for (const [fileName, layerData] of Object.entries(canopyLayers)) {
        // If layers already exist, just update visibility
        if (layerData.layers && layerData.layers.length > 0) {
          for (const layer of layerData.layers) {
            layer.setVisible(layerData.isVisible);
          }
          continue;
        }

        // If still loading or no URLs, skip
        if (layerData.isLoading || layerData.tileUrls.length === 0) {
          continue;
        }

        // Create a layer for each tile URL
        const createdLayers: WebGLTile[] = [];
        let shouldUpdateView = true; // Update view only for the first layer
        
        for (const tileUrl of layerData.tileUrls) {
          console.log(`Creating GeoTIFF layer from tile URL: ${tileUrl}`);
          const result = await createGeoTIFFLayer(tileUrl, `${fileName}-${tileUrl.split("/").pop()}`);
          if (result && mapContext.map) {
            const { layer, source } = result;
            console.log(`Adding layer to map: ${layer.get("name")}`);
            mapContext.map.addLayer(layer);
            layer.setVisible(layerData.isVisible);
            console.log(`Layer added and visibility set to: ${layerData.isVisible}`);
            createdLayers.push(layer);

            // Update map view using GeoTIFF metadata (only for first layer)
            if (shouldUpdateView) {
              shouldUpdateView = false;
              try {
                const view = getView(source, withHigherResolutions(1), withExtentCenter());
                console.log("Setting map view from GeoTIFF source");
                mapContext.map.setView(view);
              } catch (err) {
                console.warn("Failed to set view from GeoTIFF metadata:", err);
              }
            }
          } else {
            console.warn(`Failed to create layer from ${tileUrl}`);
          }
        }

        // Update state with layer references
        if (createdLayers.length > 0) {
          setCanopyLayers((prev) => ({
            ...prev,
            [fileName]: { ...prev[fileName]!, layers: createdLayers },
          }));
        }
      }
    };

    createAndAddLayers().catch((error) => {
      console.error("Error creating GeoTIFF layers:", error);
    });

    // Cleanup: remove layers when they're deleted from state
    if (mapContext.map) {
      const existingCanopyLayers = mapContext.map
        .getLayers()
        .getArray()
        .filter((layer) => layer.get("isCanopyLayer"));

      for (const layer of existingCanopyLayers) {
        const fileName = layer.get("name");
        if (!canopyLayers[fileName]) {
          mapContext.map.removeLayer(layer);
        }
      }
    }
  }, [canopyLayers, mapContext.map]);

  useEffect(() => {
    if (!mapContext.map || !pmtilesLayer) {
      return;
    }

    let hoverUpdateFrameId: number | null = null;
    let latestPixel: [number, number] | null = null;

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
        if (hoverUpdateFrameId !== null) {
          window.cancelAnimationFrame(hoverUpdateFrameId);
          hoverUpdateFrameId = null;
        }

        latestPixel = null;

        setHoverPixelInfo(null);
        return;
      }

      const [pixelX, pixelY] = event.pixel;
      latestPixel = [pixelX, pixelY];

      setHoverPixelInfo((previous) => {
        if (!previous) {
          return previous;
        }

        if (previous.pixelX === pixelX && previous.pixelY === pixelY) {
          return previous;
        }

        return {
          ...previous,
          pixelX,
          pixelY,
        };
      });

      if (hoverUpdateFrameId !== null) {
        return;
      }

      hoverUpdateFrameId = window.requestAnimationFrame(() => {
        hoverUpdateFrameId = null;

        if (!latestPixel) {
          return;
        }

        const [nextPixelX, nextPixelY] = latestPixel;

        const pixelData = pmtilesLayer.getData([nextPixelX, nextPixelY]);
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

        const viewZoom = mapContext.map?.getView().getZoom();
        const requestedZoom = Number.isFinite(viewZoom) ? Math.round(viewZoom ?? 0) : null;
        const sourceZoom =
          requestedZoom === null || !pmtilesZoomRange
            ? requestedZoom
            : Math.max(
                pmtilesZoomRange.minZoom,
                Math.min(pmtilesZoomRange.maxZoom, requestedZoom),
              );

        setHoverPixelInfo((previous) => {
          if (
            previous &&
            previous.code === code &&
            previous.red === red &&
            previous.green === green &&
            previous.blue === blue &&
            previous.alpha === alpha &&
            previous.pixelX === nextPixelX &&
            previous.pixelY === nextPixelY &&
            previous.requestedZoom === requestedZoom &&
            previous.sourceZoom === sourceZoom
          ) {
            return previous;
          }

          return {
            code,
            red,
            green,
            blue,
            alpha,
            pixelX: nextPixelX,
            pixelY: nextPixelY,
            requestedZoom,
            sourceZoom,
          };
        });
      });
    };

    mapContext.map.on("pointermove", handlePointerMove);

    return () => {
      if (hoverUpdateFrameId !== null) {
        window.cancelAnimationFrame(hoverUpdateFrameId);
      }

      mapContext.map?.un("pointermove", handlePointerMove);
    };
  }, [isLandcoverVisible, mapContext.map, pmtilesLayer, pmtilesZoomRange, showLandcoverCodes]);

  const hoveredClass =
    hoverPixelInfo?.code !== null && hoverPixelInfo?.code !== undefined
      ? MAPBIOMAS_CLASS_LOOKUP[hoverPixelInfo.code]
      : null;
  const hoverTooltipStyle =
    hoverPixelInfo && mapContext.map
      ? (() => {
          const mapSize = mapContext.map.getSize();
          const tooltipWidth = 192;
          const tooltipHeight = 44;
          const offsetX = 16;
          const offsetY = 30;
          const left = mapSize
            ? Math.min(hoverPixelInfo.pixelX + offsetX, Math.max(12, mapSize[0] - tooltipWidth - 12))
            : hoverPixelInfo.pixelX + offsetX;
          const top = mapSize
            ? Math.min(
                Math.max(12, hoverPixelInfo.pixelY - offsetY),
                Math.max(12, mapSize[1] - tooltipHeight - 12),
              )
            : hoverPixelInfo.pixelY - offsetY;

          return { left, top };
        })()
      : null;

  return (
    <section className="relative h-[100dvh] w-full overflow-hidden bg-gradient-to-br from-cyan-50 via-sky-100 to-blue-200 text-foreground">
      <MapCanvas
        satelliteVisible={isSatelliteVisible}
        boundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
        onReady={onMapReady}
      />

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

      <VectorDropzone 
        map={mapContext.map} 
        onMessage={setStatusMessage}
        onCanopyExtractionStart={onCanopyExtractionStart}
        onCanopyExtractionComplete={onCanopyExtractionComplete}
        onCanopyExtractionError={onCanopyExtractionError}
      />

      <div className="pointer-events-none absolute inset-0 z-50">
        <div className="pointer-events-auto absolute left-3 top-3 md:left-5 md:top-5">
          <MapControls
            isSatelliteVisible={isSatelliteVisible}
            isBoundariesAndPlacesVisible={isBoundariesAndPlacesVisible}
            isLandcoverVisible={isLandcoverVisible}
            showLandcoverCodes={showLandcoverCodes}
            landcoverOpacity={landcoverOpacity}
            onSatelliteChange={setIsSatelliteVisible}
            onBoundariesAndPlacesChange={setIsBoundariesAndPlacesVisible}
            onLandcoverChange={setIsLandcoverVisible}
            onShowLandcoverCodesChange={setShowLandcoverCodes}
            onLandcoverOpacityChange={setLandcoverOpacity}
          />
        </div>

        <div className="pointer-events-auto absolute right-3 top-3 md:right-5 md:top-5">
          <Legend 
            open={isLegendOpen} 
            onOpenChange={setIsLegendOpen}
            canopyLayers={Object.entries(canopyLayers).map(([name, data]) => ({
              fileName: name,
              isLoading: data.isLoading,
              isVisible: data.isVisible,
            }))}
            onCanopyLayerVisibilityChange={onCanopyLayerVisibilityChange}
          />
        </div>

        {hoverPixelInfo &&
        hoverTooltipStyle &&
        isLandcoverVisible &&
        hoverPixelInfo.alpha > 0 &&
        hoveredClass ? (
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
        ) : null}

        {isLandcoverVisible ? (
          <div className="pointer-events-auto absolute bottom-4 left-1/2 w-full -translate-x-1/2 px-3 md:bottom-6 md:px-5">
            <div className="mx-auto w-fit">
              <TimeSlider
                year={year}
                minYear={MIN_YEAR}
                maxYear={MAX_YEAR}
                isPlaying={isPlaying}
                canAdvance={!isFrameLoading}
                isFrameLoading={isFrameLoading}
                isPreloadingYears={isPreloadingYears}
                onYearChange={setYear}
                onPlayingChange={setIsPlaying}
              />
            </div>
          </div>
        ) : null}

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