import { NextResponse } from "next/server";

import {
  buildAgbStatsUpstreamHeaders,
  getAgbStatsApiKey,
  getAgbStatsProxyTimeoutMs,
  getAgbStatsUpstreamHostHeader,
  resolveAgbStatsJobStatusUpstreamUrl,
  sendAgbStatsUpstreamRequest,
} from "@/lib/agb-stats-proxy";

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

async function proxyUpstreamRequest(method: "GET", upstreamUrl: string, apiKey?: string) {
  const upstreamResponse = await sendAgbStatsUpstreamRequest(
    method,
    upstreamUrl,
    buildAgbStatsUpstreamHeaders({
      apiKey,
      hostHeader: getAgbStatsUpstreamHostHeader(),
    }),
    undefined,
    getAgbStatsProxyTimeoutMs(),
  );

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
  responseHeaders.set("Pragma", "no-cache");
  responseHeaders.set("Expires", "0");

  return new Response(new Uint8Array(upstreamResponse.body), {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  if (!jobId) {
    return buildErrorResponse(400, "Missing jobId route parameter.");
  }

  const upstreamApiKey = getAgbStatsApiKey() ?? request.headers.get("x-api-key") ?? undefined;

  try {
    return await proxyUpstreamRequest(
      "GET",
      resolveAgbStatsJobStatusUpstreamUrl(jobId),
      upstreamApiKey,
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : "Failed to reach upstream AGB stats service.";
    return buildErrorResponse(502, "AGB stats upstream request failed.", details);
  }
}
