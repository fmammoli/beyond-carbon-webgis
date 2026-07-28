import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import JSZip from "jszip";

type ThreatMapFramesManifest = {
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

type TarEntry = {
  path: string;
  bytes: Uint8Array;
};

type FrameEntry = {
  year: number;
  path: string;
  bytes: Uint8Array;
};

type EncodeRequestMessage = {
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

type WorkerPostMessage = (message: unknown, transfer?: Transferable[]) => void;

const workerPostMessage: WorkerPostMessage = (message, transfer) => {
  // TS config uses DOM libs, so `self.postMessage` is typed like Window.postMessage.
  // This shim keeps worker transfer-list usage type-safe in this repo.
  (self as unknown as { postMessage: WorkerPostMessage }).postMessage(message, transfer);
};

function toArrayBuffer(value: ArrayBufferLike): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value;
  }

  const copied = new Uint8Array(value.byteLength);
  copied.set(new Uint8Array(value));
  return copied.buffer;
}

function toBlobFromUint8Array(bytes: Uint8Array, type: string): Blob {
  return new Blob([toArrayBuffer(bytes.buffer)], { type });
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

function postProgress(requestId: string, completed: number, total: number, message: string): void {
  const payload: WorkerProgressMessage = {
    type: "progress",
    requestId,
    stage: "encoding",
    completed,
    total,
    message,
  };

  workerPostMessage(payload);
}

function postStageProgress(
  requestId: string,
  stage: WorkerProgressMessage["stage"],
  completed: number,
  total: number,
  message: string,
): void {
  const payload: WorkerProgressMessage = {
    type: "progress",
    requestId,
    stage,
    completed,
    total,
    message,
  };

  workerPostMessage(payload);
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

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const stream = toBlobFromUint8Array(input, "application/gzip")
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const decompressed = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressed);
  }

  throw new Error("Gzip decompression is not available in this browser.");
}

async function unpackTarGz(buffer: ArrayBuffer): Promise<TarEntry[]> {
  const compressedBytes = new Uint8Array(buffer);
  const tarBytes = await gunzipBytes(compressedBytes);
  return parseTarEntries(tarBytes);
}

async function unpackZip(buffer: ArrayBuffer): Promise<TarEntry[]> {
  const archive = await JSZip.loadAsync(buffer);
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

function resolveFrameEntries(entries: TarEntry[], manifest: ThreatMapFramesManifest | null): FrameEntry[] {
  const entryMap = new Map(entries.map((entry) => [normalizeFramePath(entry.path), entry]));

  const fromManifest: FrameEntry[] = [];
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
        bytes: matchedEntry.bytes,
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

  return candidateEntries
    .map((entry) => {
      const year = parseYearFromPath(entry.path);
      return year
        ? {
            year,
            path: entry.path,
            bytes: entry.bytes,
          }
        : null;
    })
    .filter((entry): entry is FrameEntry => entry !== null)
    .sort((a, b) => a.year - b.year || a.path.localeCompare(b.path));
}

function normalizeOutputBuffer(buffer: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }

  return new Uint8Array(buffer).slice().buffer;
}

async function encodeFramesToMp4InWorker(
  requestId: string,
  frames: FrameEntry[],
  manifest: ThreatMapFramesManifest | null,
): Promise<ArrayBuffer> {

  if (frames.length === 0) {
    throw new Error("No frame images were provided for encoding.");
  }

  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is not available in this browser.");
  }

  postProgress(requestId, 0, frames.length, "Initializing MP4 encoder");

  const firstFrame = frames[0]!;
  const firstBlob = toBlobFromUint8Array(firstFrame.bytes, "image/png");
  const firstBitmap = await createImageBitmap(firstBlob);

  const width = Math.floor(manifest?.width ?? firstBitmap.width);
  const height = Math.floor(manifest?.height ?? firstBitmap.height);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    firstBitmap.close();
    throw new Error("Failed to initialize OffscreenCanvas context for MP4 encoding.");
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

  context.clearRect(0, 0, width, height);
  context.drawImage(firstBitmap, 0, 0, width, height);
  firstBitmap.close();

  await videoSource.add(timestampSeconds, frameDurationSeconds, { keyFrame: true });
  timestampSeconds += frameDurationSeconds;

  postProgress(requestId, 1, frames.length, `Encoded 1/${frames.length} frames`);

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const frameBlob = toBlobFromUint8Array(frame.bytes, "image/png");
    const bitmap = await createImageBitmap(frameBlob);

    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    await videoSource.add(timestampSeconds, frameDurationSeconds, { keyFrame: true });
    timestampSeconds += frameDurationSeconds;

    postProgress(requestId, index + 1, frames.length, `Encoded ${index + 1}/${frames.length} frames`);
  }

  videoSource.close();
  await output.finalize();

  if (!target.buffer) {
    throw new Error("Threat map frame encoding finished without an output buffer.");
  }

  return normalizeOutputBuffer(target.buffer);
}

self.onmessage = async (event: MessageEvent<EncodeRequestMessage>) => {
  const message = event.data;
  if (!message || message.type !== "encodeArtifact") {
    return;
  }

  try {
    postStageProgress(message.requestId, "extracting", 0, 1, "Extracting archive");
    const archiveEntries = message.artifactType === "zip"
      ? await unpackZip(message.artifactBuffer)
      : await unpackTarGz(message.artifactBuffer);

    postStageProgress(message.requestId, "extracting", 1, 1, "Archive extracted");
    postStageProgress(message.requestId, "parsing_manifest", 0, 1, "Reading manifest.json");

    const manifest = resolveManifest(archiveEntries);
    const frameEntries = resolveFrameEntries(archiveEntries, manifest);
    if (frameEntries.length === 0) {
      throw new Error("No renderable frame images were found in the threat map artifact.");
    }

    postStageProgress(message.requestId, "parsing_manifest", 1, 1, "Manifest parsed");

    const mp4Buffer = await encodeFramesToMp4InWorker(message.requestId, frameEntries, manifest);
    const warnings = message.artifactType === "zip"
      ? ["Server returned ZIP fallback output. Frames were processed client-side."]
      : [];

    const sortedFrames = [...frameEntries].sort((a, b) => a.year - b.year || a.path.localeCompare(b.path));
    const firstFrame = sortedFrames[0]!;
    const lastFrame = sortedFrames[sortedFrames.length - 1]!;

    const firstFrameBuffer = normalizeOutputBuffer(firstFrame.bytes.buffer);
    const lastFrameBuffer = normalizeOutputBuffer(lastFrame.bytes.buffer);

    const doneMessage: WorkerDoneMessage = {
      type: "done",
      requestId: message.requestId,
      mp4Buffer,
      manifest,
      frames: frameEntries.map((entry) => ({ year: entry.year, path: entry.path })),
      boundaryFrames: {
        first: {
          year: firstFrame.year,
          path: firstFrame.path,
          mimeType: "image/png",
          buffer: firstFrameBuffer,
        },
        last: {
          year: lastFrame.year,
          path: lastFrame.path,
          mimeType: "image/png",
          buffer: lastFrameBuffer,
        },
      },
      warnings,
    };
    workerPostMessage(doneMessage, [mp4Buffer, firstFrameBuffer, lastFrameBuffer]);
  } catch (error) {
    const errorMessage: WorkerErrorMessage = {
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : "Threat map worker encoding failed.",
    };

    workerPostMessage(errorMessage);
  }
};
