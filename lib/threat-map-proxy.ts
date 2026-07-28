const DEFAULT_THREAT_MAP_UPSTREAM_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX = "/api/v1/threat-map";
const DEFAULT_THREAT_MAP_PROXY_TIMEOUT_MS = 300_000;
const DEFAULT_THREAT_MAP_LOCAL_DEV_API_KEY = "chm_beyond_carbon_workshop";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function resolveThreatMapUpstreamBaseUrl(): string {
  const candidate = (
    process.env.THREAT_MAP_API_URL
    ?? process.env.THREAT_MAP_API_BASE_URL
    ?? process.env.NEXT_PUBLIC_THREAT_MAP_API_BASE_URL
    ?? DEFAULT_THREAT_MAP_UPSTREAM_BASE_URL
  ).trim();

  return normalizeBaseUrl(candidate);
}

function resolveThreatMapPath(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${resolveThreatMapUpstreamBaseUrl()}${DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX}${normalizedPath}`;
}

export function resolveThreatMapJobsUpstreamUrl(): string {
  return resolveThreatMapPath("/jobs");
}

export function resolveThreatMapJobUpstreamUrl(jobId: string): string {
  return resolveThreatMapPath(`/jobs/${encodeURIComponent(jobId)}`);
}

export function resolveThreatMapJobDownloadUpstreamUrl(jobId: string): string {
  return resolveThreatMapPath(`/jobs/${encodeURIComponent(jobId)}/download`);
}

export function getThreatMapApiKey(): string | null {
  const apiKey = (
    process.env.THREAT_MAP_API_KEY
    ?? process.env.LANDCOVER_STATS_API_KEY
    ?? process.env.CHM_API_KEY
    ?? process.env.CANOPY_API_KEY
    ?? process.env.NEXT_PUBLIC_API_KEY
    ?? process.env.NEXT_PUBLIC_THREAT_MAP_API_KEY
    ?? ""
  ).trim();

  if (apiKey) {
    return apiKey;
  }

  try {
    const upstream = new URL(resolveThreatMapUpstreamBaseUrl());
    if (upstream.hostname === "localhost" || upstream.hostname === "127.0.0.1") {
      return DEFAULT_THREAT_MAP_LOCAL_DEV_API_KEY;
    }
  } catch {
    return null;
  }

  return null;
}

export function getThreatMapProxyTimeoutMs(): number {
  const raw = process.env.THREAT_MAP_PROXY_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_THREAT_MAP_PROXY_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_THREAT_MAP_PROXY_TIMEOUT_MS;
  }

  return parsed;
}

function stripHopByHopHeaders(headers: Headers): Headers {
  const filtered = new Headers(headers);
  filtered.delete("connection");
  filtered.delete("keep-alive");
  filtered.delete("proxy-authenticate");
  filtered.delete("proxy-authorization");
  filtered.delete("te");
  filtered.delete("trailers");
  filtered.delete("transfer-encoding");
  filtered.delete("upgrade");
  return filtered;
}

export async function sendThreatMapUpstreamRequest(
  method: "GET" | "POST" | "DELETE",
  upstreamUrl: string,
  options?: {
    body?: string;
    apiKey?: string;
    incomingContentType?: string | null;
    timeoutMs?: number;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? getThreatMapProxyTimeoutMs();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers = new Headers();
    const resolvedApiKey = options?.apiKey ?? getThreatMapApiKey();
    if (resolvedApiKey) {
      headers.set("X-API-Key", resolvedApiKey);
    }

    if (options?.body) {
      headers.set("Content-Type", options.incomingContentType || "application/json");
    }

    const response = await fetch(upstreamUrl, {
      method,
      headers,
      body: options?.body,
      signal: controller.signal,
      cache: "no-store",
    });

    const clonedHeaders = stripHopByHopHeaders(response.headers);
    return new Response(response.body, {
      status: response.status,
      headers: clonedHeaders,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
