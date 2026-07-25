"use client";

import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { defaults as defaultControls } from "ol/control/defaults";
import { fromLonLat } from "ol/proj";

import {
  INDONESIA_CENTER_LON_LAT,
  INDONESIA_DEFAULT_ZOOM,
} from "@/lib/gis-constants";

type MapCanvasReadyPayload = {
  map: Map;
  satelliteLayer: TileLayer<XYZ>;
};

type MapCanvasProps = {
  satelliteVisible: boolean;
  boundariesAndPlacesVisible: boolean;
  onReady: (payload: MapCanvasReadyPayload) => void;
};

const ESRI_SATELLITE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_BOUNDARIES_AND_PLACES_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

export function MapCanvas({
  satelliteVisible,
  boundariesAndPlacesVisible,
  onReady,
}: MapCanvasProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const satelliteLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const boundariesAndPlacesLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const initialSatelliteVisibleRef = useRef(satelliteVisible);
  const initialBoundariesAndPlacesVisibleRef = useRef(boundariesAndPlacesVisible);

  useEffect(() => {
    const target = mapElementRef.current;
    if (!target) {
      return;
    }

    const satelliteLayer = new TileLayer({
      source: new XYZ({
        attributions: "Esri World Imagery",
        crossOrigin: "anonymous",
        url: ESRI_SATELLITE_URL,
      }),
      visible: initialSatelliteVisibleRef.current,
      zIndex: 0,
    });

    const boundariesAndPlacesLayer = new TileLayer({
      source: new XYZ({
        attributions: "Esri World Boundaries and Places",
        crossOrigin: "anonymous",
        url: ESRI_BOUNDARIES_AND_PLACES_URL,
      }),
      visible: initialBoundariesAndPlacesVisibleRef.current,
      zIndex: 20,
    });

    satelliteLayerRef.current = satelliteLayer;
    boundariesAndPlacesLayerRef.current = boundariesAndPlacesLayer;

    const map = new Map({
      target,
      controls: defaultControls({ rotate: false }),
      layers: [satelliteLayer, boundariesAndPlacesLayer],
      view: new View({
        center: fromLonLat(INDONESIA_CENTER_LON_LAT),
        zoom: INDONESIA_DEFAULT_ZOOM,
        minZoom: 3,
        maxZoom: 19,
      }),
    });

    onReady({ map, satelliteLayer });

    return () => {
      map.setTarget(undefined);
      satelliteLayerRef.current = null;
      boundariesAndPlacesLayerRef.current = null;
    };
  }, [onReady]);

  useEffect(() => {
    satelliteLayerRef.current?.setVisible(satelliteVisible);
  }, [satelliteVisible]);

  useEffect(() => {
    boundariesAndPlacesLayerRef.current?.setVisible(boundariesAndPlacesVisible);
  }, [boundariesAndPlacesVisible]);

  return <div ref={mapElementRef} className="h-full w-full" aria-label="Map canvas" />;
}

export type { MapCanvasReadyPayload };