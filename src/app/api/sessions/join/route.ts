import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/redis";
import { ratelimit } from "@/lib/ratelimit";
import { RoomSession } from "@/types/session";
import { SignalEnvelope } from "@/types/signaling";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await ratelimit.limit(`join:${ip}`);
    if (!success) {
      return NextResponse.json({ error: "Too many join attempts. Try again soon." }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const { code, roomId: reqRoomId, secret, device } = body;

    let targetRoomId = reqRoomId;

    if (code) {
      const cleanCode = String(code).trim();
      const resolved = await sessionStore.get<string>(`code:${cleanCode}`);
      if (!resolved) {
        return NextResponse.json({ error: "Invalid or expired 6-digit room code." }, { status: 404 });
      }
      targetRoomId = resolved;
    }

    if (!targetRoomId) {
      return NextResponse.json({ error: "Room ID or 6-digit code required." }, { status: 400 });
    }

    const session = await sessionStore.get<RoomSession>(`room:${targetRoomId}`);
    if (!session) {
      return NextResponse.json({ error: "Room not found or expired." }, { status: 404 });
    }

    // If joining with roomId directly, verify secret matches if provided
    if ((!code && !secret) || (secret && session.secret !== secret)) {
      return NextResponse.json({ error: "Invalid room credentials." }, { status: 403 });
    }

    if (session.status === "closed" || await sessionStore.get(`cancelled:${targetRoomId}`)) {
      return NextResponse.json({ error: "Session cancelled" }, { status: 410 });
    }
    if (session.receiver && session.receiver.id !== device?.id) {
      return NextResponse.json({ error: "Another device has already joined" }, { status: 409 });
    }
    // Possession of the pairing code authorizes this transfer.
    session.receiver = device;
    session.status = "active";
    session.approved = true;
    await sessionStore.set(`room:${targetRoomId}`, session, 600);

    // Notify sender to start negotiating immediately
    const envelope: SignalEnvelope = {
      id: nanoid(),
      roomId: targetRoomId,
      fromRole: "receiver",
      timestamp: Date.now(),
      message: {
        type: "peer:join",
        role: "receiver",
        device,
      },
    };
    await sessionStore.pushSignal(targetRoomId, envelope);

    return NextResponse.json({
      roomId: targetRoomId,
      secret: session.secret,
      session,
      role: "receiver",
    });
  } catch (error) {
    console.error("Failed to join room session:", error);
    return NextResponse.json({ error: "Failed to join room" }, { status: 500 });
  }
}
