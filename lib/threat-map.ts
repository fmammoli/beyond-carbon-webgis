import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

import { sanitizeThreatMapRequest } from "@/lib/threat-map-sanitizer";

export const DEFAULT_THREAT_MAP_API_BASE_URL = "";
export const DEFAULT_THREAT_MAP_API_PATH_PREFIX = "/api/v1/threat-map";
export const DEFAULT_THREAT_MAP_LOCAL_DEV_API_KEY = "chm_beyond_carbon_workshop";
export const DEFAULT_THREAT_MAP_POLL_INTERVAL_MS = 4000;

export type ThreatMapOutputFormat = "frames_tar_gz" | "mp4";
export type ThreatMapArtifactType = "frames_tar_gz" | "mp4" | "zip";

export type ThreatMapJobStatus =
  | "deferred"
  | "queued"
  | "running"
  | "succeeded"
  | "partial_success"
  | "failed"
  | "cancelled";

export type ThreatMapPreset = "balanced" | "high";
export type ThreatMapGeoJsonCrs = "EPSG:4326" | "EPSG:3857";

export type ThreatMapOverlayLayerStyle = {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  fillOpacity?: number;
  markerColor?: string;
  markerOutlineColor?: string;
  markerSize?: number;
  labelColor?: string;
  labelBgColor?: string;
};

export type ThreatMapOverlayLayer = {
  id: string;
  label: string;
  geojsonCrs: ThreatMapGeoJsonCrs;
  geojson: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties>;
  style?: ThreatMapOverlayLayerStyle;
  showInLegend?: boolean;
  legendOrder?: number;
};

type ThreatMapOverlayLayerWire = Omit<ThreatMapOverlayLayer, "geojsonCrs" | "showInLegend" | "legendOrder"> & {
  geojsonCrs: ThreatMapGeoJsonCrs;
  showInLegend?: boolean;
  legendOrder?: number;
};

export type ThreatMapJobError = {
  code: string;
  message: string;
};

export type ThreatMapJobResult = {
  downloadUrl: string;
  contentType: string;
  artifactType: ThreatMapArtifactType;
  sizeBytes: number;
  yearsRendered: number;
  yearsExpected: number;
  fallbackReasonCode: string | null;
};

export type ThreatMapJob = {
  jobId: string;
  status: ThreatMapJobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  progress: number | null;
  etaSeconds: number | null;
  currentYear: number | null;
  message: string | null;
  warnings: string[];
  result: ThreatMapJobResult | null;
  error: ThreatMapJobError | null;
};

export type CreateThreatMapJobRequest = {
  geojson: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties>;
  geojsonCrs?: ThreatMapGeoJsonCrs;
  overlayLayers?: ThreatMapOverlayLayer[];
  preset: ThreatMapPreset;
  width?: number;
  height?: number;
  fps?: number;
  frameDurationSeconds?: number;
  outputFormat?: ThreatMapOutputFormat;
};

type CreateThreatMapJobRequestWire = Omit<CreateThreatMapJobRequest, "geojsonCrs" | "overlayLayers"> & {
  geojsonCrs: ThreatMapGeoJsonCrs;
  overlayLayers?: ThreatMapOverlayLayerWire[];
};

export type CreateThreatMapJobResponse = {
  jobId: string;
  status: ThreatMapJobStatus;
  message: string;
};

export type ThreatMapClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
};

export type ThreatMapPollOptions = ThreatMapClientOptions & {
  intervalMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (job: ThreatMapJob) => void;
};

export type ThreatMapArtifactDownloadResult = {
  jobId: string;
  blob: Blob;
  contentType: string;
  filename: string;
  artifactType: ThreatMapArtifactType;
};

export class ThreatMapApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;
  readonly payload?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: string;
      payload?: unknown;
    },
  ) {
    super(message);
    this.name = "ThreatMapApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.payload = options.payload;
  }
}

export class ThreatMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreatMapValidationError";
  }
}

function resolveThreatMapBaseUrl(baseUrl?: string): string {
  const candidate = (
    baseUrl
    ?? process.env.NEXT_PUBLIC_THREAT_MAP_API_BASE_URL
    ?? process.env.NEXT_PUBLIC_API_BASE_URL
    ?? DEFAULT_THREAT_MAP_API_BASE_URL
  ).trim();

  return candidate.replace(/\/$/, "");
}

function resolveThreatMapApiKey(baseUrl?: string, providedApiKey?: string): string | null {
  const apiKey = (
    providedApiKey
    ?? process.env.NEXT_PUBLIC_THREAT_MAP_API_KEY
    ?? process.env.NEXT_PUBLIC_API_KEY
    ?? ""
  ).trim();

  if (apiKey) {
    return apiKey;
  }

  const normalizedBaseUrl = resolveThreatMapBaseUrl(baseUrl);
  if (normalizedBaseUrl.startsWith("/")) {
    return null;
  }

  try {
    const parsed = new URL(normalizedBaseUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return DEFAULT_THREAT_MAP_LOCAL_DEV_API_KEY;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveThreatMapUrl(pathname: string, baseUrl?: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${resolveThreatMapBaseUrl(baseUrl)}${DEFAULT_THREAT_MAP_API_PATH_PREFIX}${normalizedPath}`;
}

function buildThreatMapRequestHeaders(options: {
  baseUrl?: string;
  apiKey?: string;
  includeJsonContentType?: boolean;
} = {}): HeadersInit {
  const headers: Record<string, string> = {};

  if (options.includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  const apiKey = resolveThreatMapApiKey(options.baseUrl, options.apiKey);
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

function isPolygonGeometryType(value: string | null | undefined): boolean {
  return value === "Polygon" || value === "MultiPolygon";
}

function hasPolygonGeometry(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as { type?: unknown };
  if (record.type === "Feature") {
    return isPolygonGeometryType((value as Feature<Geometry, GeoJsonProperties>).geometry?.type);
  }

  if (record.type !== "FeatureCollection") {
    return false;
  }

  const features = (value as FeatureCollection<Geometry, GeoJsonProperties>).features;
  return features.some((feature) => isPolygonGeometryType(feature.geometry?.type));
}

function collectGeometryCoordinates(geometry: Geometry): number[][] {
  const flattened: number[][] = [];

  const visit = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    if (typeof value[0] === "number") {
      const coordinate = value as number[];
      if (coordinate.length >= 2) {
        flattened.push([coordinate[0]!, coordinate[1]!]);
      }
      return;
    }

    for (const child of value) {
      visit(child);
    }
  };

  switch (geometry.type) {
    case "GeometryCollection":
      for (const child of geometry.geometries) {
        flattened.push(...collectGeometryCoordinates(child));
      }
      return flattened;
    default:
      visit((geometry as Exclude<Geometry, { type: "GeometryCollection" }>).coordinates);
      return flattened;
  }
}

function inferGeojsonCrsFromPayload(
  geojson: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties>,
): ThreatMapGeoJsonCrs {
  const geometries: Geometry[] = [];

  if (geojson.type === "FeatureCollection") {
    for (const feature of geojson.features) {
      if (feature.geometry) {
        geometries.push(feature.geometry);
      }
    }
  } else if (geojson.geometry) {
    geometries.push(geojson.geometry);
  }

  const coordinates = geometries.flatMap((geometry) => collectGeometryCoordinates(geometry));

  if (coordinates.length === 0) {
    return "EPSG:4326";
  }

  const looksLikeLonLat = coordinates.every(([x, y]) =>
    Number.isFinite(x)
      && Number.isFinite(y)
      && x >= -180
      && x <= 180
      && y >= -90
      && y <= 90);

  return looksLikeLonLat ? "EPSG:4326" : "EPSG:3857";
}

function normalizeCreateThreatMapJobPayload(payload: CreateThreatMapJobRequest): CreateThreatMapJobRequestWire {
  const geojsonCrs = payload.geojsonCrs ?? inferGeojsonCrsFromPayload(payload.geojson);
  const overlayLayers = payload.overlayLayers?.map((layer) => ({
    ...layer,
    geojsonCrs: layer.geojsonCrs,
    showInLegend: layer.showInLegend,
    legendOrder: layer.legendOrder,
  }));

  return {
    ...payload,
    geojsonCrs,
    overlayLayers,
  };
}

export function validateThreatMapRequest(payload: CreateThreatMapJobRequest): void {
  if (!hasPolygonGeometry(payload.geojson)) {
    throw new ThreatMapValidationError("A polygon GeoJSON feature or feature collection is required.");
  }

  if (payload.width !== undefined && (!Number.isFinite(payload.width) || payload.width <= 0 || payload.width > 1024)) {
    throw new ThreatMapValidationError("Width must be between 1 and 1024.");
  }

  if (payload.height !== undefined && (!Number.isFinite(payload.height) || payload.height <= 0 || payload.height > 1024)) {
    throw new ThreatMapValidationError("Height must be between 1 and 1024.");
  }

  if (payload.fps !== undefined && (!Number.isFinite(payload.fps) || payload.fps <= 0)) {
    throw new ThreatMapValidationError("FPS must be greater than 0.");
  }

  if (
    payload.frameDurationSeconds !== undefined
    && (!Number.isFinite(payload.frameDurationSeconds) || payload.frameDurationSeconds <= 0)
  ) {
    throw new ThreatMapValidationError("Frame duration must be greater than 0.");
  }
}

async function readErrorPayload(response: Response): Promise<{ payload?: unknown; rawText: string }> {
  const rawText = await response.text().catch(() => "");

  if (!rawText) {
    return { rawText: "" };
  }

  try {
    return { payload: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { rawText };
  }
}

function extractMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }

  const nestedError = record.error;
  if (nestedError && typeof nestedError === "object") {
    const nestedRecord = nestedError as Record<string, unknown>;
    if (typeof nestedRecord.message === "string" && nestedRecord.message.trim()) {
      return nestedRecord.message.trim();
    }
  }

  return null;
}

async function throwForThreatMapResponse(response: Response, fallbackMessage: string): Promise<never> {
  const { payload, rawText } = await readErrorPayload(response);
  const payloadMessage = extractMessageFromPayload(payload);

  let message = (payloadMessage ?? rawText.trim()) || fallbackMessage;
  if (response.status === 401) {
    message = "Invalid API key";
  } else if (response.status === 404) {
    message = payloadMessage ?? "Threat map job not found.";
  } else if (response.status === 409) {
    message = payloadMessage ?? "Threat map job is not complete yet.";
  } else if (response.status === 429) {
    message = payloadMessage ?? "Threat map queue is full. Please retry in a moment.";
  }

  throw new ThreatMapApiError(message, {
    status: response.status,
    code: typeof (payload as { code?: unknown } | undefined)?.code === "string"
      ? (payload as { code: string }).code
      : undefined,
    details: rawText.trim() || undefined,
    payload,
  });
}

function normalizeThreatMapStatus(value: unknown): ThreatMapJobStatus {
  if (typeof value !== "string") {
    throw new Error("Threat map status is missing.");
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "deferred"
    || normalized === "queued"
    || normalized === "running"
    || normalized === "succeeded"
    || normalized === "partial_success"
    || normalized === "failed"
    || normalized === "cancelled"
  ) {
    return normalized;
  }

  throw new Error(`Unsupported threat map status: ${value}`);
}

function normalizeThreatMapJob(payload: unknown): ThreatMapJob {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid threat map job payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim())
    || (typeof record.job_id === "string" && record.job_id.trim())
    || null;

  if (!jobId) {
    throw new Error("Threat map job payload is missing jobId.");
  }

  const status = normalizeThreatMapStatus(record.status);

  const resultRecord = record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : null;

  const errorRecord = record.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : null;

  return {
    jobId,
    status,
    createdAt:
      (typeof record.createdAt === "string" && record.createdAt)
      || (typeof record.created_at === "string" && record.created_at)
      || new Date().toISOString(),
    startedAt:
      (typeof record.startedAt === "string" && record.startedAt)
      || (typeof record.started_at === "string" && record.started_at)
      || null,
    finishedAt:
      (typeof record.finishedAt === "string" && record.finishedAt)
      || (typeof record.finished_at === "string" && record.finished_at)
      || null,
    progress: typeof record.progress === "number" ? record.progress : null,
    etaSeconds:
      typeof record.etaSeconds === "number"
        ? record.etaSeconds
        : typeof record.eta_seconds === "number"
          ? record.eta_seconds
          : null,
    currentYear:
      typeof record.currentYear === "number"
        ? record.currentYear
        : typeof record.current_year === "number"
          ? record.current_year
          : null,
    message: typeof record.message === "string" ? record.message : null,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((value): value is string => typeof value === "string")
      : [],
    result: resultRecord
      ? {
          downloadUrl: typeof resultRecord.downloadUrl === "string"
            ? resultRecord.downloadUrl
            : typeof resultRecord.download_url === "string"
              ? resultRecord.download_url
              : "",
          contentType: typeof resultRecord.contentType === "string"
            ? resultRecord.contentType
            : "application/octet-stream",
          artifactType: normalizeArtifactType(resultRecord.artifactType ?? resultRecord.artifact_type),
          sizeBytes: typeof resultRecord.sizeBytes === "number"
            ? resultRecord.sizeBytes
            : typeof resultRecord.size_bytes === "number"
              ? resultRecord.size_bytes
              : 0,
          yearsRendered: typeof resultRecord.yearsRendered === "number"
            ? resultRecord.yearsRendered
            : typeof resultRecord.years_rendered === "number"
              ? resultRecord.years_rendered
              : 0,
          yearsExpected: typeof resultRecord.yearsExpected === "number"
            ? resultRecord.yearsExpected
            : typeof resultRecord.years_expected === "number"
              ? resultRecord.years_expected
              : 0,
          fallbackReasonCode:
            typeof resultRecord.fallbackReasonCode === "string"
              ? resultRecord.fallbackReasonCode
              : typeof resultRecord.fallback_reason_code === "string"
                ? resultRecord.fallback_reason_code
                : null,
        }
      : null,
    error: errorRecord
      ? {
          code: typeof errorRecord.code === "string" && errorRecord.code.trim()
            ? errorRecord.code.trim()
            : "THREAT_MAP_JOB_FAILED",
          message: typeof errorRecord.message === "string" && errorRecord.message.trim()
            ? errorRecord.message.trim()
            : "Threat map job failed.",
        }
      : null,
  };
}

function normalizeArtifactType(value: unknown): ThreatMapArtifactType {
  if (typeof value !== "string") {
    return "frames_tar_gz";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "frames_tar_gz" || normalized === "mp4" || normalized === "zip") {
    return normalized;
  }

  return "frames_tar_gz";
}

function inferArtifactType(filename: string, contentType: string, fallback?: ThreatMapArtifactType): ThreatMapArtifactType {
  const lowerFilename = filename.toLowerCase();
  const lowerContentType = contentType.toLowerCase();

  if (lowerContentType.includes("video/mp4") || lowerFilename.endsWith(".mp4")) {
    return "mp4";
  }

  if (lowerContentType.includes("application/zip") || lowerFilename.endsWith(".zip")) {
    return "zip";
  }

  if (
    lowerContentType.includes("application/gzip")
    || lowerContentType.includes("application/x-gzip")
    || lowerFilename.endsWith(".tar.gz")
    || lowerFilename.endsWith(".tgz")
  ) {
    return "frames_tar_gz";
  }

  return fallback ?? "frames_tar_gz";
}

function parseFilenameFromContentDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const starMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (starMatch?.[1]) {
    return decodeURIComponent(starMatch[1]);
  }

  const match = value.match(/filename="?([^";]+)"?/i);
  if (!match?.[1]) {
    return null;
  }

  return match[1];
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isThreatMapTerminalStatus(status: ThreatMapJobStatus): boolean {
  return status === "succeeded"
    || status === "partial_success"
    || status === "failed"
    || status === "cancelled";
}

export function isThreatMapDownloadReadyStatus(status: ThreatMapJobStatus): boolean {
  return status === "succeeded" || status === "partial_success";
}

export async function createThreatMapJob(
  payload: CreateThreatMapJobRequest,
  options?: ThreatMapClientOptions,
): Promise<CreateThreatMapJobResponse> {
  const sanitizedPayload = sanitizeThreatMapRequest(payload);
  validateThreatMapRequest(sanitizedPayload);
  const payloadToSend = normalizeCreateThreatMapJobPayload(sanitizedPayload);

  const response = await fetch(resolveThreatMapUrl("/jobs", options?.baseUrl), {
    method: "POST",
    headers: buildThreatMapRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      includeJsonContentType: true,
    }),
    body: JSON.stringify(payloadToSend),
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForThreatMapResponse(response, "Threat map job creation failed.");
  }

  const json = await response.json() as unknown;
  if (!json || typeof json !== "object") {
    throw new Error("Invalid threat map create-job response payload.");
  }

  const record = json as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim())
    || (typeof record.job_id === "string" && record.job_id.trim())
    || null;

  if (!jobId) {
    throw new Error("Threat map create-job response is missing jobId.");
  }

  return {
    jobId,
    status: normalizeThreatMapStatus(record.status),
    message: typeof record.message === "string" ? record.message : "Threat map job submitted.",
  };
}

export async function getThreatMapJob(
  jobId: string,
  options?: ThreatMapClientOptions,
): Promise<ThreatMapJob> {
  const response = await fetch(resolveThreatMapUrl(`/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl), {
    method: "GET",
    headers: buildThreatMapRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
    }),
    cache: "no-store",
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForThreatMapResponse(response, "Threat map job lookup failed.");
  }

  return normalizeThreatMapJob(await response.json());
}

export async function pollThreatMapJob(
  jobId: string,
  options?: ThreatMapPollOptions,
): Promise<ThreatMapJob> {
  const wait = options?.wait ?? waitForDelay;
  const intervalMs = options?.intervalMs ?? DEFAULT_THREAT_MAP_POLL_INTERVAL_MS;

  while (true) {
    const job = await getThreatMapJob(jobId, options);
    options?.onUpdate?.(job);

    if (isThreatMapTerminalStatus(job.status)) {
      return job;
    }

    await wait(intervalMs, options?.signal);
  }
}

export async function cancelThreatMapJob(
  jobId: string,
  options?: ThreatMapClientOptions,
): Promise<ThreatMapJob> {
  const response = await fetch(resolveThreatMapUrl(`/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl), {
    method: "DELETE",
    headers: buildThreatMapRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForThreatMapResponse(response, "Threat map cancel request failed.");
  }

  return normalizeThreatMapJob(await response.json());
}

export async function downloadThreatMapArtifact(
  jobId: string,
  options?: ThreatMapClientOptions & { expectedArtifactType?: ThreatMapArtifactType },
): Promise<ThreatMapArtifactDownloadResult> {
  const response = await fetch(resolveThreatMapUrl(`/jobs/${encodeURIComponent(jobId)}/download`, options?.baseUrl), {
    method: "GET",
    headers: buildThreatMapRequestHeaders({
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
    }),
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwForThreatMapResponse(response, "Threat map artifact download failed.");
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const filename =
    parseFilenameFromContentDisposition(response.headers.get("content-disposition"))
    ?? `threat_map_${jobId}`;

  const artifactType = inferArtifactType(filename, contentType, options?.expectedArtifactType);
  const blob = await response.blob();

  return {
    jobId,
    blob,
    contentType,
    filename,
    artifactType,
  };
}
