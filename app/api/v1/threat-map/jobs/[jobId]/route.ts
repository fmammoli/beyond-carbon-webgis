import { NextResponse } from "next/server";

import {
  getThreatMapApiKey,
  getThreatMapProxyTimeoutMs,
  resolveThreatMapJobUpstreamUrl,
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

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  if (!jobId) {
    return buildErrorResponse(400, "Missing jobId route parameter.");
  }

  try {
    const response = await sendThreatMapUpstreamRequest(
      "GET",
      resolveThreatMapJobUpstreamUrl(jobId),
      {
        apiKey: getThreatMapApiKey() ?? request.headers.get("x-api-key") ?? undefined,
        timeoutMs: getThreatMapProxyTimeoutMs(),
      },
    );

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Failed to reach upstream threat-map service.";
    return buildErrorResponse(502, "Threat map upstream request failed.", details);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  if (!jobId) {
    return buildErrorResponse(400, "Missing jobId route parameter.");
  }

  try {
    return await sendThreatMapUpstreamRequest(
      "DELETE",
      resolveThreatMapJobUpstreamUrl(jobId),
      {
        apiKey: getThreatMapApiKey() ?? request.headers.get("x-api-key") ?? undefined,
        timeoutMs: getThreatMapProxyTimeoutMs(),
      },
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : "Failed to reach upstream threat-map service.";
    return buildErrorResponse(502, "Threat map upstream request failed.", details);
  }
}
