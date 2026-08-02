import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

export const DEFAULT_LANDCOVER_STATS_API_BASE_URL = "/api/v1/landcover/stats";
export const DEFAULT_LANDCOVER_STATS_INITIAL_POLL_INTERVAL_MS = 1500;
export const DEFAULT_LANDCOVER_STATS_MAX_DURATION_MS = 180_000;
export const DEFAULT_LANDCOVER_STATS_MAX_RETRIES = 3;
export const DEFAULT_LANDCOVER_STATS_MAX_RETRY_DELAY_MS = 10_000;
export const DEFAULT_LANDCOVER_STATS_CREATE_REQUEST_TIMEOUT_MS = 20_000;
export const DEFAULT_LANDCOVER_STATS_STATUS_REQUEST_TIMEOUT_MS = 20_000;

const LANDCOVER_STATS_DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_LANDCOVER_STATS_DEBUG === "1";

function logLandcoverStatsDebug(event: string, details?: Record<string, unknown>) {
  if (!LANDCOVER_STATS_DEBUG_ENABLED || typeof console === "undefined") {
    return;
  }

  const timestamp = new Date().toISOString();
  if (details) {
    console.info(`[landcover-stats] ${timestamp} ${event}`, details);
    return;
  }

  console.info(`[landcover-stats] ${timestamp} ${event}`);
}

export type LandcoverStatsJobStatus = "queued" | "running" | "succeeded" | "failed";

export type LandcoverStatsResult = {
  baselineYear?: number;
  comparisonYear?: number;
  forestLossHa: number;
  forestLossPct?: number;
  forestGainHa: number;
  forestGainPct?: number;
  netForestChangeHa: number;
  baselineForestAreaHa: number;
  comparisonForestAreaHa: number;
  analyzedAreaHa: number;
  aoiAreaHa: number;
  coverageFraction: number;
  validPixelCount: number;
  metadata?: Record<string, unknown>;
};

export type LandcoverStatsJobCreateRequest = {
  geojson: FeatureCollection<Geometry, GeoJsonProperties> | Feature<Geometry, GeoJsonProperties> | object;
  baselineYear: number;
  comparisonYear: number;
};

export type LandcoverStatsJobCreateResponse = {
  jobId: string;
  status: LandcoverStatsJobStatus;
  message: string;
  progress?: number | null;
  etaSeconds?: number | null;
  result?: LandcoverStatsResult | null;
  error?: { code: string; message: string } | null;
};

export type LandcoverStatsJobStatusResponse = {
  jobId: string;
  status: LandcoverStatsJobStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  progress?: number | null;
  etaSeconds?: number | null;
  message?: string | null;
  result?: LandcoverStatsResult | null;
  error?: { code: string; message: string } | null;
};

type LandcoverStatsJobErrorPayload = {
  code: string;
  message: string;
};

export type LandcoverStatsClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  createRequestTimeoutMs?: number;
  statusRequestTimeoutMs?: number;
};

export type LandcoverStatsPollOptions = LandcoverStatsClientOptions & {
  pollIntervalMs?: number;
  maxDurationMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onUpdate?: (job: LandcoverStatsJobStatusResponse) => void;
};

export class LandcoverStatsApiError extends Error {
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
    this.name = "LandcoverStatsApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.payload = options.payload;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class LandcoverStatsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LandcoverStatsValidationError";
  }
}

function normalizeJobStatus(rawStatus: unknown, rawRecord?: Record<string, unknown>): LandcoverStatsJobStatus {
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

  throw new Error(`Unsupported landcover stats job status: ${String(rawStatus ?? "<missing>")}`);
}

function normalizeCreateJobResponse(payload: unknown): LandcoverStatsJobCreateResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid landcover stats create-job response payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim()) ||
    (typeof record.job_id === "string" && record.job_id.trim()) ||
    null;

  if (!jobId) {
    throw new Error("Landcover stats create-job response is missing jobId.");
  }

  return {
    jobId,
    status: normalizeJobStatus(record.status, record),
    message:
      (typeof record.message === "string" && record.message) ||
      "Landcover stats job submitted.",
    progress: typeof record.progress === "number" ? record.progress : null,
    etaSeconds: typeof record.etaSeconds === "number"
      ? record.etaSeconds
      : typeof record.eta_seconds === "number"
        ? record.eta_seconds
        : null,
    result: normalizeLandcoverStatsResult(record.result),
    error: normalizeLandcoverStatsJobError(record.error),
  };
}

function normalizeJobStatusResponse(payload: unknown): LandcoverStatsJobStatusResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid landcover stats job-status response payload.");
  }

  const record = payload as Record<string, unknown>;
  const jobId =
    (typeof record.jobId === "string" && record.jobId.trim()) ||
    (typeof record.job_id === "string" && record.job_id.trim()) ||
    null;

  if (!jobId) {
    throw new Error("Landcover stats status response is missing jobId.");
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
    result: normalizeLandcoverStatsResult(record.result),
    error: normalizeLandcoverStatsJobError(record.error),
  };
}

function readNumberField(record: Record<string, unknown>, camelCaseKey: string, snakeCaseKey: string): number {
  const value = record[camelCaseKey] ?? record[snakeCaseKey];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Landcover stats result is missing numeric field: ${camelCaseKey}`);
  }

  return value;
}

function readOptionalNumberField(record: Record<string, unknown>, camelCaseKey: string, snakeCaseKey: string): number | undefined {
  const value = record[camelCaseKey] ?? record[snakeCaseKey];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Landcover stats result has invalid numeric field: ${camelCaseKey}`);
  }

  return value;
}

function normalizeLandcoverStatsResult(payload: unknown): LandcoverStatsResult | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid landcover stats result payload.");
  }

  const record = payload as Record<string, unknown>;

  return {
    baselineYear: readOptionalNumberField(record, "baselineYear", "baseline_year"),
    comparisonYear: readOptionalNumberField(record, "comparisonYear", "comparison_year"),
    forestLossHa: readNumberField(record, "forestLossHa", "forest_loss_ha"),
    forestLossPct: readOptionalNumberField(record, "forestLossPct", "forest_loss_pct"),
    forestGainHa: readNumberField(record, "forestGainHa", "forest_gain_ha"),
    forestGainPct: readOptionalNumberField(record, "forestGainPct", "forest_gain_pct"),
    netForestChangeHa: readNumberField(record, "netForestChangeHa", "net_forest_change_ha"),
    baselineForestAreaHa: readNumberField(record, "baselineForestAreaHa", "baseline_forest_area_ha"),
    comparisonForestAreaHa: readNumberField(record, "comparisonForestAreaHa", "comparison_forest_area_ha"),
    analyzedAreaHa: readNumberField(record, "analyzedAreaHa", "analyzed_area_ha"),
    aoiAreaHa: readNumberField(record, "aoiAreaHa", "aoi_area_ha"),
    coverageFraction: readNumberField(record, "coverageFraction", "coverage_fraction"),
    validPixelCount: readNumberField(record, "validPixelCount", "valid_pixel_count"),
    metadata: record.metadata && typeof record.metadata === "object"
      ? record.metadata as Record<string, unknown>
      : undefined,
  };
}

function normalizeLandcoverStatsJobError(payload: unknown): LandcoverStatsJobErrorPayload | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return {
      code: "LANDCOVER_STATS_JOB_FAILED",
      message: "Landcover stats job failed.",
    };
  }

  const record = payload as Record<string, unknown>;
  const code = typeof record.code === "string" && record.code.trim()
    ? record.code.trim()
    : "LANDCOVER_STATS_JOB_FAILED";
  const message = typeof record.message === "string" && record.message.trim()
    ? record.message.trim()
    : "Landcover stats job failed.";

  return { code, message };
}

function resolveLandcoverStatsBaseUrl(baseUrl?: string): string {
  const candidate = (baseUrl ?? process.env.NEXT_PUBLIC_LANDCOVER_STATS_API_BASE_URL ?? DEFAULT_LANDCOVER_STATS_API_BASE_URL).trim();
  return candidate.replace(/\/$/, "");
}

function resolveLandcoverStatsApiKey(baseUrl?: string, providedApiKey?: string): string | null {
  const apiKey = (providedApiKey ?? process.env.NEXT_PUBLIC_UPSTREAM_API_KEY ?? process.env.UPSTREAM_API_KEY ?? "").trim();
  if (apiKey) {
    return apiKey;
  }

  const candidateBaseUrl = resolveLandcoverStatsBaseUrl(baseUrl);
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

function buildLandcoverStatsRequestHeaders(
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

  const apiKey = resolveLandcoverStatsApiKey(options.baseUrl, options.apiKey);
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

function resolveLandcoverStatsUrl(pathname: string, baseUrl?: string): string {
  const normalizedBaseUrl = resolveLandcoverStatsBaseUrl(baseUrl);
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
  const error = new Error(`Landcover stats request timed out after ${timeoutMs}ms.`);
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

  logLandcoverStatsDebug("fetch_start", {
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
    logLandcoverStatsDebug("fetch_timeout_abort", {
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

    logLandcoverStatsDebug("fetch_response", {
      url: urlForLogs,
      method: init.method ?? "GET",
      status: response.status,
      ok: response.ok,
      elapsedMs: Date.now() - startedAtMs,
    });

    return response;
  } catch (error) {
    if (didTimeout && isAbortError(error)) {
      logLandcoverStatsDebug("fetch_timeout_error", {
        url: urlForLogs,
        method: init.method ?? "GET",
        timeoutMs,
        elapsedMs: Date.now() - startedAtMs,
      });
      throw createTimedAbortError(timeoutMs);
    }

    logLandcoverStatsDebug("fetch_error", {
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

async function throwForLandcoverStatsResponse(
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
    message = "Invalid API key or landcover stats API is not configured.";
  } else if (status === 404 && context === "status" && !payloadMessage && !rawText.trim()) {
    message = "Landcover stats job not found.";
  } else if (status === 429) {
    message = payloadMessage ?? "Queue is busy. Please retry in a moment.";
  } else if (status === 422) {
    message = payloadMessage ?? "Validation failed.";
  }

  throw new LandcoverStatsApiError(message, {
    status,
    code: extractResponseCode(payload),
    details: rawText.trim() || undefined,
    payload,
    retryAfterMs,
  });
}

function isTerminalJobStatus(status: LandcoverStatsJobStatus): boolean {
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

export function validateLandcoverStatsRequest(payload: LandcoverStatsJobCreateRequest): void {
  if (!hasPolygonGeometry(payload.geojson)) {
    throw new LandcoverStatsValidationError("A polygon GeoJSON feature or feature collection is required.");
  }

  if (!Number.isFinite(payload.baselineYear) || !Number.isFinite(payload.comparisonYear)) {
    throw new LandcoverStatsValidationError("Baseline year and comparison year must be valid numbers.");
  }

  if (!Number.isInteger(payload.baselineYear) || !Number.isInteger(payload.comparisonYear)) {
    throw new LandcoverStatsValidationError("Baseline year and comparison year must be whole numbers.");
  }

  if (payload.baselineYear === payload.comparisonYear) {
    throw new LandcoverStatsValidationError("Baseline year and comparison year must be different.");
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

  if (error instanceof LandcoverStatsApiError) {
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

export async function createLandcoverStatsJob(
  payload: LandcoverStatsJobCreateRequest,
  options?: LandcoverStatsClientOptions,
): Promise<LandcoverStatsJobCreateResponse> {
  validateLandcoverStatsRequest(payload);

  const createRequestTimeoutMs = resolveRequestTimeoutMs(
    options?.createRequestTimeoutMs,
    DEFAULT_LANDCOVER_STATS_CREATE_REQUEST_TIMEOUT_MS,
  );

  const response = await fetchWithTimeout(
    resolveLandcoverStatsUrl("/jobs", options?.baseUrl),
    {
      method: "POST",
      headers: buildLandcoverStatsRequestHeaders({
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
        includeJsonContentType: true,
      }),
      body: JSON.stringify(payload),
    },
    createRequestTimeoutMs,
    options?.signal,
  );

  if (!response.ok) {
    await throwForLandcoverStatsResponse(response, "Landcover stats job creation failed.", "create");
  }

  return normalizeCreateJobResponse(await response.json());
}

export const submitLandcoverStatsJob = createLandcoverStatsJob;

export async function getLandcoverStatsJob(
  jobId: string,
  options?: LandcoverStatsClientOptions,
): Promise<LandcoverStatsJobStatusResponse> {
  const statusRequestTimeoutMs = resolveRequestTimeoutMs(
    options?.statusRequestTimeoutMs,
    DEFAULT_LANDCOVER_STATS_STATUS_REQUEST_TIMEOUT_MS,
  );

  const response = await fetchWithTimeout(
    resolveLandcoverStatsUrl(`/jobs/${encodeURIComponent(jobId)}`, options?.baseUrl),
    {
      method: "GET",
      headers: buildLandcoverStatsRequestHeaders({
        baseUrl: options?.baseUrl,
        apiKey: options?.apiKey,
      }),
      cache: "no-store",
    },
    statusRequestTimeoutMs,
    options?.signal,
  );

  if (!response.ok) {
    await throwForLandcoverStatsResponse(response, "Landcover stats job lookup failed.", "status");
  }

  return normalizeJobStatusResponse(await response.json());
}

export const fetchLandcoverStatsJob = getLandcoverStatsJob;

export async function startLandcoverStatsAndPoll(
  payload: LandcoverStatsJobCreateRequest,
  options?: LandcoverStatsPollOptions,
): Promise<LandcoverStatsJobStatusResponse> {
  validateLandcoverStatsRequest(payload);

  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_LANDCOVER_STATS_INITIAL_POLL_INTERVAL_MS;
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_LANDCOVER_STATS_MAX_DURATION_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_LANDCOVER_STATS_MAX_RETRIES;
  const maxRetryDelayMs = options?.maxRetryDelayMs ?? DEFAULT_LANDCOVER_STATS_MAX_RETRY_DELAY_MS;
  const wait = options?.wait ?? waitForDelay;
  const startedAt = Date.now();
  const deadline = startedAt + maxDurationMs;

  logLandcoverStatsDebug("job_start", {
    baseUrl: options?.baseUrl ?? DEFAULT_LANDCOVER_STATS_API_BASE_URL,
    pollIntervalMs,
    maxDurationMs,
    maxRetries,
    maxRetryDelayMs,
  });

  const assertNotTimedOut = () => {
    if (Date.now() > deadline) {
      throw new Error("Landcover stats job timed out.");
    }
  };

  const createdJob = await withTransientRetries(
    () => submitLandcoverStatsJob(payload, {
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
    logLandcoverStatsDebug("job_terminal_from_create", {
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

  logLandcoverStatsDebug("job_created", {
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

    logLandcoverStatsDebug("job_poll_start", {
      jobId,
      elapsedMs: Date.now() - startedAt,
    });

    const statusResponse = await withTransientRetries(
      () => fetchLandcoverStatsJob(jobId, {
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

    logLandcoverStatsDebug("job_poll_update", {
      jobId,
      status: statusResponse.status,
      progress: statusResponse.progress ?? null,
      etaSeconds: statusResponse.etaSeconds ?? null,
      message: statusResponse.message ?? null,
      elapsedMs: Date.now() - startedAt,
    });

    if (isTerminalJobStatus(statusResponse.status)) {
      logLandcoverStatsDebug("job_terminal", {
        jobId,
        status: statusResponse.status,
        elapsedMs: Date.now() - startedAt,
      });
      return statusResponse;
    }

    assertNotTimedOut();
    logLandcoverStatsDebug("job_poll_wait", {
      jobId,
      waitMs: pollIntervalMs,
      elapsedMs: Date.now() - startedAt,
    });
    await wait(pollIntervalMs, options?.signal);
  }
}

export function formatLandcoverStatsError(error: unknown): string {
  if (error instanceof LandcoverStatsValidationError) {
    return error.message;
  }

  if (error instanceof LandcoverStatsApiError) {
    if (error.status === 401) {
      return "Invalid API key or landcover stats API is not configured.";
    }

    if (error.status === 422) {
      return error.message || "Validation failed.";
    }

    if (error.status === 429) {
      return error.message || "Queue is busy. Please retry in a moment.";
    }

    if (error.status === 404) {
      return error.message || "Landcover stats job not found.";
    }

    return error.message || "Landcover stats request failed.";
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Landcover stats request was cancelled.";
    }

    return error.message || "Landcover stats request failed.";
  }

  return "Landcover stats request failed.";
}