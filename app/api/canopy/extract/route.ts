import { NextResponse } from "next/server";
import {
  buildCanopyUpstreamHeaders,
  getCanopyApiKey,
  getCanopyProxyTimeoutMs,
  getCanopyUpstreamHostHeader,
  resolveCanopyJobsUpstreamUrl,
  sendCanopyUpstreamRequest,
} from "@/lib/canopy-extract-proxy";

export const runtime = "nodejs";

type CanopyExtractBody = {
  geojson?: unknown;
};

function buildJobStatusUrl(jobId: string): string {
  const upstreamUrl = resolveCanopyJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
  return upstreamUrl.toString();
}

function buildErrorResponse(status: number, message: string, details?: string) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    { status },
  );
}

async function proxyUpstreamRequest(method: "POST" | "GET", upstreamUrl: string, body?: string) {
  const apiKey = getCanopyApiKey();
  if (!apiKey) {
    return buildErrorResponse(500, "Missing CHM_API_KEY on the server. Add it to .env.local and restart Next.js.");
  }

  const upstreamResponse = await sendCanopyUpstreamRequest(
    method,
    upstreamUrl,
    buildCanopyUpstreamHeaders({
      apiKey,
      hostHeader: getCanopyUpstreamHostHeader(),
      body,
    }),
    body,
    getCanopyProxyTimeoutMs(),
  );

  return new Response(new Uint8Array(upstreamResponse.body), {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

export async function POST(request: Request) {
  let body: CanopyExtractBody;

  try {
    body = (await request.json()) as CanopyExtractBody;
  } catch {
    return buildErrorResponse(400, "Invalid JSON body.");
  }

  if (!body.geojson) {
    return buildErrorResponse(400, "Missing geojson field.");
  }

  const upstreamUrl = resolveCanopyJobsUpstreamUrl().toString();
  const requestBody = JSON.stringify({
    geojson: body.geojson,
  });

  return proxyUpstreamRequest("POST", upstreamUrl, requestBody);
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");

  if (!jobId) {
    return buildErrorResponse(400, "Missing jobId query parameter.");
  }

  return proxyUpstreamRequest("GET", buildJobStatusUrl(jobId));
}
