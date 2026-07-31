export const runtime = "nodejs";
import { WORKSHOP_REGION_FILES } from "@/lib/built-in-vector-layers";

type WorkshopRegionsResponse = {
  regions: string[];
};

export async function GET(): Promise<Response> {
  return Response.json({ regions: [...WORKSHOP_REGION_FILES] } satisfies WorkshopRegionsResponse, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}