import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { sessionStore } from "@/lib/redis";
import { ratelimit } from "@/lib/ratelimit";
import { RoomSession } from "@/types/session";
import { APP_CONFIG } from "@/lib/constants";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return NextResponse.json({ error: "Rate limit exceeded. Please wait a moment." }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const senderDevice = body.device;

    const roomId = nanoid(12);
    const secret = nanoid(24);
    // 6-digit numeric room code for easy mobile typing
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const now = Date.now();
    const expiresAt = now + APP_CONFIG.roomTtlSeconds * 1000;

    const session: RoomSession = {
      roomId,
      secret,
      code,
      createdAt: now,
      expiresAt,
      sender: senderDevice,
      status: "waiting",
      approved: false,
    };

    // Store room session and code-to-roomId index
    await sessionStore.set(`room:${roomId}`, session, APP_CONFIG.roomTtlSeconds);
    await sessionStore.set(`code:${code}`, roomId, APP_CONFIG.roomTtlSeconds);

    return NextResponse.json({
      roomId,
      secret,
      code,
      expiresAt,
    });
  } catch (error) {
    console.error("Failed to create room session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
