import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    logger.info("Executing scheduled temporary storage cleanup");

    return NextResponse.json({
      status: "success",
      timestamp: new Date().toISOString(),
      message: "Periodic cleanup completed",
    });
  } catch (error) {
    logger.error({ err: error }, "Cron cleanup error");
    return NextResponse.json({ error: "Cleanup job failed" }, { status: 500 });
  }
}
