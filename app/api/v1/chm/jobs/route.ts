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

type CreateChmJobBody = {
  geojson?: unknown;
};

function buildErrorResponse(status: number, message: string, details?: string) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    { status },
  );
}

async function proxyUpstreamRequest(method: "POST", upstreamUrl: string, body: string) {
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
  let body: CreateChmJobBody;

  try {
    body = (await request.json()) as CreateChmJobBody;
  } catch {
    return buildErrorResponse(400, "Invalid JSON body.");
  }

  if (!body.geojson) {
    return buildErrorResponse(400, "Missing geojson field.");
  }

  const requestBody = JSON.stringify({
    geojson: body.geojson,
  });

  return proxyUpstreamRequest("POST", resolveCanopyJobsUpstreamUrl().toString(), requestBody);
}