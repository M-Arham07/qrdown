import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";
import { SignalEnvelope, SignalMessage } from "@/types/signaling";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomId, secret, fromRole, message } = body as {
      roomId: string;
      secret: string;
      fromRole: "sender" | "receiver";
      message: SignalMessage;
    };

    if (!roomId || !secret || !fromRole || !message) {
      return NextResponse.json({ error: "Missing required signal parameters" }, { status: 400 });
    }

    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (!session || session.secret !== secret) {
      return NextResponse.json({ error: "Unauthorized session credentials" }, { status: 403 });
    }

    // If message is approval update, update room session state
    if (message.type === "peer:approved") {
      session.approved = message.approved;
      session.status = message.approved ? "active" : "waiting";
      await sessionStore.set(`room:${roomId}`, session, 600);
    }

    const envelope: SignalEnvelope = {
      id: nanoid(),
      roomId,
      fromRole,
      timestamp: Date.now(),
      message,
    };

    await sessionStore.pushSignal(roomId, envelope);

    return NextResponse.json({ success: true, signalId: envelope.id });
  } catch (error) {
    console.error("Signaling error:", error);
    return NextResponse.json({ error: "Failed to process signal" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");
    const secret = searchParams.get("secret");
    const role = searchParams.get("role"); // receiver or sender listening
    const since = Number(searchParams.get("since") || "0");

    if (!roomId || !secret) {
      return NextResponse.json({ error: "Missing roomId or secret" }, { status: 400 });
    }

    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (!session || session.secret !== secret) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 403 });
    }

    const allSignals = (await sessionStore.popSignals(roomId, since)) as SignalEnvelope[];

    // Filter out messages that came from self so clients don't echo their own messages
    const incomingSignals = allSignals.filter((env) => {
      if (role && env.fromRole === role) return false;
      return true;
    });

    return NextResponse.json({
      signals: incomingSignals,
      session,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Signal fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch signals" }, { status: 500 });
  }
}
