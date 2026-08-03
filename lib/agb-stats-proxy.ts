import http from "node:http";
import https from "node:https";

export const DEFAULT_AGB_STATS_UPSTREAM_JOBS_URL =
  "http://178.104.153.106/api/v1/agb/stats/jobs";
export const DEFAULT_AGB_STATS_PROXY_TIMEOUT_MS = 300_000;

export type UpstreamProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

function getApiMode(): "local" | "remote" {
  return (process.env.API_MODE ?? "local").trim().toLowerCase() === "remote" ? "remote" : "local";
}

function resolveApiBaseUrl(): string {
  const mode = getApiMode();
  const localBaseUrl = process.env.API_BASE_URL_LOCAL?.trim() ?? "http://127.0.0.1:8000";
  const remoteBaseUrl = process.env.API_BASE_URL_REMOTE?.trim() ?? "http://178.104.153.106";
  return mode === "remote" ? remoteBaseUrl : localBaseUrl;
}

function resolveEndpoint(path: string): string {
  const baseUrl = resolveApiBaseUrl();
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

export function getAgbStatsApiKey(): string | null {
  const mode = getApiMode();
  const localApiKey = process.env.LOCAL_API_KEY?.trim() ?? "chm_beyond_carbon_workshop";
  const remoteApiKey = process.env.REMOTE_API_KEY?.trim() ?? "0XYnNKOkn/INu9CNtKPwATKoL1knq3IQgl6w+MIfxUQ=";
  return mode === "remote" ? remoteApiKey : localApiKey;
}

export function getAgbStatsUpstreamHostHeader(): string | undefined {
  return process.env.AGB_STATS_API_HOST_HEADER ?? process.env.CANOPY_API_HOST_HEADER ?? undefined;
}

export function getAgbStatsProxyTimeoutMs(): number {
  return (
    Number.parseInt(process.env.AGB_STATS_API_TIMEOUT_MS ?? "", 10) ||
    Number.parseInt(process.env.CANOPY_API_TIMEOUT_MS ?? "", 10) ||
    DEFAULT_AGB_STATS_PROXY_TIMEOUT_MS
  );
}

function resolveAgbStatsConfiguredUpstreamUrl(): string {
  const endpoint = process.env.AGB_STATS_ENDPOINT?.trim() ?? "/api/v1/agb/stats";
  return resolveEndpoint(endpoint);
}

export function resolveAgbStatsJobsUpstreamUrl(): URL {
  const rawUrl = resolveAgbStatsConfiguredUpstreamUrl();
  const url = new URL(rawUrl);

  if (url.pathname.endsWith("/jobs")) {
    return url;
  }

  const trimmedPath = url.pathname.replace(/\/$/, "");
  if (trimmedPath.endsWith("/agb/stats")) {
    url.pathname = `${trimmedPath}/jobs`;
    return url;
  }

  if (trimmedPath.endsWith("/ctrees/agb/stats")) {
    url.pathname = `${trimmedPath}/jobs`;
    return url;
  }

  url.pathname = `${trimmedPath}/jobs`;
  return url;
}

export function resolveAgbStatsJobStatusUpstreamUrl(jobId: string): string {
  const upstreamUrl = resolveAgbStatsJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
  return upstreamUrl.toString();
}

export function buildAgbStatsUpstreamHeaders(options: {
  apiKey?: string;
  hostHeader?: string;
  body?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options.apiKey) {
    headers["X-API-Key"] = options.apiKey;
  }

  if (options.hostHeader) {
    headers.Host = options.hostHeader;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(options.body).toString();
  }

  return headers;
}

export function sendAgbStatsUpstreamRequest(
  method: "GET" | "POST",
  upstreamUrl: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<UpstreamProxyResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(upstreamUrl);
    const isHttps = url.protocol === "https:";
    const requestImpl = isHttps ? https.request : http.request;

    const request = requestImpl(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") {
              responseHeaders[key] = value;
            } else if (Array.isArray(value)) {
              responseHeaders[key] = value.join(", ");
            }
          }

          resolve({
            status: response.statusCode ?? 502,
            headers: responseHeaders,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Upstream request timed out after ${timeoutMs}ms`));
    });

    if (body) {
      request.write(body);
    }

    request.end();
  });
}
