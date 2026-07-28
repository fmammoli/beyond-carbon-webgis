import ImageTile from "ol/ImageTile";
import XYZ from "ol/source/XYZ";
import { PMTiles } from "pmtiles";

import {
  LANDCOVER_FLIP_Y,
  LANDCOVER_FILE_PREFIX,
  LANDCOVER_FILE_SUFFIX,
  LANDCOVER_MAX_OVERZOOM_DELTA,
  MAX_YEAR,
  MIN_YEAR,
} from "@/lib/gis-constants";
import {
  AGB_TRANSPARENT_RAW_THRESHOLD,
  getAgbDisplayColor,
} from "@/lib/agb-legend";
import { MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP } from "@/lib/mapbiomas-colors";

export type PmtilesRenderMode = "classified" | "raw-codes" | "ylgn";

export type PmtilesArchiveOptions = {
  filePrefix?: string;
  fileSuffix?: string;
  minYear?: number;
  maxYear?: number;
  flipY?: boolean;
};

// Guaranteed transparent 1x1 GIF used when a PMTiles tile is missing/out-of-range.
const EMPTY_TILE_DATA_URI =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const BLACK_TRANSPARENCY_THRESHOLD = 8;
const WHITE_TRANSPARENCY_THRESHOLD = 240;
const BRIGHT_BACKGROUND_MIN_CHANNEL = 220;
const BRIGHT_BACKGROUND_MAX_CHROMA_DELTA = 24;
const TRANSPARENT_CLASS_IDS = new Set([0, 27, 255]);
const SORTED_CLASS_IDS = Object.keys(MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP)
  .map((value) => Number(value))
  .sort((a, b) => a - b);
const MIN_CLASS_ID = SORTED_CLASS_IDS[0] ?? 0;
const MAX_CLASS_ID = SORTED_CLASS_IDS[SORTED_CLASS_IDS.length - 1] ?? 0;
const KNOWN_CLASS_IDS = new Set(
  Object.keys(MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP).map((value) => Number(value)),
);

const archiveCache = new Map<string, PMTiles>();
export type PmtilesZoomRange = {
  minZoom: number;
  maxZoom: number;
};

const archiveHeaderPromiseCache = new Map<string, Promise<PmtilesZoomRange | null>>();
const allYearsPrefetchPromiseCache = new Map<string, Promise<void>>();
const tilePrefetchPromiseCache = new Map<string, Promise<void>>();

const DEFAULT_PMTILES_ARCHIVE_OPTIONS: Required<PmtilesArchiveOptions> = {
  filePrefix: LANDCOVER_FILE_PREFIX,
  fileSuffix: LANDCOVER_FILE_SUFFIX,
  minYear: MIN_YEAR,
  maxYear: MAX_YEAR,
  flipY: LANDCOVER_FLIP_Y,
};

export type PmtilesTileRequest = {
  z: number;
  x: number;
  y: number;
};

function resolveArchiveOptions(options?: PmtilesArchiveOptions): Required<PmtilesArchiveOptions> {
  return {
    ...DEFAULT_PMTILES_ARCHIVE_OPTIONS,
    ...options,
  };
}

function clampYear(year: number, options?: PmtilesArchiveOptions): number {
  const { minYear, maxYear } = resolveArchiveOptions(options);
  return Math.max(minYear, Math.min(maxYear, year));
}

function detectMimeType(data: Uint8Array): string {
  if (data.length > 3 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e) {
    return "image/png";
  }
  if (data.length > 2 && data[0] === 0xff && data[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    data.length > 11 &&
    String.fromCharCode(data[0], data[1], data[2], data[3]) === "RIFF" &&
    String.fromCharCode(data[8], data[9], data[10], data[11]) === "WEBP"
  ) {
    return "image/webp";
  }

  return "application/octet-stream";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function getArchiveUrl(baseUrl: string, year: number, options?: PmtilesArchiveOptions): string {
  const { filePrefix, fileSuffix } = resolveArchiveOptions(options);
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}/${filePrefix}${clampYear(year, options)}${fileSuffix}`;
}

function getArchive(baseUrl: string, year: number, options?: PmtilesArchiveOptions): PMTiles {
  const archiveUrl = getArchiveUrl(baseUrl, year, options);
  const cached = archiveCache.get(archiveUrl);

  if (cached) {
    return cached;
  }

  const created = new PMTiles(archiveUrl);
  archiveCache.set(archiveUrl, created);
  return created;
}

function getNearestKnownClassId(value: number): number | null {
  if (KNOWN_CLASS_IDS.has(value)) {
    return value;
  }

  if (SORTED_CLASS_IDS.length === 0) {
    return null;
  }

  let nearest = SORTED_CLASS_IDS[0];
  let bestDistance = Math.abs(value - nearest);

  for (let index = 1; index < SORTED_CLASS_IDS.length; index += 1) {
    const candidate = SORTED_CLASS_IDS[index];
    const distance = Math.abs(value - candidate);

    if (distance < bestDistance) {
      nearest = candidate;
      bestDistance = distance;
    }
  }

  return nearest;
}

function isBrightLowSaturationBackground(red: number, green: number, blue: number): boolean {
  const minChannel = Math.min(red, green, blue);
  if (minChannel < BRIGHT_BACKGROUND_MIN_CHANNEL) {
    return false;
  }

  const maxChannel = Math.max(red, green, blue);
  return maxChannel - minChannel <= BRIGHT_BACKGROUND_MAX_CHROMA_DELTA;
}

function getArchiveHeader(
  baseUrl: string,
  year: number,
  options?: PmtilesArchiveOptions,
): Promise<PmtilesZoomRange | null> {
  const archiveUrl = getArchiveUrl(baseUrl, year, options);
  const cachedPromise = archiveHeaderPromiseCache.get(archiveUrl);

  if (cachedPromise) {
    return cachedPromise;
  }

  const archive = getArchive(baseUrl, year, options);
  const headerPromise = archive
    .getHeader()
    .then((header) => ({
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
    }))
    .catch(() => null);

  archiveHeaderPromiseCache.set(archiveUrl, headerPromise);
  return headerPromise;
}

function clampTileRequestToZoomRange(
  z: number,
  x: number,
  y: number,
  zoomRange: PmtilesZoomRange | null,
): { z: number; x: number; y: number } | null {
  if (!zoomRange) {
    const maxIndex = Math.pow(2, z) - 1;
    if (x < 0 || y < 0 || x > maxIndex || y > maxIndex) {
      return null;
    }

    return { z, x, y };
  }

  let targetZ = z;
  let targetX = x;
  let targetY = y;

  if (targetZ > zoomRange.maxZoom) {
    const delta = targetZ - zoomRange.maxZoom;
    targetZ = zoomRange.maxZoom;
    targetX = targetX >> delta;
    targetY = targetY >> delta;
  }

  if (targetZ < zoomRange.minZoom) {
    const delta = zoomRange.minZoom - targetZ;
    targetZ = zoomRange.minZoom;
    targetX = targetX << delta;
    targetY = targetY << delta;
  }

  const maxIndex = Math.pow(2, targetZ) - 1;
  if (targetX < 0 || targetY < 0 || targetX > maxIndex || targetY > maxIndex) {
    return null;
  }

  return { z: targetZ, x: targetX, y: targetY };
}

export function getPmtilesZoomRange(
  baseUrl: string,
  year: number,
  options?: PmtilesArchiveOptions,
): Promise<PmtilesZoomRange | null> {
  return getArchiveHeader(baseUrl, year, options);
}

function maybeFlipY(z: number, y: number, options?: PmtilesArchiveOptions): number {
  const { flipY } = resolveArchiveOptions(options);
  if (!flipY) {
    return y;
  }

  const maxY = Math.pow(2, z) - 1;
  return maxY - y;
}

function parsePseudoUrl(pseudoUrl: string): { year: number; z: number; x: number; y: number } | null {
  const parts = pseudoUrl.replace("pmtiles://", "").split("/");
  if (parts.length !== 4) {
    return null;
  }

  const year = Number(parts[0]);
  const z = Number(parts[1]);
  const x = Number(parts[2]);
  const y = Number(parts[3]);

  if ([year, z, x, y].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { year, z, x, y };
}

async function createStyledTileObjectUrl(
  blob: Blob,
  renderMode: PmtilesRenderMode,
  overzoomCrop?: {
    scale: number;
    offsetX: number;
    offsetY: number;
  },
): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("Canvas 2D context is unavailable");
  }

  if (overzoomCrop && overzoomCrop.scale > 1) {
    const sourceWidth = Math.max(1, Math.floor(bitmap.width / overzoomCrop.scale));
    const sourceHeight = Math.max(1, Math.floor(bitmap.height / overzoomCrop.scale));
    const sourceX = Math.min(bitmap.width - sourceWidth, overzoomCrop.offsetX * sourceWidth);
    const sourceY = Math.min(bitmap.height - sourceHeight, overzoomCrop.offsetY * sourceHeight);

    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    context.drawImage(bitmap, 0, 0);
  }

  bitmap.close();

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  let opaquePixelCount = 0;
  let grayscalePixelCount = 0;
  let redChannelCarrierPixelCount = 0;
  let redChannelClassPixelCount = 0;

  // Detect single-band class rasters (R=G=B) before applying a class palette.
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha === 0) {
      continue;
    }

    opaquePixelCount += 1;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];

    if (Math.abs(red - green) <= 1 && Math.abs(red - blue) <= 1) {
      grayscalePixelCount += 1;
    }

    const hasKnownClassRed = KNOWN_CLASS_IDS.has(red);
    const hasClassCarrierGreen = Math.abs(green - 127) <= 1 || green <= 1 || green >= 254;
    const hasClassCarrierBlue = blue <= 1;

    if (hasClassCarrierGreen && hasClassCarrierBlue) {
      redChannelCarrierPixelCount += 1;
    }

    if (hasKnownClassRed && hasClassCarrierGreen && hasClassCarrierBlue) {
      redChannelClassPixelCount += 1;
    }
  }

  const isSingleBandClassRaster =
    opaquePixelCount > 0 && grayscalePixelCount / opaquePixelCount >= 0.98;
  const hasRedChannelCarrierPattern =
    opaquePixelCount > 0 && redChannelCarrierPixelCount / opaquePixelCount >= 0.6;
  const isRedChannelClassRaster =
    opaquePixelCount > 0 && redChannelClassPixelCount / opaquePixelCount >= 0.2;
  const canDecodeClasses =
    isSingleBandClassRaster || hasRedChannelCarrierPattern || isRedChannelClassRaster;

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];

    if (alpha === 0) {
      continue;
    }

    // Treat bright near-white pixels as nodata/background so pixels outside
    // the valid landcover footprint remain transparent instead of white.
    if (
      red >= WHITE_TRANSPARENCY_THRESHOLD &&
      green >= WHITE_TRANSPARENCY_THRESHOLD &&
      blue >= WHITE_TRANSPARENCY_THRESHOLD
    ) {
      pixels[index + 3] = 0;
      continue;
    }

    // Compression artifacts can turn white nodata into very light gray/beige.
    // Mask these bright low-saturation backgrounds as transparent as well.
    if (isBrightLowSaturationBackground(red, green, blue)) {
      pixels[index + 3] = 0;
      continue;
    }

    if (
      red <= BLACK_TRANSPARENCY_THRESHOLD &&
      green <= BLACK_TRANSPARENCY_THRESHOLD &&
      blue <= BLACK_TRANSPARENCY_THRESHOLD
    ) {
      pixels[index + 3] = 0;
      continue;
    }

    if (renderMode === "ylgn") {
      const sourceValue = canDecodeClasses
        ? red
        : Math.round((red + green + blue) / 3);

      if (sourceValue <= AGB_TRANSPARENT_RAW_THRESHOLD) {
        pixels[index + 3] = 0;
        continue;
      }

      const displayColor = getAgbDisplayColor(sourceValue);
      const parsedColor = displayColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);

      if (parsedColor) {
        pixels[index] = Number(parsedColor[1]);
        pixels[index + 1] = Number(parsedColor[2]);
        pixels[index + 2] = Number(parsedColor[3]);
      }
      pixels[index + 3] = 255;
      continue;
    }

    if (canDecodeClasses && renderMode === "raw-codes") {
      // Preserve encoded class values directly as grayscale for QA.
      pixels[index] = red;
      pixels[index + 1] = red;
      pixels[index + 2] = red;
      pixels[index + 3] = 255;
      continue;
    }

    if (canDecodeClasses) {
      if (TRANSPARENT_CLASS_IDS.has(red)) {
        pixels[index + 3] = 0;
        continue;
      }

      if (red < MIN_CLASS_ID || red > MAX_CLASS_ID) {
        // Avoid painting carrier/no-data values (e.g. 0,127,0) as valid classes.
        pixels[index + 3] = 0;
        continue;
      }

      const nearestClassId = getNearestKnownClassId(red);
      const mappedColor =
        nearestClassId !== null ? MAPBIOMAS_CLASS_COLOR_RGB_LOOKUP[nearestClassId] : undefined;

      if (mappedColor) {
        pixels[index] = mappedColor[0];
        pixels[index + 1] = mappedColor[1];
        pixels[index + 2] = mappedColor[2];
      }
    }
  }

  context.putImageData(imageData, 0, 0);

  const transparentBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
        return;
      }

      reject(new Error("Failed to encode transparent tile"));
    }, "image/png");
  });

  return URL.createObjectURL(transparentBlob);
}

let tileRequestSequence = 0;

export function createPmtilesXyzSource(
  baseUrl: string,
  year: number,
  renderMode: PmtilesRenderMode = "classified",
  options?: PmtilesArchiveOptions,
): XYZ {
  const sourceYear = clampYear(year, options);

  return new XYZ({
    crossOrigin: "anonymous",
    transition: 0,
    wrapX: false,
    tileUrlFunction: (tileCoord) => {
      if (!tileCoord) {
        return EMPTY_TILE_DATA_URI;
      }

      const z = tileCoord[0];
      const x = tileCoord[1];
      // OpenLayers provides XYZ row indexing for this source.
      const xyzY = tileCoord[2];
      const y = maybeFlipY(z, xyzY, options);
      return `pmtiles://${sourceYear}/${z}/${x}/${y}`;
    },
    tileLoadFunction: async (tile, src) => {
      const imageTile = tile as ImageTile;
      const image = imageTile.getImage() as HTMLImageElement;
      const requestId = ++tileRequestSequence;

      (imageTile as ImageTile & { __requestId?: number }).__requestId = requestId;

      const parsed = parsePseudoUrl(src);
      if (!parsed) {
        image.src = EMPTY_TILE_DATA_URI;
        return;
      }

      try {
        const archive = getArchive(baseUrl, parsed.year, options);
        const zoomRange = await getArchiveHeader(baseUrl, parsed.year, options);

        if (zoomRange && parsed.z > zoomRange.maxZoom + LANDCOVER_MAX_OVERZOOM_DELTA) {
          image.src = EMPTY_TILE_DATA_URI;
          return;
        }

        const clampedTile = clampTileRequestToZoomRange(
          parsed.z,
          parsed.x,
          parsed.y,
          zoomRange,
        );

        if (!clampedTile) {
          image.src = EMPTY_TILE_DATA_URI;
          return;
        }

        const tilePayload = await archive.getZxy(clampedTile.z, clampedTile.x, clampedTile.y);

        const activeRequestId = (imageTile as ImageTile & { __requestId?: number }).__requestId;
        if (activeRequestId !== requestId) {
          return;
        }

        if (!tilePayload?.data) {
          image.src = EMPTY_TILE_DATA_URI;
          return;
        }

        const dataBytes =
          tilePayload.data instanceof Uint8Array
            ? tilePayload.data
            : new Uint8Array(tilePayload.data);
        const mimeType = detectMimeType(dataBytes);
        const blob = new Blob([dataBytes], { type: mimeType });
        const fallbackObjectUrl = URL.createObjectURL(blob);
        let objectUrl = fallbackObjectUrl;

        const overzoomDelta = Math.max(0, parsed.z - clampedTile.z);
        const overzoomScale = Math.pow(2, overzoomDelta);
        const overzoomOffsetX =
          overzoomDelta > 0 ? ((parsed.x % overzoomScale) + overzoomScale) % overzoomScale : 0;
        const overzoomOffsetY =
          overzoomDelta > 0 ? ((parsed.y % overzoomScale) + overzoomScale) % overzoomScale : 0;

        try {
          objectUrl = await createStyledTileObjectUrl(blob, renderMode, {
            scale: overzoomScale,
            offsetX: overzoomOffsetX,
            offsetY: overzoomOffsetY,
          });
          URL.revokeObjectURL(fallbackObjectUrl);
        } catch {
          // If image processing fails, fall back to the original tile payload.
        }

        image.onload = () => URL.revokeObjectURL(objectUrl);
        image.onerror = () => URL.revokeObjectURL(objectUrl);
        image.src = objectUrl;
      } catch {
        image.src = EMPTY_TILE_DATA_URI;
      }
    },
  });
}

export function prefetchAdjacentPmtiles(
  baseUrl: string,
  year: number,
  options?: PmtilesArchiveOptions,
): void {
  const prevYear = clampYear(year - 1, options);
  const nextYear = clampYear(year + 1, options);

  [prevYear, nextYear].forEach(async (candidateYear) => {
    try {
      const archive = getArchive(baseUrl, candidateYear, options);
      await archive.getHeader();
    } catch {
      // Ignore prefetch failures: current year rendering should not be blocked.
    }
  });
}

export function prefetchAllPmtilesYears(
  baseUrl: string,
  options?: PmtilesArchiveOptions,
): Promise<void> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const resolvedArchiveOptions = resolveArchiveOptions(options);
  const cacheKey = `${normalizedBaseUrl}:${resolvedArchiveOptions.filePrefix}:${resolvedArchiveOptions.fileSuffix}:${resolvedArchiveOptions.minYear}:${resolvedArchiveOptions.maxYear}:${resolvedArchiveOptions.flipY}`;
  const cachedPromise = allYearsPrefetchPromiseCache.get(cacheKey);

  if (cachedPromise) {
    return cachedPromise;
  }

  const years = Array.from(
    { length: resolvedArchiveOptions.maxYear - resolvedArchiveOptions.minYear + 1 },
    (_, index) => resolvedArchiveOptions.minYear + index,
  );
  const maxConcurrency = 4;

  const prefetchPromise = (async () => {
    for (let index = 0; index < years.length; index += maxConcurrency) {
      const batch = years.slice(index, index + maxConcurrency);

      await Promise.all(
        batch.map(async (candidateYear) => {
          try {
            await getArchiveHeader(normalizedBaseUrl, candidateYear, options);
          } catch {
            // Ignore failures so one missing year does not block playback warmup.
          }
        }),
      );
    }
  })();

  allYearsPrefetchPromiseCache.set(cacheKey, prefetchPromise);
  return prefetchPromise;
}

async function prefetchSinglePmtilesTile(
  baseUrl: string,
  year: number,
  tileRequest: PmtilesTileRequest,
  options?: PmtilesArchiveOptions,
): Promise<void> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const z = Math.max(0, Math.round(tileRequest.z));
  const x = Math.max(0, Math.round(tileRequest.x));
  const y = Math.max(0, Math.round(tileRequest.y));
  const resolvedArchiveOptions = resolveArchiveOptions(options);
  const requestKey = `${normalizedBaseUrl}:${resolvedArchiveOptions.filePrefix}:${resolvedArchiveOptions.fileSuffix}:${resolvedArchiveOptions.minYear}:${resolvedArchiveOptions.maxYear}:${resolvedArchiveOptions.flipY}:${year}:${z}:${x}:${y}`;
  const cachedPromise = tilePrefetchPromiseCache.get(requestKey);

  if (cachedPromise) {
    return cachedPromise;
  }

  const prefetchPromise = (async () => {
    const archive = getArchive(normalizedBaseUrl, year, options);
    const zoomRange = await getArchiveHeader(normalizedBaseUrl, year, options);
    const tileY = maybeFlipY(z, y, options);
    const clampedTile = clampTileRequestToZoomRange(z, x, tileY, zoomRange);

    if (!clampedTile) {
      return;
    }

    await archive.getZxy(clampedTile.z, clampedTile.x, clampedTile.y);
  })()
    .catch(() => {
      // Best-effort prefetch only.
    })
    .then(() => undefined);

  tilePrefetchPromiseCache.set(requestKey, prefetchPromise);
  return prefetchPromise;
}

export async function prefetchViewportPmtilesYears(
  baseUrl: string,
  years: number[],
  tileRequests: PmtilesTileRequest[],
  options?: {
    maxTiles?: number;
    maxConcurrency?: number;
    archive?: PmtilesArchiveOptions;
  },
): Promise<void> {
  if (years.length === 0 || tileRequests.length === 0) {
    return;
  }

  const uniqueYears = Array.from(
    new Set(years.map((year) => clampYear(year, options?.archive))),
  );
  const uniqueTileRequests = Array.from(
    new Map(tileRequests.map((tile) => [`${tile.z}:${tile.x}:${tile.y}`, tile])).values(),
  );

  const maxTiles = Math.max(1, options?.maxTiles ?? uniqueTileRequests.length);
  const maxConcurrency = Math.max(1, options?.maxConcurrency ?? 8);
  const limitedTileRequests = uniqueTileRequests.slice(0, maxTiles);
  const tasks: Array<() => Promise<void>> = [];

  uniqueYears.forEach((year) => {
    limitedTileRequests.forEach((tileRequest) => {
      tasks.push(() => prefetchSinglePmtilesTile(baseUrl, year, tileRequest, options?.archive));
    });
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const taskIndex = cursor;
      cursor += 1;
      await tasks[taskIndex]();
    }
  });

  await Promise.all(workers);
}