import { NextResponse } from "next/server";
import { r2Service } from "@/lib/r2";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";
import { APP_CONFIG } from "@/lib/constants";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { roomId, secret, fileName, fileSize, contentType } = body;

    if (!roomId || !secret || !fileName || !fileSize) {
      return NextResponse.json({ error: "Missing file or room metadata" }, { status: 400 });
    }

    if (fileSize > APP_CONFIG.maxCloudSizeBytes) {
      return NextResponse.json(
        { error: `File size exceeds cloud fallback limit of ${APP_CONFIG.maxCloudSizeBytes / 1024 / 1024} MB` },
        { status: 413 }
      );
    }

    const session = await sessionStore.get<RoomSession>(`room:${roomId}`);
    if (!session || session.secret !== secret) {
      return NextResponse.json({ error: "Unauthorized session credentials" }, { status: 403 });
    }

    const objectKey = `transfers/${roomId}/${nanoid()}_enc_${encodeURIComponent(fileName)}`;
    const uploadUrl = await r2Service.createUploadUrl(objectKey, contentType || "application/octet-stream");

    // Store upload metadata
    await sessionStore.set(
      `upload:${roomId}`,
      {
        objectKey,
        fileName,
        fileSize,
        createdAt: Date.now(),
      },
      3600
    );

    return NextResponse.json({
      uploadUrl,
      objectKey,
      expiresIn: APP_CONFIG.presignedUrlTtlSeconds,
    });
  } catch (error) {
    console.error("Upload authorization error:", error);
    return NextResponse.json({ error: "Failed to authorize upload" }, { status: 500 });
  }
}
