import http from "node:http";
import https from "node:https";

export const DEFAULT_CHM_STATS_UPSTREAM_JOBS_URL =
  "http://127.0.0.1:8000/api/v1/chm/stats/jobs";
export const DEFAULT_CHM_STATS_PROXY_TIMEOUT_MS = 300_000;

export type UpstreamProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export function getChmStatsApiKey(): string | null {
  return (
    process.env.CHM_STATS_API_KEY ??
    process.env.CHM_API_KEY ??
    process.env.CANOPY_API_KEY ??
    null
  );
}

export function getChmStatsUpstreamHostHeader(): string | undefined {
  return process.env.CHM_STATS_API_HOST_HEADER ?? process.env.CANOPY_API_HOST_HEADER ?? undefined;
}

export function getChmStatsProxyTimeoutMs(): number {
  return (
    Number.parseInt(process.env.CHM_STATS_API_TIMEOUT_MS ?? "", 10) ||
    Number.parseInt(process.env.CANOPY_API_TIMEOUT_MS ?? "", 10) ||
    DEFAULT_CHM_STATS_PROXY_TIMEOUT_MS
  );
}

function resolveChmStatsConfiguredUpstreamUrl(): string {
  const explicitUrl =
    process.env.CHM_STATS_API_URL ?? process.env.CHM_STATS_API_BASE_URL;

  if (explicitUrl) {
    return explicitUrl;
  }

  const target = (process.env.CHM_STATS_TARGET ?? "local").trim().toLowerCase();
  const localUrl = process.env.CHM_STATS_LOCAL_API_URL?.trim();
  const remoteUrl = process.env.CHM_STATS_REMOTE_API_URL?.trim();

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

  return DEFAULT_CHM_STATS_UPSTREAM_JOBS_URL;
}

export function resolveChmStatsJobsUpstreamUrl(): URL {
  const rawUrl = resolveChmStatsConfiguredUpstreamUrl();
  const url = new URL(rawUrl);

  if (url.pathname.endsWith("/jobs")) {
    return url;
  }

  const trimmedPath = url.pathname.replace(/\/$/, "");
  if (trimmedPath.endsWith("/chm/stats")) {
    url.pathname = `${trimmedPath}/jobs`;
    return url;
  }

  url.pathname = `${trimmedPath}/jobs`;
  return url;
}

export function resolveChmStatsJobStatusUpstreamUrl(jobId: string): string {
  const upstreamUrl = resolveChmStatsJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
  return upstreamUrl.toString();
}

export function buildChmStatsUpstreamHeaders(options: {
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

export function sendChmStatsUpstreamRequest(
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
