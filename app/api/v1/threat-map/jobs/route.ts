import { NextResponse } from "next/server";

import {
  getThreatMapApiKey,
  getThreatMapProxyTimeoutMs,
  resolveThreatMapJobsUpstreamUrl,
  sendThreatMapUpstreamRequest,
} from "@/lib/threat-map-proxy";

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

export async function POST(request: Request) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return buildErrorResponse(400, "Invalid JSON body.");
  }

  try {
    const response = await sendThreatMapUpstreamRequest(
      "POST",
      resolveThreatMapJobsUpstreamUrl(),
      {
        body: JSON.stringify(requestBody),
        apiKey: getThreatMapApiKey() ?? request.headers.get("x-api-key") ?? undefined,
        incomingContentType: request.headers.get("content-type"),
        timeoutMs: getThreatMapProxyTimeoutMs(),
      },
    );

    return response;
  } catch (error) {
    const details = error instanceof Error ? error.message : "Failed to reach upstream threat-map service.";
    return buildErrorResponse(502, "Threat map upstream request failed.", details);
  }
}
