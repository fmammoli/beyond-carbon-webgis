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

function buildErrorResponse(status: number, message: string, details?: string) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    { status },
  );
}

function buildDownloadUrl(jobId: string): string {
  const upstreamUrl = resolveCanopyJobsUpstreamUrl();
  upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${encodeURIComponent(jobId)}/download`;
  return upstreamUrl.toString();
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");

  if (!jobId) {
    return buildErrorResponse(400, "Missing jobId query parameter.");
  }

  const apiKey = getCanopyApiKey();
  if (!apiKey) {
    return buildErrorResponse(500, "Missing CHM_API_KEY on the server. Add it to .env.local and restart Next.js.");
  }

  const upstreamResponse = await sendCanopyUpstreamRequest(
    "GET",
    buildDownloadUrl(jobId),
    buildCanopyUpstreamHeaders({
      apiKey,
      hostHeader: getCanopyUpstreamHostHeader(),
    }),
    undefined,
    getCanopyProxyTimeoutMs(),
  );

  return new Response(new Uint8Array(upstreamResponse.body), {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}
