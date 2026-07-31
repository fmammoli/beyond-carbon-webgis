export const runtime = "nodejs";
import { JKPP_HCS_CARBON_FILES } from "@/lib/built-in-vector-layers";

type JkppHcsCarbonResponse = {
  files: string[];
};

export async function GET(): Promise<Response> {
  return Response.json({ files: [...JKPP_HCS_CARBON_FILES] } satisfies JkppHcsCarbonResponse, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
