import { NextResponse } from "next/server";

const DEFAULT_UPSTREAM_URL = "http://127.0.0.1:8000/api/v1/chm/crop";

type CanopyExtractBody = {
  geojson?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.CANOPY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing CANOPY_API_KEY on the server. Add it to .env.local and restart Next.js." },
      { status: 500 },
    );
  }

  let body: CanopyExtractBody;
  try {
    body = (await request.json()) as CanopyExtractBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.geojson) {
    return NextResponse.json({ error: "Missing geojson field." }, { status: 400 });
  }

  const upstreamUrl = process.env.CANOPY_API_URL ?? DEFAULT_UPSTREAM_URL;
  const upstreamResponse = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ geojson: body.geojson }),
  });

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Canopy extraction failed.",
        status: upstreamResponse.status,
        details: errorText || null,
      },
      { status: upstreamResponse.status },
    );
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}