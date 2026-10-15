import { NextResponse } from "next/server";
import { r2Service } from "@/lib/r2";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");
    const secret = searchParams.get("secret");
    const objectKey = searchParams.get("objectKey");

    if (!roomId || !secret || !objectKey) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (!session || session.secret !== secret) {
      return NextResponse.json({ error: "Unauthorized session credentials" }, { status: 403 });
    }

    const downloadUrl = await r2Service.createDownloadUrl(objectKey);

    return NextResponse.json({ downloadUrl });
  } catch (error) {
    console.error("Download URL generation error:", error);
    return NextResponse.json({ error: "Failed to create download URL" }, { status: 500 });
  }
}
