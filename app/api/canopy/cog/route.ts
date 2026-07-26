import { NextRequest, NextResponse } from "next/server";

export async function HEAD(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get("url");

  console.log("COG proxy HEAD request for:", url);

  if (!url) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "Accept": "application/octet-stream",
      },
    });

    console.log("S3 HEAD response status:", response.status);

    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
        "Content-Length": response.headers.get("Content-Length") || "0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("COG proxy HEAD error:", message);
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get("url");

  console.log("COG proxy request for:", url);

  if (!url) {
    console.error("Missing url parameter in COG proxy");
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  try {
    // Verify it's an S3 URL we expect
    if (!url.includes("dataforgood-fb-data.s3.us-east-1.amazonaws.com")) {
      console.error("Invalid S3 URL:", url);
      return NextResponse.json(
        { error: "Invalid S3 URL" },
        { status: 403 },
      );
    }

    console.log("Fetching COG from S3:", url);
    const response = await fetch(url, {
      headers: {
        "Accept": "application/octet-stream",
        "Range": request.headers.get("Range") || undefined,
      },
    });

    console.log("S3 COG response status:", response.status, response.statusText);

    if (!response.ok) {
      console.error("S3 COG error response");
      return NextResponse.json(
        { error: `S3 request failed: ${response.statusText}` },
        { status: response.status },
      );
    }

    const buffer = await response.arrayBuffer();
    console.log("Successfully fetched COG, size:", buffer.byteLength);

    return new NextResponse(buffer, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
        "Content-Length": response.headers.get("Content-Length") || buffer.byteLength.toString(),
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("COG proxy error:", message, error);
    return NextResponse.json(
      { error: `Failed to proxy COG: ${message}` },
      { status: 500 },
    );
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
    },
  });
}
