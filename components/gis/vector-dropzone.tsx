"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Map from "ol/Map";
import GeoJSON from "ol/format/GeoJSON";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type Feature from "ol/Feature";
import type Geometry from "ol/geom/Geometry";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style";
import { createEmpty, extend, isEmpty } from "ol/extent";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { filterVectorFiles, groupFilesByBaseName, parseVectorFile } from "@/lib/vector-import";
import { getCanopyTileUrlsForGeometry } from "@/lib/s3-canopy";

type VectorDropzoneProps = {
  map: Map | null;
  onMessage: (message: string | null) => void;
  onCanopyExtractionStart?: (fileName: string) => void;
  onCanopyExtractionComplete?: (fileName: string, tileUrls: string[]) => void;
  onCanopyExtractionError?: (fileName: string, error: string) => void;
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

export function VectorDropzone({ map, onMessage, onCanopyExtractionStart, onCanopyExtractionComplete, onCanopyExtractionError }: VectorDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const sourceRef = useRef<VectorSource | null>(null);
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const geojsonFormat = useMemo(() => new GeoJSON(), []);

  const collectFilesFromTransfer = useCallback(async (items: DataTransferItemList | null, fallbackFiles: File[]) => {
    if (!items || items.length === 0) {
      return fallbackFiles;
    }

    const collected: File[] = [];

    const readEntry = async (entry: FileSystemEntry | null | undefined): Promise<void> => {
      if (!entry) {
        return;
      }

      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => {
          fileEntry.file(resolve, reject);
        });
        collected.push(file);
        return;
      }

      if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });

        for (const childEntry of entries) {
          await readEntry(childEntry);
        }
      }
    };

    for (const item of Array.from(items)) {
      const entry = (item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntry | null;
      }).webkitGetAsEntry?.();

      if (entry) {
        await readEntry(entry);
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        collected.push(file);
      }
    }

    const filteredFiles = filterVectorFiles(collected.length > 0 ? collected : fallbackFiles);
    return filteredFiles;
  }, []);

  const importFiles = useCallback(async (files: File[]) => {
    const source = sourceRef.current;
    const mapView = map?.getView();

    if (!source || !mapView) {
      onMessage("Vector layer is not ready yet.");
      return;
    }

    const relevantFiles = filterVectorFiles(files);

    if (relevantFiles.length === 0) {
      onMessage("No supported vector files were found. Try a .zip, .shp, .geojson, .json, or .kml file or a folder containing them.");
      return;
    }

    const droppedExtent = createEmpty();
    let totalAdded = 0;
    let addedAtLeastOne = false;

    for (const fileGroup of groupFilesByBaseName(relevantFiles)) {
      try {
        const parsed = await parseVectorFile(fileGroup);
        const fileName = parsed.fileName;
        
        if (onCanopyExtractionStart) {
          onCanopyExtractionStart(fileName);
        }

        // Query S3 for canopy tiles that intersect with the shapefile
        try {
          const tileUrls = await getCanopyTileUrlsForGeometry(parsed.geojson);

          if (tileUrls.length === 0) {
            if (onCanopyExtractionError) {
              onCanopyExtractionError(fileName, "No canopy tiles found for this area");
            }
            onMessage(`${fileName}: No canopy tiles found for this area`);
          } else {
            if (onCanopyExtractionComplete) {
              onCanopyExtractionComplete(fileName, tileUrls);
            }
          }
        } catch (canopyError) {
          const message = canopyError instanceof Error ? canopyError.message : "Unknown error";
          if (onCanopyExtractionError) {
            onCanopyExtractionError(fileName, message);
          }
          onMessage(`${fileName}: Failed to load canopy tiles: ${message}`);
        }

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
        const names = fileGroup.map((file) => file.name).join(", ");
        const message = error instanceof Error ? error.message : "Unknown parsing error.";
        onMessage(`${names}: ${message}`);
      }
    }

    if (!addedAtLeastOne) {
      onMessage("No readable features were found in the selected files.");
      return;
    }

    mapView.fit(droppedExtent, {
      duration: 600,
      maxZoom: 12,
      padding: [40, 40, 40, 40],
    });

    onMessage(`Added ${totalAdded} vector feature${totalAdded === 1 ? "" : "s"}.`);
  }, [geojsonFormat, map, onMessage]);

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

      const droppedFiles = await collectFilesFromTransfer(
        event.dataTransfer?.items ?? null,
        Array.from(event.dataTransfer?.files ?? []),
      );

      if (droppedFiles.length === 0) {
        onMessage("No files were dropped.");
        return;
      }

      await importFiles(droppedFiles);
    };

    const onFileSelection = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const selectedFiles = Array.from(target.files ?? []);
      if (selectedFiles.length === 0) {
        return;
      }

      await importFiles(selectedFiles);
      target.value = "";
    };

    target.addEventListener("dragenter", onDragEnter);
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("dragleave", onDragLeave);
    target.addEventListener("drop", onDrop);
    fileInputRef.current?.addEventListener("change", onFileSelection);

    return () => {
      target.removeEventListener("dragenter", onDragEnter);
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("dragleave", onDragLeave);
      target.removeEventListener("drop", onDrop);
      fileInputRef.current?.removeEventListener("change", onFileSelection);
    };
  }, [collectFilesFromTransfer, geojsonFormat, map, onMessage, importFiles]);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.geojson,.json,.kml,.shp,.dbf,.shx,.prj,.cpg,.sbn,.sbx,.qix"
        multiple
        className="sr-only"
        onChange={(event) => {
          const target = event.currentTarget;
          const selectedFiles = Array.from(target.files ?? []);
          if (selectedFiles.length === 0) {
            return;
          }

          void importFiles(selectedFiles);
          target.value = "";
        }}
      />

      <div className="pointer-events-none absolute inset-0 z-40 transition">
        <div className="pointer-events-auto absolute right-3 top-20 md:right-5 md:top-24">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shadow-lg"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            Upload layer or folder
          </Button>
        </div>

        {isDragActive ? (
          <div className="absolute inset-6 grid place-items-center rounded-2xl border-2 border-dashed border-cyan-900/70 bg-cyan-100/70 text-cyan-950">
            <div className="flex flex-col items-center gap-3 p-4 text-center">
              <Upload className="size-8" />
              <p className="text-sm font-semibold">Drop vector files or a folder to add them on top of landcover</p>
              <p className="text-xs opacity-80">Supported: .zip, .geojson, .json, .kml, .shp, and folder bundles</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

