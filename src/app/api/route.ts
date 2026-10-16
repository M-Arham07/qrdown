import { NextResponse } from "next/server";
import { API_GUIDE_TEXT, API_GUIDE_JSON } from "@/lib/apiGuide";

export async function GET(req: Request) {
  const accept = req.headers.get("accept") || "";
  if (accept.includes("application/json")) {
    return NextResponse.json(API_GUIDE_JSON);
  }
  return new NextResponse(API_GUIDE_TEXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
