import { NextRequest, NextResponse } from "next/server";

function getS3Url(key: string): string {
  // Use path-style URL to avoid regional issues
  return `https://s3.us-east-1.amazonaws.com/dataforgood-fb-data/${key}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json(
        { error: "Missing 'key' parameter" },
        { status: 400 }
      );
    }

    // Validate key is within our dataset path
    const DATASET_PATH = "forests/v2/global/dinov3_global_chm_v2_ml3";
    if (!key.startsWith(DATASET_PATH)) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const s3Url = getS3Url(key);
    const rangeHeader = request.headers.get("range");
    
    console.log(`[GeoFile] Proxying request for: ${key}`);
    console.log(`[GeoFile] Range header: ${rangeHeader}`);

    // Fetch from S3 with Range header support
    const s3Response = await fetch(s3Url, {
      headers: {
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
      redirect: "follow",
    });

    if (!s3Response.ok) {
      console.error(`[GeoFile] S3 error: ${s3Response.status}`);
      return NextResponse.json(
        { error: `S3 error: ${s3Response.status}` },
        { status: s3Response.status }
      );
    }

    const buffer = await s3Response.arrayBuffer();
    console.log(`[GeoFile] Fetched ${buffer.byteLength} bytes, S3 status: ${s3Response.status}`);

    // Build response headers
    const responseHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Content-Type": "image/tiff",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000", // 1 year for immutable GeoTIFF
    };

    // Preserve S3 response headers for Range requests
    if (s3Response.headers.get("content-length")) {
      responseHeaders["Content-Length"] = s3Response.headers.get("content-length")!;
    }
    if (s3Response.headers.get("content-range")) {
      responseHeaders["Content-Range"] = s3Response.headers.get("content-range")!;
    }
    if (s3Response.headers.get("content-type")) {
      responseHeaders["Content-Type"] = s3Response.headers.get("content-type")!;
    }

    // Return appropriate status code (206 for partial, 200 for full)
    const statusCode = s3Response.status === 206 ? 206 : 200;

    return new NextResponse(buffer, {
      status: statusCode,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[GeoFile] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function HEAD(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json(
        { error: "Missing 'key' parameter" },
        { status: 400 }
      );
    }

    const DATASET_PATH = "forests/v2/global/dinov3_global_chm_v2_ml3";
    if (!key.startsWith(DATASET_PATH)) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    const s3Url = getS3Url(key);
    
    const s3Response = await fetch(s3Url, {
      method: "HEAD",
      redirect: "follow",
    });

    if (!s3Response.ok) {
      return new NextResponse(null, { status: s3Response.status });
    }

    const responseHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Content-Type": "image/tiff",
      "Accept-Ranges": "bytes",
    };

    if (s3Response.headers.get("content-length")) {
      responseHeaders["Content-Length"] = s3Response.headers.get("content-length")!;
    }

    return new NextResponse(null, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[GeoFile HEAD] Error:", error);
    return new NextResponse(null, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
    },
  });
}
