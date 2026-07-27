import { NextResponse } from "next/server";

import {
  buildCanopyUpstreamHeaders,
  getCanopyApiKey,
  getCanopyProxyTimeoutMs,
  getCanopyUpstreamHostHeader,
  resolveCanopyJobDownloadUpstreamUrl,
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

async function proxyUpstreamRequest(method: "GET", upstreamUrl: string) {
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
    }),
    undefined,
    getCanopyProxyTimeoutMs(),
  );

  return new Response(new Uint8Array(upstreamResponse.body), {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  if (!jobId) {
    return buildErrorResponse(400, "Missing jobId route parameter.");
  }

  return proxyUpstreamRequest("GET", resolveCanopyJobDownloadUpstreamUrl(jobId));
}