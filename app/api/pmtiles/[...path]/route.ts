import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_R2_PUBLIC_ORIGIN =
  "https://pub-b35b693f4e7a4112af656d6983f8adc2.r2.dev";

const REQUEST_HEADERS_TO_FORWARD = [
  "range",
  "if-none-match",
  "if-modified-since",
  "accept",
  "accept-encoding",
] as const;

const RESPONSE_HEADERS_TO_FORWARD = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "vary",
] as const;

function sanitizePathSegments(pathSegments: string[]): string[] | null {
  const normalized = pathSegments
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  return normalized;
}

function resolveUpstreamOrigin(): URL {
  const configured = process.env.R2_PUBLIC_ORIGIN?.trim();
  const target = configured && configured.length > 0 ? configured : DEFAULT_R2_PUBLIC_ORIGIN;
  return new URL(target.endsWith("/") ? target.slice(0, -1) : target);
}

function buildUpstreamUrl(pathSegments: string[], requestUrl: URL): URL {
  const origin = resolveUpstreamOrigin();
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  origin.pathname = `${origin.pathname.replace(/\/$/, "")}/${encodedPath}`;
  origin.search = requestUrl.search;
  return origin;
}

async function proxyPmtilesRequest(
  request: Request,
  params: Promise<{ path: string[] }>,
): Promise<Response> {
  const { path: rawPathSegments } = await params;
  const safePathSegments = sanitizePathSegments(rawPathSegments ?? []);

  if (!safePathSegments) {
    return NextResponse.json(
      {
        error: "Invalid PMTiles path.",
      },
      { status: 400 },
    );
  }

  const upstreamUrl = buildUpstreamUrl(safePathSegments, new URL(request.url));
  const upstreamHeaders = new Headers();

  for (const headerName of REQUEST_HEADERS_TO_FORWARD) {
    const value = request.headers.get(headerName);
    if (value) {
      upstreamHeaders.set(headerName, value);
    }
  }

  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      cache: "no-store",
      redirect: "follow",
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Failed to reach upstream PMTiles host.";
    return NextResponse.json(
      {
        error: "PMTiles upstream request failed.",
        details,
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();

  for (const headerName of RESPONSE_HEADERS_TO_FORWARD) {
    const value = upstreamResponse.headers.get(headerName);
    if (value) {
      responseHeaders.set(headerName, value);
    }
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyPmtilesRequest(request, context.params);
}

export async function HEAD(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyPmtilesRequest(request, context.params);
}
