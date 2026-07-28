"use client";

import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import TileLayer from "ol/layer/Tile";
import type XYZ from "ol/source/XYZ";

import {
  createPmtilesXyzSource,
  prefetchAdjacentPmtiles,
  type PmtilesRenderMode,
} from "@/lib/pmtiles-source";

type PmtilesLayerProps = {
  map: OlMap | null;
  year: number;
  visible: boolean;
  opacity: number;
  renderMode: PmtilesRenderMode;
  baseUrl: string;
  prefetchNeighbors?: boolean;
  onLayerReady?: (layer: TileLayer<XYZ> | null) => void;
  onFrameLoadingChange?: (loading: boolean) => void;
  onYearFrameReady?: (readyYear: number) => void;
};

export function PmtilesLayer({
  map,
  year,
  visible,
  opacity,
  renderMode,
  baseUrl,
  prefetchNeighbors = true,
  onLayerReady,
  onFrameLoadingChange,
  onYearFrameReady,
}: PmtilesLayerProps) {
  const activeLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const stagingLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const sourceCacheRef = useRef(new globalThis.Map<string, XYZ>());
  const transitionTokenRef = useRef(0);

  const getCacheKey = (targetYear: number, mode: PmtilesRenderMode): string => `${targetYear}:${mode}`;

  useEffect(() => {
    if (!map || !baseUrl || activeLayerRef.current) {
      return;
    }

    const source = createPmtilesXyzSource(baseUrl, year, renderMode);
    const sourceCache = sourceCacheRef.current;
    sourceCache.set(getCacheKey(year, renderMode), source);

    const layer = new TileLayer({
      source,
      visible,
      opacity,
      zIndex: 10,
    });

    activeLayerRef.current = layer;
    onLayerReady?.(layer);
    map.addLayer(layer);
    if (prefetchNeighbors) {
      prefetchAdjacentPmtiles(baseUrl, year);
    }

    return () => {
      transitionTokenRef.current += 1;

      if (activeLayerRef.current) {
        map.removeLayer(activeLayerRef.current);
      }

      if (stagingLayerRef.current) {
        map.removeLayer(stagingLayerRef.current);
      }

      activeLayerRef.current = null;
      stagingLayerRef.current = null;
      onLayerReady?.(null);
      onFrameLoadingChange?.(false);
      sourceCache.clear();
    };
  }, [
    baseUrl,
    map,
    onFrameLoadingChange,
    onLayerReady,
    opacity,
    prefetchNeighbors,
    renderMode,
    visible,
    year,
  ]);

  useEffect(() => {
    const activeLayer = activeLayerRef.current;
    if (!activeLayer || !baseUrl || !map) {
      return;
    }

    const cacheKey = getCacheKey(year, renderMode);
    const cachedSource = sourceCacheRef.current.get(cacheKey);
    const source = cachedSource ?? createPmtilesXyzSource(baseUrl, year, renderMode);

    if (!cachedSource) {
      sourceCacheRef.current.set(cacheKey, source);
    }

    if (activeLayer.getSource() === source) {
      if (prefetchNeighbors) {
        prefetchAdjacentPmtiles(baseUrl, year);
      }
      onYearFrameReady?.(year);
      return;
    }

    if (!visible) {
      activeLayer.setSource(source);
      onFrameLoadingChange?.(false);
      onYearFrameReady?.(year);
      if (prefetchNeighbors) {
        prefetchAdjacentPmtiles(baseUrl, year);
      }
      return;
    }

    const transitionToken = transitionTokenRef.current + 1;
    transitionTokenRef.current = transitionToken;

    if (stagingLayerRef.current) {
      map.removeLayer(stagingLayerRef.current);
      stagingLayerRef.current = null;
    }

    const stagingLayer = new TileLayer({
      source,
      visible,
      // Keep incoming frame fully hidden until it is ready to avoid dark fade artifacts.
      opacity: 0,
      zIndex: 11,
    });

    stagingLayerRef.current = stagingLayer;
    map.addLayer(stagingLayer);
    onFrameLoadingChange?.(true);

    let didSwap = false;
    let startedTileCount = 0;
    let completedTileCount = 0;
    let successfulTileCount = 0;

    const cleanupListeners = () => {
      source.un("tileloadstart", handleTileLoadStart);
      source.un("tileloadend", handleTileLoadEnd);
      source.un("tileloaderror", handleTileLoadError);
    };

    const finalizeSwap = () => {
      if (didSwap || transitionTokenRef.current !== transitionToken) {
        return;
      }

      didSwap = true;
      cleanupListeners();

      const previousActiveLayer = activeLayerRef.current;
      const currentStagingLayer = stagingLayerRef.current;

      if (!currentStagingLayer) {
        onFrameLoadingChange?.(false);
        return;
      }

      currentStagingLayer.setOpacity(opacity);
      currentStagingLayer.setZIndex(10);
      activeLayerRef.current = currentStagingLayer;
      stagingLayerRef.current = null;

      if (previousActiveLayer) {
        map.removeLayer(previousActiveLayer);
      }

      onLayerReady?.(currentStagingLayer);
      onFrameLoadingChange?.(false);
      onYearFrameReady?.(year);
      if (prefetchNeighbors) {
        prefetchAdjacentPmtiles(baseUrl, year);
      }
    };

    const maybeFinalizeSwap = () => {
      const hasCompletedAllStartedTiles =
        startedTileCount > 0 && completedTileCount >= startedTileCount;

      if (successfulTileCount > 0 && hasCompletedAllStartedTiles) {
        finalizeSwap();
      }
    };

    const handleTileLoadStart = () => {
      startedTileCount += 1;
    };

    const handleTileLoadEnd = () => {
      completedTileCount += 1;
      successfulTileCount += 1;
      maybeFinalizeSwap();
    };

    const handleTileLoadError = () => {
      completedTileCount += 1;
      maybeFinalizeSwap();
    };

    source.on("tileloadstart", handleTileLoadStart);
    source.on("tileloadend", handleTileLoadEnd);
    source.on("tileloaderror", handleTileLoadError);

    // Cached tiles can render without emitting tile load events, so probe once
    // shortly after staging and complete the swap if no loads were reported.
    const cachedTileProbeTimer = window.setTimeout(() => {
      if (startedTileCount === 0) {
        finalizeSwap();
      }
    }, 250);

    const fallbackTimer = window.setTimeout(() => {
      // Only force a swap if at least one tile rendered; otherwise keep current frame.
      if (successfulTileCount > 0) {
        finalizeSwap();
        return;
      }

      cleanupListeners();
      onFrameLoadingChange?.(false);
      if (stagingLayerRef.current) {
        map.removeLayer(stagingLayerRef.current);
        stagingLayerRef.current = null;
      }
    }, 8000);

    return () => {
      window.clearTimeout(cachedTileProbeTimer);
      window.clearTimeout(fallbackTimer);

      if (!didSwap) {
        cleanupListeners();
      }
    };
  }, [
    baseUrl,
    map,
    onFrameLoadingChange,
    onLayerReady,
    onYearFrameReady,
    opacity,
    prefetchNeighbors,
    renderMode,
    visible,
    year,
  ]);

  useEffect(() => {
    activeLayerRef.current?.setVisible(visible);
    stagingLayerRef.current?.setVisible(visible);

    if (!visible) {
      onFrameLoadingChange?.(false);
    }
  }, [onFrameLoadingChange, visible]);

  useEffect(() => {
    activeLayerRef.current?.setOpacity(opacity);

    // Staging layer stays hidden while preloading; it is revealed only on finalized swap.
    if (stagingLayerRef.current) {
      stagingLayerRef.current.setOpacity(0);
    }
  }, [opacity]);

  return null;
}