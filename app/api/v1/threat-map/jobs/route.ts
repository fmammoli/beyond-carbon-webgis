import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getThreatMapApiKey,
  getThreatMapProxyTimeoutMs,
  resolveThreatMapJobsUpstreamUrl,
  sendThreatMapUpstreamRequest,
} from "@/lib/threat-map-proxy";

export const runtime = "nodejs";

const THREAT_MAP_REQUEST_LOG_ENABLED = process.env.THREAT_MAP_REQUEST_LOG !== "0";
const THREAT_MAP_REQUEST_LOG_DIR = path.join(process.cwd(), "logs");
const THREAT_MAP_REQUEST_LOG_FILE = path.join(THREAT_MAP_REQUEST_LOG_DIR, "threat-map-last-request.json");

function logThreatMapCreateRequest(requestBody: unknown) {
  if (!THREAT_MAP_REQUEST_LOG_ENABLED) {
    return;
  }

  const now = new Date().toISOString();
  let serializedBody = "<unserializable>";

  try {
    serializedBody = JSON.stringify(requestBody);
  } catch {
    // Keep fallback marker when body cannot be serialized.
  }

  const bodyLength = Buffer.byteLength(serializedBody);
  console.info(`[threat-map] ${now} create-job request (${bodyLength} bytes)`);
  console.info(serializedBody);
}

async function saveThreatMapCreateRequest(requestBody: unknown) {
  const payload = {
    timestamp: new Date().toISOString(),
    request: requestBody,
  };

  await mkdir(THREAT_MAP_REQUEST_LOG_DIR, { recursive: true });
  await writeFile(THREAT_MAP_REQUEST_LOG_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

export async function POST(request: Request) {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return buildErrorResponse(400, "Invalid JSON body.");
  }

  logThreatMapCreateRequest(requestBody);
  try {
    await saveThreatMapCreateRequest(requestBody);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.warn(`[threat-map] failed to save request log file: ${details}`);
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
