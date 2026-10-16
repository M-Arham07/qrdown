import { NextResponse } from "next/server";
import { objectStorageService } from "@/lib/objectStorage";
import { sessionStore } from "@/lib/redis";
import { RoomSession } from "@/types/session";
import { APP_CONFIG } from "@/lib/constants";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  try {
    if (process.env.NODE_ENV === "production" && !objectStorageService.isConfigured()) {
      return NextResponse.json({ error: "Cloud storage is not configured" }, { status: 503 });
    }
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

    if (await sessionStore.get(`cancelled:${roomId}`)) {
      return NextResponse.json({ error: "Session cancelled" }, { status: 410 });
    }

    const objectKey = `transfers/${roomId}/${nanoid()}_enc_${encodeURIComponent(fileName)}`;
    const uploadUrl = await objectStorageService.createUploadUrl(objectKey, contentType || "application/octet-stream");

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
