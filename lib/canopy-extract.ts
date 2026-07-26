import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export const DEFAULT_CANOPY_BUFFER_KM = 20;
export const DEFAULT_CANOPY_OUTPUT = "tif" as const;

export type CanopyExtractionOutput = "tif" | "geojson" | "both";

export type CanopyExtractionRequest = {
  geometry: FeatureCollection<Geometry, GeoJsonProperties>;
  bufferKm?: number;
  output?: CanopyExtractionOutput;
  sourceFileName?: string;
};

type CanopyExtractionSuccessResponse = Record<string, unknown> | string | null;

function getCanopyExtractionEndpoint(): string {
  return process.env.NEXT_PUBLIC_CANOPY_API_URL ?? "/api/canopy/extract";
}

function sanitizeDownloadName(fileName: string): string {
  const trimmedName = fileName.trim();
  if (trimmedName.length === 0) {
    return "canopy-height-model.tif";
  }

  return trimmedName.toLowerCase().endsWith(".tif") || trimmedName.toLowerCase().endsWith(".tiff")
    ? trimmedName
    : `${trimmedName}.tif`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = sanitizeDownloadName(fileName);
  anchor.rel = "noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function submitCanopyExtractionRequest(
  request: CanopyExtractionRequest,
): Promise<CanopyExtractionSuccessResponse> {
  const response = await fetch(getCanopyExtractionEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      geojson: request.geometry,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const suffix = responseText ? `: ${responseText}` : "";
    throw new Error(`Canopy extraction request failed (${response.status})${suffix}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json() as Promise<Record<string, unknown>>;
  }

  const blob = await response.blob();
  if (blob.size > 0) {
    const downloadName = response.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]
      ? decodeURIComponent(
          response.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1] ?? "",
        )
      : request.sourceFileName ?? "canopy-height-model.tif";
    downloadBlob(blob, downloadName);
  }

  return null;
}