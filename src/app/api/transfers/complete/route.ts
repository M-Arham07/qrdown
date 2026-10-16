import { NextResponse } from "next/server";
import { r2Service } from "@/lib/r2";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomId, secret, objectKey, checksumVerified } = body;

    if (!roomId || !secret) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (!session || session.secret !== secret) {
      return NextResponse.json({ error: "Unauthorized session credentials" }, { status: 403 });
    }

    // Immediate cleanup of cloud storage per PRD requirement
    if (objectKey) {
      const upload = await sessionStore.get<{ objectKey: string }>(`upload:${roomId}`);
      if (!upload || upload.objectKey !== objectKey || !checksumVerified) {
        return NextResponse.json({ error: "Invalid upload completion" }, { status: 400 });
      }
      await r2Service.deleteObject(objectKey);
      await sessionStore.del(`upload:${roomId}`);
    }

    // Cleanup session signals & records
    await sessionStore.del(`signals:${roomId}`);

    return NextResponse.json({
      success: true,
      message: "Transfer marked completed and temporary storage purged.",
      checksumVerified: Boolean(checksumVerified),
    });
  } catch (error) {
    console.error("Transfer completion error:", error);
    return NextResponse.json({ error: "Failed to finalize transfer" }, { status: 500 });
  }
}
