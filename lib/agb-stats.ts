import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export const DEFAULT_AGB_STATS_API_BASE_URL = "/api/v1/agb/stats";
export const DEFAULT_AGB_STATS_INITIAL_POLL_INTERVAL_MS = 1500;
export const DEFAULT_AGB_STATS_MAX_DURATION_MS = 180_000;
export const DEFAULT_AGB_STATS_MAX_RETRIES = 3;
export const DEFAULT_AGB_STATS_MAX_RETRY_DELAY_MS = 10_000;
export const DEFAULT_AGB_STATS_CREATE_REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_AGB_STATS_STATUS_REQUEST_TIMEOUT_MS = 20_000;

const AGB_STATS_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_AGB_STATS_DEBUG === "1";

function logAgbStatsDebug(event: string, details?: Record<string, unknown>) {
  if (!AGB_STATS_DEBUG_ENABLED || typeof console === "undefined") {
    return;
  }

  const timestamp = new Date().toISOString();
  if (details) {
    console.info(`[agb-stats] ${timestamp} ${event}`, details);
    return;
  }

  console.info(`[agb-stats] ${timestamp} ${event}`);
}

export type AgbStatsJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "deferred"
  | "partial_success"
  | "cancelled";

export type AgbCoverThresholdMetric = {
  thresholdMgHa: number;
  coverRatio: number;
  coverPercent: number;
  coverAreaHa: number;
};

export type AgbStatsMetadata = Record<string, unknown>;

export type AgbStatsResult = {
  baselineYear: number;
  comparisonYear: number;
  minAgbMgHa: number;
  maxAgbMgHa: number;
  meanAgbMgHa: number;
  medianAgbMgHa: number;
  stdDevAgbMgHa: number;
  varianceAgbMgHa2: number;
  p10AgbMgHa: number;
  p25AgbMgHa: number;
  p75AgbMgHa: number;
  p90AgbMgHa: number;
  p95AgbMgHa: number;
  interquartileRangeMgHa: number;
  coefficientOfVariation: number;
  totalAgbMg: number;
  totalAgbMgHa: number;
  baselineTotalAgbMg: number;
  comparisonTotalAgbMg: number;
  agbIncreaseMg: number;
  agbDecreaseMg: number;
  netChangeAgbMg: number;
  netChangeAgbMgHa: number;
  netChangePercent: number;
  agbIncreaseAreaHa: number;
  agbDecreaseAreaHa: number;
  analyzedAreaHa: number;
  aoiAreaHa: number;
  coverageFraction: number;
  validPixelCount: number;
  agbCoverByThreshold: AgbCoverThresholdMetric[];
  metadata?: AgbStatsMetadata;
};

export type AgbStatsJobCreateRequest = {
  geojson: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties> | object;
};

export type AgbStatsJobCreateResponse = {
  jobId: string;
  status: AgbStatsJobStatus;
  message: string;
  progress?: number | null;
  etaSeconds?: number | null;
  result?: AgbStatsResult | null;
  error?: { code: string; message: string } | null;
};

export type AgbStatsJobStatusResponse = {
  jobId: string;
  status: AgbStatsJobStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  progress?: number | null;
  etaSeconds?: number | null;
  message?: string | null;
  result?: AgbStatsResult | null;
  error?: { code: string; message: string } | null;
};

type AgbStatsJobErrorPayload = {
  code: string;
  message: string;
};

export type AgbStatsClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  createRequestTimeoutMs?: number;
  statusRequestTimeoutMs?: number;
};

export type AgbStatsPollOptions = AgbStatsClientOptions & {
  pollIntervalMs?: number;
  maxDurationMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (job: AgbStatsJobStatusResponse) => void;
};

export class AgbStatsApiError extends Error {
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
    this.name = "AgbStatsApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.payload = options.payload;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class AgbStatsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgbStatsValidationError";
  }
}

function normalizeJobStatus(rawStatus: unknown, rawRecord?: Record<string, unknown>): AgbStatsJobStatus {
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

  if (normalized === "deferred") {
    return "deferred";
  }

  if (normalized === "partial_success" || normalized === "partial-success") {
    return "partial_success";
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

  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }

  if (normalized === "failed" || normalized === "error") {
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

  throw new Error(`Unsupported AGB stats job status: ${String(rawStatus ?? "<missing>")}`);
}

function readNumberField(record: Record<string, unknown>, camelCaseKey: string, snakeCaseKey: string): number {
  const value = record[camelCaseKey] ?? record[snakeCaseKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`AGB stats result is missing numeric field: ${camelCaseKey}`);
  }

  return value;
}

function normalizeThresholdMetric(payload: unknown): AgbCoverThresholdMetric {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AGB threshold metric payload.");
  }

  const record = payload as Record<string, unknown>;

  return {
    thresholdMgHa: readNumberField(record, "thresholdMgHa", "threshold_mg_ha"),
    coverRatio: readNumberField(record, "coverRatio", "cover_ratio"),
    coverPercent: readNumberField(record, "coverPercent", "cover_percent"),
    coverAreaHa: readNumberField(record, "coverAreaHa", "cover_area_ha"),
  };
}

function normalizeAgbStatsResult(payload: unknown): AgbStatsResult | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AGB stats result payload.");
  }

  const record = payload as Record<string, unknown>;
  const thresholdRaw = record.agbCoverByThreshold ?? record.agb_cover_by_threshold;
  const agbCoverByThreshold = Array.isArray(thresholdRaw)
    ? thresholdRaw.map((item) => normalizeThresholdMetric(item))
    : [];

  return {
    baselineYear: readNumberField(record, "baselineYear", "baseline_year"),
    comparisonYear: readNumberField(record, "comparisonYear", "comparison_year"),
    minAgbMgHa: readNumberField(record, "minAgbMgHa", "min_agb_mg_ha"),
    maxAgbMgHa: readNumberField(record, "maxAgbMgHa", "max_agb_mg_ha"),
    meanAgbMgHa: readNumberField(record, "meanAgbMgHa", "mean_agb_mg_ha"),
    medianAgbMgHa: readNumberField(record, "medianAgbMgHa", "median_agb_mg_ha"),
    stdDevAgbMgHa: readNumberField(record, "stdDevAgbMgHa", "std_dev_agb_mg_ha"),
    varianceAgbMgHa2: readNumberField(record, "varianceAgbMgHa2", "variance_agb_mg_ha2"),
    p10AgbMgHa: readNumberField(record, "p10AgbMgHa", "p10_agb_mg_ha"),
    p25AgbMgHa: readNumberField(record, "p25AgbMgHa", "p25_agb_mg_ha"),
    p75AgbMgHa: readNumberField(record, "p75AgbMgHa", "p75_agb_mg_ha"),
    p90AgbMgHa: readNumberField(record, "p90AgbMgHa", "p90_agb_mg_ha"),
    p95AgbMgHa: readNumberField(record, "p95AgbMgHa", "p95_agb_mg_ha"),
    interquartileRangeMgHa: readNumberField(record, "interquartileRangeMgHa", "interquartile_range_mg_ha"),
    coefficientOfVariation: readNumberField(record, "coefficientOfVariation", "coefficient_of_variation"),
    totalAgbMg: readNumberField(record, "totalAgbMg", "total_agb_mg"),
    totalAgbMgHa: readNumberField(record, "totalAgbMgHa", "total_agb_mg_ha"),
    baselineTotalAgbMg: readNumberField(record, "baselineTotalAgbMg", "baseline_total_agb_mg"),
    comparisonTotalAgbMg: readNumberField(record, "comparisonTotalAgbMg", "comparison_total_agb_mg"),
    agbIncreaseMg: readNumberField(record, "agbIncreaseMg", "agb_increase_mg"),
    agbDecreaseMg: readNumberField(record, "agbDecreaseMg", "agb_decrease_mg"),
    netChangeAgbMg: readNumberField(record, "netChangeAgbMg", "net_change_agb_mg"),
    netChangeAgbMgHa: readNumberField(record, "netChangeAgbMgHa", "net_change_agb_mg_ha"),
    netChangePercent: readNumberField(record, "netChangePercent", "net_change_percent"),
    agbIncreaseAreaHa: readNumberField(record, "agbIncreaseAreaHa", "agb_increase_area_ha"),
    agbDecreaseAreaHa: readNumberField(record, "agbDecreaseAreaHa", "agb_decrease_area_ha"),
    analyzedAreaHa: readNumberField(record, "analyzedAreaHa", "analyzed_area_ha"),
    aoiAreaHa: readNumberField(record, "aoiAreaHa", "aoi_area_ha"),
    coverageFraction: readNumberField(record, "coverageFraction", "coverage_fraction"),
    validPixelCount: readNumberField(record, "validPixelCount", "valid_pixel_count"),
    agbCoverByThreshold,
    metadata:
      record.metadata && typeof record.metadata === "object"
        ? (record.metadata as AgbStatsMetadata)
        : undefined,
  };
}

function normalizeCreateJobResponse(payload: unknown): AgbStatsJobCreateResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AGB stats create-job response payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim()) ||
    (typeof record.job_id === "string" && record.job_id.trim()) ||
    null;

  if (!jobId) {
    throw new Error("AGB stats create-job response is missing jobId.");
  }

  return {
    jobId,
    status: normalizeJobStatus(record.status, record),
    message:
      (typeof record.message === "string" && record.message) ||
      "AGB stats job submitted.",
    progress: typeof record.progress === "number" ? record.progress : null,
    etaSeconds: typeof record.etaSeconds === "number"
      ? record.etaSeconds
      : typeof record.eta_seconds === "number"
        ? record.eta_seconds
        : null,
    result: normalizeAgbStatsResult(record.result),
    error: normalizeAgbStatsJobError(record.error),
  };
}

function normalizeJobStatusResponse(payload: unknown): AgbStatsJobStatusResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid AGB stats job-status response payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim()) ||
    (typeof record.job_id === "string" && record.job_id.trim()) ||
    null;

  if (!jobId) {
    throw new Error("AGB stats status response is missing jobId.");
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
    result: normalizeAgbStatsResult(record.result),
    error: normalizeAgbStatsJobError(record.error),
  };
}

function normalizeAgbStatsJobError(payload: unknown): AgbStatsJobErrorPayload | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return {
      code: "AGB_STATS_JOB_FAILED",
      message: "AGB stats job failed.",
    };
  }

  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "string" && record.code.trim()
    ? record.code.trim()
    : "AGB_STATS_JOB_FAILED";
  const message = typeof record.message === "string" && record.message.trim()
    ? record.message.trim()
    : "AGB stats job failed.";

  return { code, message };
}

function resolveAgbStatsBaseUrl(baseUrl?: string): string {
  const candidate = (baseUrl ?? process.env.NEXT_PUBLIC_AGB_STATS_API_BASE_URL ?? DEFAULT_AGB_STATS_API_BASE_URL).trim();
  return candidate.replace(/\/$/, "");
}

function buildAgbStatsCreateUrl(baseUrl?: string): string {
  const resolvedBaseUrl = resolveAgbStatsBaseUrl(baseUrl);
  if (resolvedBaseUrl.endsWith("/jobs")) {
    return resolvedBaseUrl;
  }

  return `${resolvedBaseUrl}/jobs`;
}

function buildAgbStatsStatusUrl(jobId: string, baseUrl?: string): string {
  const resolvedBaseUrl = resolveAgbStatsBaseUrl(baseUrl);
  const normalizedBaseUrl = resolvedBaseUrl.endsWith("/jobs")
    ? resolvedBaseUrl.replace(/\/jobs$/, "")
    : resolvedBaseUrl;

  return `${normalizedBaseUrl}/jobs/${encodeURIComponent(jobId)}`;
}

function resolveAgbStatsApiKey(baseUrl?: string, providedApiKey?: string): string | null {
  const apiKey = (providedApiKey ?? process.env.NEXT_PUBLIC_UPSTREAM_API_KEY ?? process.env.UPSTREAM_API_KEY ?? "").trim();
  if (apiKey) {
    return apiKey;
  }

  const candidateBaseUrl = resolveAgbStatsBaseUrl(baseUrl);
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

function buildAgbStatsRequestHeaders(
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

  const apiKey = resolveAgbStatsApiKey(options.baseUrl, options.apiKey);
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

function resolveAgbStatsUrl(pathname: string, baseUrl?: string): string {
  const normalizedBaseUrl = resolveAgbStatsBaseUrl(baseUrl);
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
  const error = new Error(`AGB stats request timed out after ${timeoutMs}ms.`);
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

  logAgbStatsDebug("fetch_start", {
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
    logAgbStatsDebug("fetch_timeout_abort", {
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

    logAgbStatsDebug("fetch_response", {
      url: urlForLogs,
      method: init.method ?? "GET",
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAtMs,
    });

    return response;
  } catch (error) {
    if (didTimeout && isAbortError(error)) {
      logAgbStatsDebug("fetch_timeout_error", {
        url: urlForLogs,
        method: init.method ?? "GET",
        timeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      });
      throw createTimedAbortError(timeoutMs);
    }

    logAgbStatsDebug("fetch_error", {
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

async function throwForAgbStatsResponse(
  response: Response,
  fallbackMessage: string,
  context: "create" | "status",
): Promise<never> {
  const { payload, rawText } = await readErrorPayload(response);
  const payloadMessage = extractMessageFromPayload(payload);
  const retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));
  const status = response.status;

  let message = (payloadMessage ?? rawText.trim()) || fallbackMessage;

  if (status === 401 || status === 403) {
    message = "Invalid API key or AGB stats API is not configured.";
  } else if (status === 404 && context === "status" && !payloadMessage && !rawText.trim()) {
    message = "AGB stats job not found.";
  } else if (status === 429) {
    message = payloadMessage ?? "Queue is busy. Please retry in a moment.";
  } else if (status === 422) {
    message = payloadMessage ?? "Validation failed.";
  }

  throw new AgbStatsApiError(message, {
    status,
    code: extractResponseCode(payload),
    details: rawText.trim() || undefined,
    payload,
    retryAfterMs,
  });
}

function isTerminalJobStatus(status: AgbStatsJobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "partial_success" || status === "cancelled";
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

export function validateAgbStatsRequest(payload: AgbStatsJobCreateRequest): void {
  if (!hasPolygonGeometry(payload.geojson)) {
    throw new AgbStatsValidationError("A polygon GeoJSON feature or feature collection is required.");
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

  if (error instanceof AgbStatsApiError) {
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

export async function createAgbStatsJob(
  payload: AgbStatsJobCreateRequest,
  options?: AgbStatsClientOptions,
): Promise<AgbStatsJobCreateResponse> {
  validateAgbStatsRequest(payload);

  const createRequestTimeoutMs = resolveRequestTimeoutMs(
    options?.createRequestTimeoutMs,
    DEFAULT_AGB_STATS_CREATE_REQUEST_TIMEOUT_MS,
  );

  const response = await fetchWithTimeout(
    resolveAgbStatsUrl("/jobs", options?.baseUrl),
    {
      method: "POST",
      headers: buildAgbStatsRequestHeaders({
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        includeJsonContentType: true,
      }),
      body: JSON.stringify({ geojson: payload.geojson }),
    },
    createRequestTimeoutMs,
    options?.signal,
  );

  if (!response.ok) {
    await throwForAgbStatsResponse(response, "AGB stats job creation failed.", "create");
  }

  return normalizeCreateJobResponse(await response.json());
}

export const submitAgbStatsJob = createAgbStatsJob;

export async function getAgbStatsJob(
  jobId: string,
  options?: AgbStatsClientOptions,
): Promise<AgbStatsJobStatusResponse> {
  const statusRequestTimeoutMs = resolveRequestTimeoutMs(
    options?.statusRequestTimeoutMs,
    DEFAULT_AGB_STATS_STATUS_REQUEST_TIMEOUT_MS,
  );

  const response = await fetchWithTimeout(
    resolveAgbStatsUrl(`/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl),
    {
      method: "GET",
      headers: buildAgbStatsRequestHeaders({
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
      }),
      cache: "no-store",
    },
    statusRequestTimeoutMs,
    options?.signal,
  );

  if (!response.ok) {
    await throwForAgbStatsResponse(response, "AGB stats job lookup failed.", "status");
  }

  return normalizeJobStatusResponse(await response.json());
}

export const fetchAgbStatsJob = getAgbStatsJob;

export async function startAgbStatsAndPoll(
  payload: AgbStatsJobCreateRequest,
  options?: AgbStatsPollOptions,
): Promise<AgbStatsJobStatusResponse> {
  validateAgbStatsRequest(payload);

  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_AGB_STATS_INITIAL_POLL_INTERVAL_MS;
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_AGB_STATS_MAX_DURATION_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_AGB_STATS_MAX_RETRIES;
  const maxRetryDelayMs = options?.maxRetryDelayMs ?? DEFAULT_AGB_STATS_MAX_RETRY_DELAY_MS;
  const wait = options?.wait ?? waitForDelay;
  const startedAt = Date.now();
  const deadline = startedAt + maxDurationMs;

  logAgbStatsDebug("job_start", {
    baseUrl: options?.baseUrl ?? DEFAULT_AGB_STATS_API_BASE_URL,
    pollIntervalMs,
    maxDurationMs,
    maxRetries,
    maxRetryDelayMs,
  });

  const assertNotTimedOut = () => {
    if (Date.now() > deadline) {
      throw new Error("AGB stats job timed out.");
    }
  };

  const createdJob = await withTransientRetries(
    () => submitAgbStatsJob(payload, {
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

    const statusResponse = await withTransientRetries(
      () => fetchAgbStatsJob(jobId, {
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

    if (isTerminalJobStatus(statusResponse.status)) {
      return statusResponse;
    }

    assertNotTimedOut();
    await wait(pollIntervalMs, options?.signal);
  }
}

export function formatAgbStatsError(error: unknown): string {
  if (error instanceof AgbStatsValidationError) {
    return error.message;
  }

  if (error instanceof AgbStatsApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Invalid API key or AGB stats API is not configured.";
    }

    if (error.status === 422) {
      return error.message || "Validation failed.";
    }

    if (error.status === 429) {
      return error.message || "Queue is busy. Please retry in a moment.";
    }

    if (error.status === 404) {
      return error.message || "AGB stats job not found.";
    }

    return error.message || "AGB stats request failed.";
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "AGB stats request was cancelled.";
    }

    return error.message || "AGB stats request failed.";
  }

  return "AGB stats request failed.";
}
