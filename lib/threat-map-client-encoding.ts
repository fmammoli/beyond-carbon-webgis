import JSZip from "jszip";

import type { ThreatMapArtifactDownloadResult } from "@/lib/threat-map";

type TarEntry = {
  path: string;
  bytes: Uint8Array;
};

type YearFrameEntry = {
  year: number;
  path: string;
  blob: Blob;
};

export type ThreatMapBoundaryFrame = {
  year: number;
  path: string;
  blob: Blob;
};

export type ThreatMapFramesManifest = {
  width?: number;
  height?: number;
  fps?: number;
  frameDurationSeconds?: number;
  yearStart?: number;
  yearEnd?: number;
  framePattern?: string;
  frameFiles?: string[];
  frames?: Array<{ year?: number; file?: string; path?: string }>;
};

export type ThreatMapEncodingProgress = {
  stage: "extracting" | "parsing_manifest" | "encoding";
  completed: number;
  total: number;
  message: string;
};

export type ProcessThreatMapArtifactResult = {
  manifest: ThreatMapFramesManifest | null;
  frames: Array<{ year: number; path: string }>;
  boundaryFrames: {
    first: ThreatMapBoundaryFrame;
    last: ThreatMapBoundaryFrame;
  };
  encodedMp4Blob: Blob;
  warnings: string[];
};

function pickBoundaryFrames(frames: YearFrameEntry[]): { first: YearFrameEntry; last: YearFrameEntry } {
  if (frames.length === 0) {
    throw new Error("No frame images were found in the artifact.");
  }

  const sorted = [...frames].sort((a, b) => a.year - b.year || a.path.localeCompare(b.path));
  return {
    first: sorted[0]!,
    last: sorted[sorted.length - 1]!,
  };
}

function decodeTarString(bytes: Uint8Array, start: number, length: number): string {
  const segment = bytes.slice(start, start + length);
  const text = new TextDecoder().decode(segment);
  return text.replace(/\0.*$/, "").trim();
}

function parseTarSize(bytes: Uint8Array): number {
  const raw = decodeTarString(bytes, 124, 12).replace(/\0/g, "").trim();
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseTarEntries(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);

    // End of archive marker: 512 zero bytes, often repeated twice.
    const isEmptyHeader = header.every((value) => value === 0);
    if (isEmptyHeader) {
      break;
    }

    const fileName = decodeTarString(header, 0, 100);
    const prefix = decodeTarString(header, 345, 155);
    const fullPath = prefix ? `${prefix}/${fileName}` : fileName;
    const size = parseTarSize(header);
    const typeFlag = decodeTarString(header, 156, 1);

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (dataEnd > bytes.length) {
      throw new Error("Corrupted tar archive: entry extends beyond archive bounds.");
    }

    if (typeFlag !== "5" && fullPath && !fullPath.endsWith("/")) {
      entries.push({
        path: fullPath,
        bytes: bytes.slice(dataStart, dataEnd),
      });
    }

    const paddedEntrySize = Math.ceil(size / 512) * 512;
    offset = dataStart + paddedEntrySize;
  }

  return entries;
}

function toBlobSafeBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    // Normalize to an ArrayBuffer-backed view so BlobPart typing stays compatible across TS lib targets.
    const blobSafeBytes = toBlobSafeBytes(input);
    const stream = new Blob([blobSafeBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    const decompressed = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressed);
  }

  throw new Error("Gzip decompression is not available in this browser.");
}

async function unpackTarGz(blob: Blob): Promise<TarEntry[]> {
  const compressedBytes = new Uint8Array(await blob.arrayBuffer());
  const tarBytes = await gunzipBytes(compressedBytes);
  return parseTarEntries(tarBytes);
}

async function unpackZip(blob: Blob): Promise<TarEntry[]> {
  const archive = await JSZip.loadAsync(blob);
  const entries: TarEntry[] = [];

  const promises = Object.values(archive.files)
    .filter((entry) => !entry.dir)
    .map(async (entry) => {
      const bytes = await entry.async("uint8array");
      entries.push({ path: entry.name, bytes });
    });

  await Promise.all(promises);
  return entries;
}

function resolveManifest(entries: TarEntry[]): ThreatMapFramesManifest | null {
  const manifestEntry = entries.find((entry) => entry.path.toLowerCase().endsWith("manifest.json"));
  if (!manifestEntry) {
    return null;
  }

  const json = new TextDecoder().decode(manifestEntry.bytes);
  const parsed = JSON.parse(json) as unknown;

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed as ThreatMapFramesManifest;
}

function normalizeFramePath(pathValue: string): string {
  return pathValue.replace(/^\.\//, "").replace(/^\//, "");
}

function parseYearFromPath(pathValue: string): number | null {
  const match = pathValue.match(/(19\d{2}|20\d{2})/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveFramePathList(entries: TarEntry[], manifest: ThreatMapFramesManifest | null): YearFrameEntry[] {
  const entryMap = new Map(entries.map((entry) => [normalizeFramePath(entry.path), entry]));

  const fromManifest: YearFrameEntry[] = [];
  if (manifest?.frames && Array.isArray(manifest.frames)) {
    for (const item of manifest.frames) {
      const filePath = typeof item.file === "string"
        ? item.file
        : typeof item.path === "string"
          ? item.path
          : null;
      if (!filePath) {
        continue;
      }

      const normalizedPath = normalizeFramePath(filePath);
      const matchedEntry = entryMap.get(normalizedPath);
      if (!matchedEntry) {
        continue;
      }

      const inferredYear = typeof item.year === "number" ? item.year : parseYearFromPath(normalizedPath);
      if (!inferredYear) {
        continue;
      }

      fromManifest.push({
        year: inferredYear,
        path: matchedEntry.path,
        blob: new Blob([toBlobSafeBytes(matchedEntry.bytes)], { type: "image/png" }),
      });
    }
  }

  if (fromManifest.length > 0) {
    return fromManifest.sort((a, b) => a.year - b.year || a.path.localeCompare(b.path));
  }

  const candidateEntries = entries.filter((entry) => {
    const lowerPath = entry.path.toLowerCase();
    return lowerPath.endsWith(".png") || lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg") || lowerPath.endsWith(".webp");
  });

  const fallbackFrames = candidateEntries
    .map((entry) => {
      const year = parseYearFromPath(entry.path);
      return year
        ? {
            year,
            path: entry.path,
            blob: new Blob([toBlobSafeBytes(entry.bytes)], { type: "image/png" }),
          }
        : null;
    })
    .filter((item): item is YearFrameEntry => item !== null)
    .sort((a, b) => a.year - b.year || a.path.localeCompare(b.path));

  return fallbackFrames;
}

function resolveFrameDurationSeconds(manifest: ThreatMapFramesManifest | null): number {
  if (manifest?.frameDurationSeconds && Number.isFinite(manifest.frameDurationSeconds) && manifest.frameDurationSeconds > 0) {
    return manifest.frameDurationSeconds;
  }

  if (manifest?.fps && Number.isFinite(manifest.fps) && manifest.fps > 0) {
    return 1 / manifest.fps;
  }

  return 1;
}

function drawBitmapContained(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
): void {
  const scale = Math.min(targetWidth / bitmap.width, targetHeight / bitmap.height);
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
  const offsetX = Math.floor((targetWidth - drawWidth) / 2);
  const offsetY = Math.floor((targetHeight - drawHeight) / 2);

  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
}

async function encodeFramesToMp4(
  frames: YearFrameEntry[],
  manifest: ThreatMapFramesManifest | null,
  onProgress?: (progress: ThreatMapEncodingProgress) => void,
): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error("No frame images were found in the artifact.");
  }

  onProgress?.({
    stage: "encoding",
    completed: 0,
    total: frames.length,
    message: "Initializing MP4 encoder",
  });

  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    getFirstEncodableVideoCodec,
  } = await import("mediabunny");

  const firstBitmap = await createImageBitmap(frames[0].blob);
  const width = Math.max(1, Math.floor(firstBitmap.width));
  const height = Math.max(1, Math.floor(firstBitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    firstBitmap.close();
    throw new Error("Failed to initialize canvas context for MP4 encoding.");
  }

  context.imageSmoothingEnabled = false;

  const outputFormat = new Mp4OutputFormat();
  const selectedCodec = await getFirstEncodableVideoCodec(outputFormat.getSupportedVideoCodecs(), {
    width,
    height,
  });

  if (!selectedCodec) {
    firstBitmap.close();
    throw new Error("This browser cannot encode MP4 video for Threat Map frames.");
  }

  const target = new BufferTarget();
  const output = new Output({
    format: outputFormat,
    target,
  });

  const videoSource = new CanvasSource(canvas, {
    codec: selectedCodec,
    bitrate: QUALITY_HIGH,
  });

  output.addVideoTrack(videoSource);
  await output.start();

  const frameDurationSeconds = resolveFrameDurationSeconds(manifest);
  let timestampSeconds = 0;

  drawBitmapContained(context, firstBitmap, width, height);
  firstBitmap.close();
  await videoSource.add(timestampSeconds, frameDurationSeconds, { keyFrame: true });
  timestampSeconds += frameDurationSeconds;

  onProgress?.({
    stage: "encoding",
    completed: 1,
    total: frames.length,
    message: `Encoded 1/${frames.length} frames`,
  });

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    const bitmap = await createImageBitmap(frame.blob);
    drawBitmapContained(context, bitmap, width, height);
    bitmap.close();

    await videoSource.add(timestampSeconds, frameDurationSeconds, { keyFrame: true });
    timestampSeconds += frameDurationSeconds;

    onProgress?.({
      stage: "encoding",
      completed: index + 1,
      total: frames.length,
      message: `Encoded ${index + 1}/${frames.length} frames`,
    });
  }

  videoSource.close();
  await output.finalize();

  if (!target.buffer) {
    throw new Error("Threat map frame encoding finished without an output buffer.");
  }

  return new Blob([target.buffer], { type: "video/mp4" });
}

type WorkerFramePayload = {
  year: number;
  path: string;
  mimeType: string;
  buffer: ArrayBuffer;
};

type WorkerEncodeRequest = {
  type: "encodeArtifact";
  requestId: string;
  artifactType: "frames_tar_gz" | "zip";
  artifactBuffer: ArrayBuffer;
};

type WorkerProgressMessage = {
  type: "progress";
  requestId: string;
  stage: "extracting" | "parsing_manifest" | "encoding";
  completed: number;
  total: number;
  message: string;
};

type WorkerDoneMessage = {
  type: "done";
  requestId: string;
  mp4Buffer: ArrayBuffer;
  manifest: ThreatMapFramesManifest | null;
  frames: Array<{ year: number; path: string }>;
  boundaryFrames: {
    first: { year: number; path: string; mimeType: string; buffer: ArrayBuffer };
    last: { year: number; path: string; mimeType: string; buffer: ArrayBuffer };
  };
  warnings: string[];
};

type WorkerErrorMessage = {
  type: "error";
  requestId: string;
  error: string;
};

type WorkerResponseMessage = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage;

function isWorkerEncodableArtifactType(
  artifactType: ThreatMapArtifactDownloadResult["artifactType"],
): artifactType is "frames_tar_gz" | "zip" {
  return artifactType === "frames_tar_gz" || artifactType === "zip";
}

function canUseThreatMapEncodingWorker(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

async function encodeFramesToMp4WithWorker(
  artifact: ThreatMapArtifactDownloadResult,
  onProgress?: (progress: ThreatMapEncodingProgress) => void,
): Promise<ProcessThreatMapArtifactResult> {
  const worker = new Worker(new URL("./workers/threat-map-encoding.worker.ts", import.meta.url), {
    type: "module",
  });

  const requestId = `threat-map-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const artifactBuffer = await artifact.blob.arrayBuffer();
    const transferList = [artifactBuffer];

    if (!isWorkerEncodableArtifactType(artifact.artifactType)) {
      throw new Error("Threat map worker only supports archive artifacts.");
    }

    const requestMessage: WorkerEncodeRequest = {
      type: "encodeArtifact",
      requestId,
      artifactType: artifact.artifactType,
      artifactBuffer,
    };

    const processed = await new Promise<ProcessThreatMapArtifactResult>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<WorkerResponseMessage>) => {
        const message = event.data;
        if (!message || message.requestId !== requestId) {
          return;
        }

        if (message.type === "progress") {
          onProgress?.({
            stage: message.stage,
            completed: message.completed,
            total: message.total,
            message: message.message,
          });
          return;
        }

        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);

        if (message.type === "error") {
          reject(new Error(message.error));
          return;
        }

        resolve({
          manifest: message.manifest,
          frames: message.frames,
          boundaryFrames: {
            first: {
              year: message.boundaryFrames.first.year,
              path: message.boundaryFrames.first.path,
              blob: new Blob([message.boundaryFrames.first.buffer], {
                type: message.boundaryFrames.first.mimeType,
              }),
            },
            last: {
              year: message.boundaryFrames.last.year,
              path: message.boundaryFrames.last.path,
              blob: new Blob([message.boundaryFrames.last.buffer], {
                type: message.boundaryFrames.last.mimeType,
              }),
            },
          },
          encodedMp4Blob: new Blob([message.mp4Buffer], { type: "video/mp4" }),
          warnings: message.warnings,
        });
      };

      const handleError = (event: ErrorEvent) => {
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        reject(new Error(event.message || "Threat map encoding worker crashed."));
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);
      worker.postMessage(requestMessage, transferList);
    });

    return processed;
  } finally {
    worker.terminate();
  }
}

export async function processThreatMapDownloadedArtifact(
  artifact: ThreatMapArtifactDownloadResult,
  options?: {
    onProgress?: (progress: ThreatMapEncodingProgress) => void;
    useWorker?: boolean;
  },
): Promise<ProcessThreatMapArtifactResult> {
  if (artifact.artifactType === "mp4") {
    throw new Error("Client-side frame processing is not needed for MP4 artifacts.");
  }

  options?.onProgress?.({
    stage: "extracting",
    completed: 0,
    total: 1,
    message: "Extracting archive",
  });

  const entries = artifact.artifactType === "zip"
    ? await unpackZip(artifact.blob)
    : await unpackTarGz(artifact.blob);

  options?.onProgress?.({
    stage: "parsing_manifest",
    completed: 1,
    total: 1,
    message: "Reading manifest.json",
  });

  const manifest = resolveManifest(entries);
  const frameEntries = resolveFramePathList(entries, manifest);

  if (frameEntries.length === 0) {
    throw new Error("No renderable frame images were found in the threat map artifact.");
  }

  const warnings: string[] = [];
  if (artifact.artifactType === "zip") {
    warnings.push("Server returned ZIP fallback output. Frames were processed client-side.");
  }

  const shouldUseWorker = options?.useWorker !== false && canUseThreatMapEncodingWorker();
  if (shouldUseWorker) {
    try {
      const workerResult = await encodeFramesToMp4WithWorker(artifact, options?.onProgress);
      return workerResult;
    } catch {
      warnings.push("Worker extraction/encoding failed; retried on main thread.");
    }
  }

  const encodedMp4Blob = await encodeFramesToMp4(frameEntries, manifest, options?.onProgress);
  const boundaryFrames = pickBoundaryFrames(frameEntries);

  return {
    manifest,
    frames: frameEntries.map((entry) => ({ year: entry.year, path: entry.path })),
    boundaryFrames: {
      first: {
        year: boundaryFrames.first.year,
        path: boundaryFrames.first.path,
        blob: boundaryFrames.first.blob,
      },
      last: {
        year: boundaryFrames.last.year,
        path: boundaryFrames.last.path,
        blob: boundaryFrames.last.blob,
      },
    },
    encodedMp4Blob,
    warnings,
  };
}
