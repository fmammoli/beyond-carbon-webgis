export const runtime = "nodejs";
import { CONCESSION_FILES } from "@/lib/built-in-vector-layers";

type ConcessionsResponse = {
  concessions: string[];
};

export async function GET(): Promise<Response> {
  return Response.json({ concessions: [...CONCESSION_FILES] } satisfies ConcessionsResponse, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}