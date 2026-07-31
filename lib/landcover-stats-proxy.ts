import http from "node:http";
import https from "node:https";

export const DEFAULT_LANDCOVER_STATS_UPSTREAM_JOBS_URL =
  "http://178.104.153.106/api/v1/landcover/stats/jobs";
export const DEFAULT_LANDCOVER_STATS_PROXY_TIMEOUT_MS = 300_000;

export type UpstreamProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export function getLandcoverStatsApiKey(): string | null {
  return (
    process.env.LANDCOVER_STATS_API_KEY ??
    process.env.CHM_API_KEY ??
    process.env.CANOPY_API_KEY ??
    null
  );
}

export function getLandcoverStatsUpstreamHostHeader(): string | undefined {
  return process.env.LANDCOVER_STATS_API_HOST_HEADER || undefined;
}

export function getLandcoverStatsProxyTimeoutMs(): number {
  return (
    Number.parseInt(process.env.LANDCOVER_STATS_API_TIMEOUT_MS ?? "", 10) ||
    DEFAULT_LANDCOVER_STATS_PROXY_TIMEOUT_MS
  );
}

function resolveLandcoverStatsConfiguredUpstreamUrl(): string {
  const explicitUrl =
    process.env.LANDCOVER_STATS_API_URL ?? process.env.LANDCOVER_STATS_API_BASE_URL;

  if (explicitUrl) {
    return explicitUrl;
  }

  const defaultTarget = process.env.NODE_ENV === "production" ? "remote" : "local";
  const target = (process.env.LANDCOVER_STATS_TARGET ?? defaultTarget).trim().toLowerCase();
  const localUrl = process.env.LANDCOVER_STATS_LOCAL_API_URL?.trim();
  const remoteUrl = process.env.LANDCOVER_STATS_REMOTE_API_URL?.trim();

  if (target === "remote" && remoteUrl) {
    return remoteUrl;
  }

  if (target === "local" && localUrl) {
    return localUrl;
  }

  if (remoteUrl && !localUrl) {
    return remoteUrl;
  }

  if (localUrl) {
    return localUrl;
  }

  return DEFAULT_LANDCOVER_STATS_UPSTREAM_JOBS_URL;
}

export function resolveLandcoverStatsJobsUpstreamUrl(): URL {
  const rawUrl = resolveLandcoverStatsConfiguredUpstreamUrl();
  const url = new URL(rawUrl);

  if (url.pathname.endsWith("/jobs")) {
    return url;
  }

  const trimmedPath = url.pathname.replace(/\/$/, "");
  if (trimmedPath.endsWith("/landcover/stats")) {
    url.pathname = `${trimmedPath}/jobs`;
    return url;
  }

  url.pathname = `${trimmedPath}/jobs`;
  return url;
}

export function resolveLandcoverStatsJobStatusUpstreamUrl(jobId: string): string {
  const upstreamUrl = resolveLandcoverStatsJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
  return upstreamUrl.toString();
}

export function buildLandcoverStatsUpstreamHeaders(options: {
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

export function sendLandcoverStatsUpstreamRequest(
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