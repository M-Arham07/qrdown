import { NextResponse } from "next/server";

// In-memory buffer for simulated local cloud storage
const localFileStorage = new Map<string, { buffer: ArrayBuffer; contentType: string }>();

export async function PUT(req: Request) {
  try {
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
