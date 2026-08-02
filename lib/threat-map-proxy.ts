const DEFAULT_THREAT_MAP_UPSTREAM_BASE_URL = "http://178.104.153.106";
const DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX = "/api/v1/threat-map";
const DEFAULT_THREAT_MAP_PROXY_TIMEOUT_MS = 300_000;
const DEFAULT_THREAT_MAP_LOCAL_DEV_API_KEY = "chm_beyond_carbon_workshop";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function getApiMode(): "local" | "remote" {
  return (process.env.API_MODE ?? "local").trim().toLowerCase() === "remote" ? "remote" : "local";
}

function resolveApiBaseUrl(): string {
  const mode = getApiMode();
  const localBaseUrl = process.env.API_BASE_URL_LOCAL?.trim() ?? "http://127.0.0.1:8000";
  const remoteBaseUrl = process.env.API_BASE_URL_REMOTE?.trim() ?? "http://178.104.154.106";
  return mode === "remote" ? remoteBaseUrl : localBaseUrl;
}

function resolveThreatMapUpstreamBaseUrl(): string {
  const baseUrl = resolveApiBaseUrl();
  const parsed = new URL(baseUrl);
  parsed.pathname = process.env.THREAT_MAP_ENDPOINT?.trim() ?? DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX;
  return normalizeBaseUrl(parsed.toString());
}

function resolveThreatMapPath(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const baseUrl = resolveThreatMapUpstreamBaseUrl();
  const parsed = new URL(baseUrl);
  const normalizedBasePath = parsed.pathname.replace(/\/$/, "");

  if (normalizedBasePath === "") {
    parsed.pathname = `${DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX}${normalizedPath}`;
  } else if (normalizedBasePath === DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX) {
    parsed.pathname = `${normalizedBasePath}${normalizedPath}`;
  } else {
    parsed.pathname = `${normalizedBasePath}${DEFAULT_THREAT_MAP_UPSTREAM_PATH_PREFIX}${normalizedPath}`;
  }

  return parsed.toString().replace(/\/$/, "");
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
  const mode = getApiMode();
  const localApiKey = process.env.LOCAL_API_KEY?.trim() ?? DEFAULT_THREAT_MAP_LOCAL_DEV_API_KEY;
  const remoteApiKey = process.env.REMOTE_API_KEY?.trim() ?? "0XYnNKOkn/INu9CNtKPwATKoL1knq3IQgl6w+MIfxUQ=";
  return mode === "remote" ? remoteApiKey : localApiKey;
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
