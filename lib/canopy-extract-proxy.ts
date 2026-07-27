import http from "node:http";
import https from "node:https";

export const DEFAULT_CANOPY_UPSTREAM_JOBS_URL = "http://178.104.153.106/api/v1/chm/jobs";
export const DEFAULT_CANOPY_PROXY_TIMEOUT_MS = 300_000;

export type UpstreamProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export function getCanopyApiKey(): string | null {
  return process.env.CHM_API_KEY ?? process.env.CANOPY_API_KEY ?? null;
}

export function getCanopyUpstreamHostHeader(): string | undefined {
  return process.env.CANOPY_API_HOST_HEADER || undefined;
}

export function getCanopyProxyTimeoutMs(): number {
  return Number.parseInt(process.env.CANOPY_API_TIMEOUT_MS ?? "", 10) || DEFAULT_CANOPY_PROXY_TIMEOUT_MS;
}

export function resolveCanopyJobsUpstreamUrl(): URL {
  const rawUrl = process.env.CANOPY_API_URL ?? DEFAULT_CANOPY_UPSTREAM_JOBS_URL;
  const url = new URL(rawUrl);

  if (url.pathname.endsWith("/crop")) {
    url.pathname = `${url.pathname.slice(0, -"/crop".length)}/jobs`;
  } else if (!url.pathname.endsWith("/jobs")) {
    const trimmedPath = url.pathname.replace(/\/$/, "");
    url.pathname = `${trimmedPath}/jobs`;
  }

  return url;
}

export function resolveCanopyJobStatusUpstreamUrl(jobId: string): string {
  const upstreamUrl = resolveCanopyJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
  return upstreamUrl.toString();
}

export function resolveCanopyJobDownloadUpstreamUrl(jobId: string): string {
  const upstreamUrl = resolveCanopyJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}/download`;
  return upstreamUrl.toString();
}

export function buildCanopyUpstreamHeaders(options: {
  apiKey: string;
  hostHeader?: string;
  body?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-API-Key": options.apiKey,
  };

  if (options.hostHeader) {
    headers.Host = options.hostHeader;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(options.body).toString();
  }

  return headers;
}

export function sendCanopyUpstreamRequest(
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
