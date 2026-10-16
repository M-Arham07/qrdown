import { NextResponse } from "next/server";

import { mockStorage as localFileStorage } from "@/lib/mockStorage";

export async function PUT(req: Request) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Local storage is only available in development" }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key") || "default";
    const contentType = req.headers.get("content-type") || "application/octet-stream";
    const buffer = await req.arrayBuffer();

    localFileStorage.set(key, { buffer, contentType });
    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error("Local mock upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Local storage is only available in development" }, { status: 404 });
    }
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key") || "default";
    const item = localFileStorage.get(key);

    if (!item) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return new NextResponse(item.buffer, {
      headers: {
        "Content-Type": item.contentType,
        "Content-Length": String(item.buffer.byteLength),
      },
    });
  } catch (err) {
    console.error("Local mock download failed:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
