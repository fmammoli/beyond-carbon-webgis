"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type Map from "ol/Map";
import GeoJSON from "ol/format/GeoJSON";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style";
import { createEmpty, extend, isEmpty } from "ol/extent";
import { Upload } from "lucide-react";

import { parseVectorFile } from "@/lib/vector-import";

type VectorDropzoneProps = {
  map: Map | null;
  onMessage: (message: string | null) => void;
};

const VECTOR_STYLE = new Style({
  stroke: new Stroke({
    color: "#ff3b30",
    width: 2,
  }),
  fill: new Fill({
    color: "rgba(255, 59, 48, 0.2)",
  }),
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: "#ff3b30" }),
    stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
  }),
});

export function VectorDropzone({ map, onMessage }: VectorDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);

  const geojsonFormat = useMemo(() => new GeoJSON(), []);

  useEffect(() => {
    if (!map || layerRef.current) {
      return;
    }

    const source = new VectorSource();
    const layer = new VectorLayer({
      source,
      style: VECTOR_STYLE,
      zIndex: 30,
    });

    sourceRef.current = source;
    layerRef.current = layer;
    map.addLayer(layer);

    return () => {
      map.removeLayer(layer);
      sourceRef.current = null;
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const target = map.getTargetElement();
    if (!target) {
      return;
    }

    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
      onMessage("Drop .zip, .geojson/.json, or .kml files to overlay features.");
    };

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
        onMessage(null);
      }
    };

    const onDrop = async (event: DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragActive(false);

      const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
      if (droppedFiles.length === 0) {
        onMessage("No files were dropped.");
        return;
      }

      const source = sourceRef.current;
      const mapView = map.getView();

      if (!source) {
        onMessage("Vector layer is not ready yet.");
        return;
      }

      const droppedExtent = createEmpty();
      let totalAdded = 0;
      let addedAtLeastOne = false;

      for (const file of droppedFiles) {
        try {
          const parsed = await parseVectorFile(file);
          const features = geojsonFormat.readFeatures(parsed.geojson, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          }) as Feature<Geometry>[];

          if (features.length === 0) {
            continue;
          }

          source.addFeatures(features);
          totalAdded += features.length;

          const featuresExtent = source.getExtent();
          if (featuresExtent && !isEmpty(featuresExtent)) {
            extend(droppedExtent, featuresExtent);
            addedAtLeastOne = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown parsing error.";
          onMessage(`${file.name}: ${message}`);
        }
      }

      if (!addedAtLeastOne) {
        onMessage("No readable features were found in the dropped files.");
        return;
      }

      mapView.fit(droppedExtent, {
        duration: 600,
        maxZoom: 12,
        padding: [40, 40, 40, 40],
      });

      onMessage(`Added ${totalAdded} vector feature${totalAdded === 1 ? "" : "s"}.`);
    };

    target.addEventListener("dragenter", onDragEnter);
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("dragleave", onDragLeave);
    target.addEventListener("drop", onDrop);

    return () => {
      target.removeEventListener("dragenter", onDragEnter);
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("dragleave", onDragLeave);
      target.removeEventListener("drop", onDrop);
    };
  }, [geojsonFormat, map, onMessage]);

  return (
    <div
      aria-hidden={!isDragActive}
      className={`pointer-events-none absolute inset-0 z-40 transition ${
        isDragActive ? "bg-cyan-400/20" : "bg-transparent"
      }`}
    >
      {isDragActive ? (
        <div className="absolute inset-6 grid place-items-center rounded-2xl border-2 border-dashed border-cyan-900/70 bg-cyan-100/70 text-cyan-950">
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <Upload className="size-8" />
            <p className="text-sm font-semibold">Drop vector files to add them on top of landcover</p>
            <p className="text-xs opacity-80">Supported: .zip, .geojson, .json, .kml</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}