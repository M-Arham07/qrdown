import { NextResponse } from "next/server";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (!session) {
      return NextResponse.json({ error: "Room not found or expired" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error("Error retrieving session:", error);
    return NextResponse.json({ error: "Failed to retrieve session" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (session) {
      if (session.code) {
        await sessionStore.del(`code:${session.code}`);
      }
      await sessionStore.del(`room:${roomId}`);
      await sessionStore.del(`signals:${roomId}`);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
