import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";
import { APP_CONFIG } from "@/lib/constants";

export async function POST(req: Request) {
  try {
    const { roomId, secret } = await req.json();
    const session = roomId ? await sessionStore.get<RoomSession>(`room:${roomId}`) : null;
    if (!session || session.secret !== secret) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 403 });
    }
    // A separate tombstone cannot be overwritten by a late negotiation request.
    await sessionStore.set(`cancelled:${roomId}`, true, APP_CONFIG.roomTtlSeconds);
    await sessionStore.del(`code:${session.code}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Session cancellation failed:", error);
    return NextResponse.json({ error: "Could not cancel session" }, { status: 500 });
  }
}
