import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export const DEFAULT_CHM_STATS_API_BASE_URL = "/api/v1/chm/stats";
export const DEFAULT_CHM_STATS_INITIAL_POLL_INTERVAL_MS = 1500;
export const DEFAULT_CHM_STATS_MAX_DURATION_MS = 180_000;
export const DEFAULT_CHM_STATS_MAX_RETRIES = 3;
export const DEFAULT_CHM_STATS_MAX_RETRY_DELAY_MS = 10_000;
export const DEFAULT_CHM_STATS_CREATE_REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_CHM_STATS_STATUS_REQUEST_TIMEOUT_MS = 20_000;

const CHM_STATS_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_CHM_STATS_DEBUG === "1";

function logChmStatsDebug(event: string, details?: Record<string, unknown>) {
  if (!CHM_STATS_DEBUG_ENABLED || typeof console === "undefined") {
    return;
  }

  const timestamp = new Date().toISOString();
  if (details) {
    console.info(`[chm-stats] ${timestamp} ${event}`, details);
    return;
  }

  console.info(`[chm-stats] ${timestamp} ${event}`);
}

export type ChmStatsJobStatus = "queued" | "running" | "succeeded" | "failed";

export type ChmCanopyThresholdMetric = {
  thresholdM: number;
  coverRatio: number;
  coverPercent: number;
  coverAreaHa: number;
};

export type ChmStatsMetadata = {
  sourceUrl: string;
  sourceFormat: string;
  zoom: number;
  tileCount: number;
  histogramBins: number;
  histogramMinM: number;
  histogramMaxM: number;
  thresholdsM: string;
} & Record<string, unknown>;

export type ChmStatsResult = {
  minCanopyHeightM: number;
  maxCanopyHeightM: number;
  meanCanopyHeightM: number;
  medianCanopyHeightM: number;
  stdDevCanopyHeightM: number;
  varianceCanopyHeightM2: number;
  p10CanopyHeightM: number;
  p25CanopyHeightM: number;
  p75CanopyHeightM: number;
  p90CanopyHeightM: number;
  p95CanopyHeightM: number;
  interquartileRangeM: number;
  coefficientOfVariation: number;
  totalCanopyVolumeProxyM3: number;
  analyzedAreaHa: number;
  aoiAreaHa: number;
  coverageFraction: number;
  validPixelCount: number;
  canopyCoverByThreshold: ChmCanopyThresholdMetric[];
  metadata?: ChmStatsMetadata;
};

export type ChmStatsJobCreateRequest = {
  geojson: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties> | object;
  canopyThresholdsM?: number[];
};

export type ChmStatsJobCreateResponse = {
  jobId: string;
  status: ChmStatsJobStatus;
  message: string;
  progress?: number | null;
  etaSeconds?: number | null;
  result?: ChmStatsResult | null;
  error?: { code: string; message: string } | null;
};

export type ChmStatsJobStatusResponse = {
  jobId: string;
  status: ChmStatsJobStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  progress?: number | null;
  etaSeconds?: number | null;
  message?: string | null;
  result?: ChmStatsResult | null;
  error?: { code: string; message: string } | null;
};

type ChmStatsJobErrorPayload = {
  code: string;
  message: string;
};

export type ChmStatsClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  createRequestTimeoutMs?: number;
  statusRequestTimeoutMs?: number;
};

export type ChmStatsPollOptions = ChmStatsClientOptions & {
  pollIntervalMs?: number;
  maxDurationMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (job: ChmStatsJobStatusResponse) => void;
};

export class ChmStatsApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string;
  readonly payload?: unknown;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      details?: string;
      payload?: unknown;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "ChmStatsApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.payload = options.payload;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class ChmStatsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChmStatsValidationError";
  }
}

function normalizeJobStatus(rawStatus: unknown, rawRecord?: Record<string, unknown>): ChmStatsJobStatus {
  const normalized = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";

  if (normalized === "queued" || normalized === "pending" || normalized === "waiting") {
    return "queued";
  }

  if (
    normalized === "running" ||
    normalized === "in_progress" ||
    normalized === "in-progress" ||
    normalized === "processing"
  ) {
    return "running";
  }

  if (
    normalized === "succeeded" ||
    normalized === "success" ||
    normalized === "completed" ||
    normalized === "done" ||
    normalized === "finished"
  ) {
    return "succeeded";
  }

  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  ) {
    return "failed";
  }

  if (rawRecord) {
    const result = rawRecord.result;
    const error = rawRecord.error;
    const progress = rawRecord.progress;

    if (result && typeof result === "object") {
      return "succeeded";
    }

    if (error && typeof error === "object") {
      return "failed";
    }

    if (typeof progress === "number" && Number.isFinite(progress) && progress >= 100) {
      return "succeeded";
    }
  }

  throw new Error(`Unsupported CHM stats job status: ${String(rawStatus ?? "<missing>")}`);
}

function readNumberField(record: Record<string, unknown>, camelCaseKey: string, snakeCaseKey: string): number {
  const value = record[camelCaseKey] ?? record[snakeCaseKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`CHM stats result is missing numeric field: ${camelCaseKey}`);
  }

  return value;
}

function normalizeThresholdMetric(payload: unknown): ChmCanopyThresholdMetric {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid CHM threshold metric payload.");
  }

  const record = payload as Record<string, unknown>;

  return {
    thresholdM: readNumberField(record, "thresholdM", "threshold_m"),
    coverRatio: readNumberField(record, "coverRatio", "cover_ratio"),
    coverPercent: readNumberField(record, "coverPercent", "cover_percent"),
    coverAreaHa: readNumberField(record, "coverAreaHa", "cover_area_ha"),
  };
}

function normalizeMetadata(payload: unknown): ChmStatsMetadata | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const sourceUrl = typeof record.sourceUrl === "string"
    ? record.sourceUrl
    : typeof record.source_url === "string"
      ? record.source_url
      : "";
  const sourceFormat = typeof record.sourceFormat === "string"
    ? record.sourceFormat
    : typeof record.source_format === "string"
      ? record.source_format
      : "";
  const zoom = typeof record.zoom === "number"
    ? record.zoom
    : typeof record.zoom === "string"
      ? Number.parseFloat(record.zoom)
      : NaN;
  const tileCount = typeof record.tileCount === "number"
    ? record.tileCount
    : typeof record.tile_count === "number"
      ? record.tile_count
      : NaN;
  const histogramBins = typeof record.histogramBins === "number"
    ? record.histogramBins
    : typeof record.histogram_bins === "number"
      ? record.histogram_bins
      : NaN;
  const histogramMinM = typeof record.histogramMinM === "number"
    ? record.histogramMinM
    : typeof record.histogram_min_m === "number"
      ? record.histogram_min_m
      : NaN;
  const histogramMaxM = typeof record.histogramMaxM === "number"
    ? record.histogramMaxM
    : typeof record.histogram_max_m === "number"
      ? record.histogram_max_m
      : NaN;
  const thresholdsM = typeof record.thresholdsM === "string"
    ? record.thresholdsM
    : typeof record.thresholds_m === "string"
      ? record.thresholds_m
      : "";

  if (
    !sourceUrl ||
    !sourceFormat ||
    !Number.isFinite(zoom) ||
    !Number.isFinite(tileCount) ||
    !Number.isFinite(histogramBins) ||
    !Number.isFinite(histogramMinM) ||
    !Number.isFinite(histogramMaxM)
  ) {
    return undefined;
  }

  return {
    ...(record as Record<string, unknown>),
    sourceUrl,
    sourceFormat,
    zoom,
    tileCount,
    histogramBins,
    histogramMinM,
    histogramMaxM,
    thresholdsM,
  };
}

function normalizeChmStatsResult(payload: unknown): ChmStatsResult | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid CHM stats result payload.");
  }

  const record = payload as Record<string, unknown>;
  const canopyCoverRaw = record.canopyCoverByThreshold ?? record.canopy_cover_by_threshold;
  const canopyCoverByThreshold = Array.isArray(canopyCoverRaw)
    ? canopyCoverRaw.map((item) => normalizeThresholdMetric(item))
    : [];

  return {
    minCanopyHeightM: readNumberField(record, "minCanopyHeightM", "min_canopy_height_m"),
    maxCanopyHeightM: readNumberField(record, "maxCanopyHeightM", "max_canopy_height_m"),
    meanCanopyHeightM: readNumberField(record, "meanCanopyHeightM", "mean_canopy_height_m"),
    medianCanopyHeightM: readNumberField(record, "medianCanopyHeightM", "median_canopy_height_m"),
    stdDevCanopyHeightM: readNumberField(record, "stdDevCanopyHeightM", "std_dev_canopy_height_m"),
    varianceCanopyHeightM2: readNumberField(record, "varianceCanopyHeightM2", "variance_canopy_height_m2"),
    p10CanopyHeightM: readNumberField(record, "p10CanopyHeightM", "p10_canopy_height_m"),
    p25CanopyHeightM: readNumberField(record, "p25CanopyHeightM", "p25_canopy_height_m"),
    p75CanopyHeightM: readNumberField(record, "p75CanopyHeightM", "p75_canopy_height_m"),
    p90CanopyHeightM: readNumberField(record, "p90CanopyHeightM", "p90_canopy_height_m"),
    p95CanopyHeightM: readNumberField(record, "p95CanopyHeightM", "p95_canopy_height_m"),
    interquartileRangeM: readNumberField(record, "interquartileRangeM", "interquartile_range_m"),
    coefficientOfVariation: readNumberField(record, "coefficientOfVariation", "coefficient_of_variation"),
    totalCanopyVolumeProxyM3: readNumberField(record, "totalCanopyVolumeProxyM3", "total_canopy_volume_proxy_m3"),
    analyzedAreaHa: readNumberField(record, "analyzedAreaHa", "analyzed_area_ha"),
    aoiAreaHa: readNumberField(record, "aoiAreaHa", "aoi_area_ha"),
    coverageFraction: readNumberField(record, "coverageFraction", "coverage_fraction"),
    validPixelCount: readNumberField(record, "validPixelCount", "valid_pixel_count"),
    canopyCoverByThreshold,
    metadata: normalizeMetadata(record.metadata),
  };
}

function normalizeCreateJobResponse(payload: unknown): ChmStatsJobCreateResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid CHM stats create-job response payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim()) ||
    (typeof record.job_id === "string" && record.job_id.trim()) ||
    null;

  if (!jobId) {
    throw new Error("CHM stats create-job response is missing jobId.");
  }

  return {
    jobId,
    status: normalizeJobStatus(record.status, record),
    message:
      (typeof record.message === "string" && record.message) ||
      "CHM stats job submitted.",
    progress: typeof record.progress === "number" ? record.progress : null,
    etaSeconds: typeof record.etaSeconds === "number"
      ? record.etaSeconds
      : typeof record.eta_seconds === "number"
        ? record.eta_seconds
        : null,
    result: normalizeChmStatsResult(record.result),
    error: normalizeChmStatsJobError(record.error),
  };
}

function normalizeJobStatusResponse(payload: unknown): ChmStatsJobStatusResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid CHM stats job-status response payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim()) ||
    (typeof record.job_id === "string" && record.job_id.trim()) ||
    null;

  if (!jobId) {
    throw new Error("CHM stats status response is missing jobId.");
  }

  const createdAt =
    (typeof record.createdAt === "string" && record.createdAt) ||
    (typeof record.created_at === "string" && record.created_at) ||
    new Date().toISOString();

  const startedAt =
    (typeof record.startedAt === "string" && record.startedAt) ||
    (typeof record.started_at === "string" && record.started_at) ||
    null;

  const finishedAt =
    (typeof record.finishedAt === "string" && record.finishedAt) ||
    (typeof record.finished_at === "string" && record.finished_at) ||
    null;

  return {
    jobId,
    status: normalizeJobStatus(record.status, record),
    createdAt,
    startedAt,
    finishedAt,
    progress: typeof record.progress === "number" ? record.progress : null,
    etaSeconds: typeof record.etaSeconds === "number"
      ? record.etaSeconds
      : typeof record.eta_seconds === "number"
        ? record.eta_seconds
        : null,
    message: typeof record.message === "string" ? record.message : null,
    result: normalizeChmStatsResult(record.result),
    error: normalizeChmStatsJobError(record.error),
  };
}

function normalizeChmStatsJobError(payload: unknown): ChmStatsJobErrorPayload | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return {
      code: "CHM_STATS_JOB_FAILED",
      message: "CHM stats job failed.",
    };
  }

  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "string" && record.code.trim()
    ? record.code.trim()
    : "CHM_STATS_JOB_FAILED";
  const message = typeof record.message === "string" && record.message.trim()
    ? record.message.trim()
    : "CHM stats job failed.";

  return { code, message };
}

function resolveChmStatsBaseUrl(baseUrl?: string): string {
  const candidate = (baseUrl ?? process.env.NEXT_PUBLIC_CHM_STATS_API_BASE_URL ?? DEFAULT_CHM_STATS_API_BASE_URL).trim();
  return candidate.replace(/\/$/, "");
}

function resolveChmStatsApiKey(baseUrl?: string, providedApiKey?: string): string | null {
  const apiKey = (providedApiKey ?? process.env.NEXT_PUBLIC_UPSTREAM_API_KEY ?? process.env.UPSTREAM_API_KEY ?? "").trim();
  if (apiKey) {
    return apiKey;
  }

  const candidateBaseUrl = resolveChmStatsBaseUrl(baseUrl);
  if (candidateBaseUrl.startsWith("/")) {
    return null;
  }

  try {
    const parsed = new URL(candidateBaseUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return null;
    }
  } catch {
    return null;
  }

  return null;
}

function buildChmStatsRequestHeaders(
  options: {
    baseUrl?: string;
    apiKey?: string;
    includeJsonContentType?: boolean;
  } = {},
): HeadersInit {
  const headers: Record<string, string> = {};

  if (options.includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  const apiKey = resolveChmStatsApiKey(options.baseUrl, options.apiKey);
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

function resolveChmStatsUrl(pathname: string, baseUrl?: string): string {
  const normalizedBaseUrl = resolveChmStatsBaseUrl(baseUrl);
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) ||
    (error instanceof Error && error.name === "AbortError");
}

function createAbortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

function createTimedAbortError(timeoutMs: number): Error {
  const error = new Error(`CHM stats request timed out after ${timeoutMs}ms.`);
  error.name = "AbortError";
  return error;
}

function resolveRequestTimeoutMs(value: number | undefined, fallbackMs: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }

  return Math.floor(value);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let didTimeout = false;
  const startedAtMs = Date.now();
  const urlForLogs = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  logChmStatsDebug("fetch_start", {
    url: urlForLogs,
    method: init.method ?? "GET",
    timeoutMs,
    hasExternalSignal: Boolean(externalSignal),
  });

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    didTimeout = true;
    controller.abort();
    logChmStatsDebug("fetch_timeout_abort", {
      url: urlForLogs,
      method: init.method ?? "GET",
      timeoutMs,
      elapsedMs: Date.now() - startedAtMs,
    });
  }, timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    logChmStatsDebug("fetch_response", {
      url: urlForLogs,
      method: init.method ?? "GET",
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAtMs,
    });

    return response;
  } catch (error) {
    if (didTimeout && isAbortError(error)) {
      logChmStatsDebug("fetch_timeout_error", {
        url: urlForLogs,
        method: init.method ?? "GET",
        timeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      });
      throw createTimedAbortError(timeoutMs);
    }

    logChmStatsDebug("fetch_error", {
      url: urlForLogs,
      method: init.method ?? "GET",
      elapsedMs: Date.now() - startedAtMs,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedSeconds = Number.parseFloat(value);
  if (Number.isFinite(parsedSeconds)) {
    return Math.max(0, Math.round(parsedSeconds * 1000));
  }

  const parsedDate = Date.parse(value);
  if (!Number.isFinite(parsedDate)) {
    return undefined;
  }

  return Math.max(0, parsedDate - Date.now());
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
    const errorRecord = nestedError as Record<string, unknown>;
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message.trim();
    }
  }

  if (typeof record.details === "string" && record.details.trim()) {
    return record.details.trim();
  }

  return null;
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

function extractResponseCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.code === "string" ? record.code : undefined;
}

async function throwForChmStatsResponse(
  response: Response,
  fallbackMessage: string,
  context: "create" | "status",
): Promise<never> {
  const { payload, rawText } = await readErrorPayload(response);
  const payloadMessage = extractMessageFromPayload(payload);
  const retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));
  const status = response.status;

  let message = (payloadMessage ?? rawText.trim()) || fallbackMessage;

  if (status === 401) {
    message = "Invalid API key or CHM stats API is not configured.";
  } else if (status === 404 && context === "status" && !payloadMessage && !rawText.trim()) {
    message = "CHM stats job not found.";
  } else if (status === 429) {
    message = payloadMessage ?? "Queue is busy. Please retry in a moment.";
  } else if (status === 422) {
    message = payloadMessage ?? "Validation failed.";
  }

  throw new ChmStatsApiError(message, {
    status,
    code: extractResponseCode(payload),
    details: rawText.trim() || undefined,
    payload,
    retryAfterMs,
  });
}

function isTerminalJobStatus(status: ChmStatsJobStatus): boolean {
  return status === "succeeded" || status === "failed";
}

function isPolygonGeometryType(value: string | null | undefined): boolean {
  return value === "Polygon" || value === "MultiPolygon";
}

function isFeatureCollection(value: unknown): value is FeatureCollection<Geometry, GeoJsonProperties> {
  return Boolean(value)
    && typeof value === "object"
    && (value as { type?: unknown }).type === "FeatureCollection"
    && Array.isArray((value as FeatureCollection).features);
}

function hasPolygonGeometry(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if ((value as { type?: unknown }).type === "Feature") {
    return isPolygonGeometryType((value as Feature<Geometry>).geometry?.type);
  }

  if (!isFeatureCollection(value)) {
    return false;
  }

  return value.features.some((feature) => isPolygonGeometryType(feature.geometry?.type));
}

export function validateChmStatsRequest(payload: ChmStatsJobCreateRequest): void {
  if (!hasPolygonGeometry(payload.geojson)) {
    throw new ChmStatsValidationError("A polygon GeoJSON feature or feature collection is required.");
  }

  if (!payload.canopyThresholdsM) {
    return;
  }

  if (!Array.isArray(payload.canopyThresholdsM)) {
    throw new ChmStatsValidationError("Canopy thresholds must be a numeric array.");
  }

  if (payload.canopyThresholdsM.length === 0) {
    throw new ChmStatsValidationError("Canopy thresholds cannot be empty.");
  }

  for (const threshold of payload.canopyThresholdsM) {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new ChmStatsValidationError("Canopy thresholds must contain positive numbers.");
    }
  }
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

function isTransientError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }

  if (error instanceof ChmStatsApiError) {
    return error.status >= 500 && error.status < 600;
  }

  return error instanceof TypeError;
}

async function withTransientRetries<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    signal?: AbortSignal;
    wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  },
): Promise<T> {
  const wait = options.wait ?? waitForDelay;
  let attempt = 0;
  let delayMs = options.initialDelayMs;

  while (true) {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    try {
      return await operation();
    } catch (error) {
      if (!isTransientError(error) || attempt >= options.maxRetries) {
        throw error;
      }

      const nextDelayMs = Math.min(options.maxDelayMs, delayMs);
      await wait(nextDelayMs, options.signal);
      attempt += 1;
      delayMs = Math.min(options.maxDelayMs, delayMs * 2);
    }
  }
}

export async function createChmStatsJob(
  payload: ChmStatsJobCreateRequest,
  options?: ChmStatsClientOptions,
): Promise<ChmStatsJobCreateResponse> {
  validateChmStatsRequest(payload);

  const createRequestTimeoutMs = resolveRequestTimeoutMs(
    options?.createRequestTimeoutMs,
    DEFAULT_CHM_STATS_CREATE_REQUEST_TIMEOUT_MS,
  );

  const requestPayload: Record<string, unknown> = {
    geojson: payload.geojson,
  };

  if (payload.canopyThresholdsM && payload.canopyThresholdsM.length > 0) {
    requestPayload.canopyThresholdsM = payload.canopyThresholdsM;
  }

  const response = await fetchWithTimeout(
    resolveChmStatsUrl("/jobs", options?.baseUrl),
    {
      method: "POST",
      headers: buildChmStatsRequestHeaders({
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        includeJsonContentType: true,
      }),
      body: JSON.stringify(requestPayload),
    },
    createRequestTimeoutMs,
    options?.signal,
  );

  if (!response.ok) {
    await throwForChmStatsResponse(response, "CHM stats job creation failed.", "create");
  }

  return normalizeCreateJobResponse(await response.json());
}

export const submitChmStatsJob = createChmStatsJob;

export async function getChmStatsJob(
  jobId: string,
  options?: ChmStatsClientOptions,
): Promise<ChmStatsJobStatusResponse> {
  const statusRequestTimeoutMs = resolveRequestTimeoutMs(
    options?.statusRequestTimeoutMs,
    DEFAULT_CHM_STATS_STATUS_REQUEST_TIMEOUT_MS,
  );

  const response = await fetchWithTimeout(
    resolveChmStatsUrl(`/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl),
    {
      method: "GET",
      headers: buildChmStatsRequestHeaders({
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
      }),
      cache: "no-store",
    },
    statusRequestTimeoutMs,
    options?.signal,
  );

  if (!response.ok) {
    await throwForChmStatsResponse(response, "CHM stats job lookup failed.", "status");
  }

  return normalizeJobStatusResponse(await response.json());
}

export const fetchChmStatsJob = getChmStatsJob;

export async function startChmStatsAndPoll(
  payload: ChmStatsJobCreateRequest,
  options?: ChmStatsPollOptions,
): Promise<ChmStatsJobStatusResponse> {
  validateChmStatsRequest(payload);

  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_CHM_STATS_INITIAL_POLL_INTERVAL_MS;
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_CHM_STATS_MAX_DURATION_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_CHM_STATS_MAX_RETRIES;
  const maxRetryDelayMs = options?.maxRetryDelayMs ?? DEFAULT_CHM_STATS_MAX_RETRY_DELAY_MS;
  const wait = options?.wait ?? waitForDelay;
  const startedAt = Date.now();
  const deadline = startedAt + maxDurationMs;

  logChmStatsDebug("job_start", {
    baseUrl: options?.baseUrl ?? DEFAULT_CHM_STATS_API_BASE_URL,
    pollIntervalMs,
    maxDurationMs,
    maxRetries,
    maxRetryDelayMs,
  });

  const assertNotTimedOut = () => {
    if (Date.now() > deadline) {
      throw new Error("CHM stats job timed out.");
    }
  };

  const createdJob = await withTransientRetries(
    () => submitChmStatsJob(payload, {
      baseUrl: options?.baseUrl,
      apiKey: options?.apiKey,
      signal: options?.signal,
      createRequestTimeoutMs: options?.createRequestTimeoutMs,
      statusRequestTimeoutMs: options?.statusRequestTimeoutMs,
    }),
    {
      maxRetries,
      initialDelayMs: pollIntervalMs,
      maxDelayMs: maxRetryDelayMs,
      signal: options?.signal,
      wait,
    },
  );

  if (isTerminalJobStatus(createdJob.status)) {
    logChmStatsDebug("job_terminal_from_create", {
      jobId: createdJob.jobId,
      status: createdJob.status,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      jobId: createdJob.jobId,
      status: createdJob.status,
      createdAt: new Date(startedAt).toISOString(),
      progress: createdJob.progress ?? null,
      etaSeconds: createdJob.etaSeconds ?? null,
      message: createdJob.message,
      result: createdJob.result ?? null,
      error: createdJob.error ?? null,
    };
  }

  const jobId = createdJob.jobId;

  logChmStatsDebug("job_created", {
    jobId,
    status: createdJob.status,
    elapsedMs: Date.now() - startedAt,
  });

  options?.onUpdate?.({
    jobId,
    status: createdJob.status,
    createdAt: new Date(startedAt).toISOString(),
    progress: createdJob.progress ?? null,
    etaSeconds: createdJob.etaSeconds ?? null,
    message: createdJob.message,
    result: createdJob.result ?? null,
    error: createdJob.error ?? null,
  });

  while (true) {
    assertNotTimedOut();

    logChmStatsDebug("job_poll_start", {
      jobId,
      elapsedMs: Date.now() - startedAt,
    });

    const statusResponse = await withTransientRetries(
      () => fetchChmStatsJob(jobId, {
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        signal: options?.signal,
        createRequestTimeoutMs: options?.createRequestTimeoutMs,
        statusRequestTimeoutMs: options?.statusRequestTimeoutMs,
      }),
      {
        maxRetries,
        initialDelayMs: pollIntervalMs,
        maxDelayMs: maxRetryDelayMs,
        signal: options?.signal,
        wait,
      },
    );

    options?.onUpdate?.(statusResponse);

    logChmStatsDebug("job_poll_update", {
      jobId,
      status: statusResponse.status,
      progress: statusResponse.progress ?? null,
      etaSeconds: statusResponse.etaSeconds ?? null,
      message: statusResponse.message ?? null,
      elapsedMs: Date.now() - startedAt,
    });

    if (isTerminalJobStatus(statusResponse.status)) {
      logChmStatsDebug("job_terminal", {
        jobId,
        status: statusResponse.status,
        elapsedMs: Date.now() - startedAt,
      });
      return statusResponse;
    }

    assertNotTimedOut();
    logChmStatsDebug("job_poll_wait", {
      jobId,
      waitMs: pollIntervalMs,
      elapsedMs: Date.now() - startedAt,
    });
    await wait(pollIntervalMs, options?.signal);
  }
}

export function formatChmStatsError(error: unknown): string {
  if (error instanceof ChmStatsValidationError) {
    return error.message;
  }

  if (error instanceof ChmStatsApiError) {
    if (error.status === 401) {
      return "Invalid API key or CHM stats API is not configured.";
    }

    if (error.status === 422) {
      return error.message || "Validation failed.";
    }

    if (error.status === 429) {
      return error.message || "Queue is busy. Please retry in a moment.";
    }

    if (error.status === 404) {
      return error.message || "CHM stats job not found.";
    }

    return error.message || "CHM stats request failed.";
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "CHM stats request was cancelled.";
    }

    return error.message || "CHM stats request failed.";
  }

  return "CHM stats request failed.";
}
