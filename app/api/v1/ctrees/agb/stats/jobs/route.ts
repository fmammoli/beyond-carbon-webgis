import { NextResponse } from "next/server";

import {
  buildAgbStatsUpstreamHeaders,
  getAgbStatsApiKey,
  getAgbStatsProxyTimeoutMs,
  getAgbStatsUpstreamHostHeader,
  resolveAgbStatsJobsUpstreamUrl,
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

async function proxyUpstreamRequest(method: "POST", upstreamUrl: string, body: string, apiKey?: string) {
  const upstreamResponse = await sendAgbStatsUpstreamRequest(
    method,
    upstreamUrl,
    buildAgbStatsUpstreamHeaders({
      apiKey,
      hostHeader: getAgbStatsUpstreamHostHeader(),
      body,
    }),
    body,
    getAgbStatsProxyTimeoutMs(),
  );

  return new Response(new Uint8Array(upstreamResponse.body), {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

export async function POST(request: Request) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return buildErrorResponse(400, "Invalid JSON body.");
  }

  const body = JSON.stringify(requestBody);
  const upstreamApiKey =
    getAgbStatsApiKey() ?? request.headers.get("x-api-key") ?? undefined;

  try {
    return await proxyUpstreamRequest(
      "POST",
      resolveAgbStatsJobsUpstreamUrl().toString(),
      body,
      upstreamApiKey,
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : "Failed to reach upstream AGB stats service.";
    return buildErrorResponse(502, "AGB stats upstream request failed.", details);
  }
}