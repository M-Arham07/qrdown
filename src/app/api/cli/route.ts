import { NextResponse } from "next/server";
import { objectStorageService } from "@/lib/objectStorage";
import { sessionStore } from "@/lib/redis";
import { APP_CONFIG } from "@/lib/constants";
import { API_GUIDE_TEXT, API_GUIDE_JSON } from "@/lib/apiGuide";
import { customAlphabet } from "nanoid";

// 6-character unambiguous alphanumeric code (no 0/O, 1/I)
const generateTransferId = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);

export async function GET(req: Request) {
  const accept = req.headers.get("accept") || "";
  if (accept.includes("application/json")) {
    return NextResponse.json(API_GUIDE_JSON);
  }
  return new NextResponse(API_GUIDE_TEXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function POST(req: Request) {
  try {
    const contentTypeHeader = req.headers.get("content-type") || "";
    let fileBuffer: Buffer | null = null;
    let fileName = "file.bin";
    let mimeType = "application/octet-stream";

    if (contentTypeHeader.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileEntry = formData.get("file") || formData.get("upload");

      if (!fileEntry || !(fileEntry instanceof Blob)) {
        return NextResponse.json(
          { error: "No file provided in form field 'file'" },
          { status: 400 }
        );
      }

      fileName = (fileEntry as File).name || "upload.bin";
      mimeType = fileEntry.type || "application/octet-stream";
      const arrayBuffer = await fileEntry.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
    } else {
      // Direct binary stream or text payload
      const arrayBuffer = await req.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        return NextResponse.json(
          { error: "Empty request body" },
          { status: 400 }
        );
      }
      fileBuffer = Buffer.from(arrayBuffer);
      fileName = req.headers.get("x-filename") || "piped-data.txt";
      mimeType = req.headers.get("content-type") || "text/plain";
    }

    if (fileBuffer.length > APP_CONFIG.maxCloudSizeBytes) {
      return NextResponse.json(
        { error: `File exceeds limit of ${APP_CONFIG.maxCloudSizeBytes / 1024 / 1024} MB` },
        { status: 413 }
      );
    }

    const transferId = generateTransferId();
    const safeName = encodeURIComponent(fileName.replace(/[^a-zA-Z0-9._-]/g, "_"));
    const objectKey = `cli-transfers/${transferId}/${safeName}`;

    await objectStorageService.putObject(objectKey, fileBuffer, mimeType);

    const expiresAt = Date.now() + 3600 * 1000;
    const transferRecord = {
      transferId,
      objectKey,
      fileName,
      fileSize: fileBuffer.length,
      contentType: mimeType,
      createdAt: Date.now(),
      expiresAt,
    };

    await sessionStore.set(`cli:${transferId}`, transferRecord, 3600);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://qrdown.vercel.app";
    const downloadUrl = `${baseUrl}/api/cli/${transferId}`;
    const command = `curl -sLOJ ${downloadUrl}`;

    const accept = req.headers.get("accept") || "";
    if (accept.includes("application/json")) {
      return NextResponse.json({
        success: true,
        transferId,
        fileName,
        fileSize: fileBuffer.length,
        downloadUrl,
        command,
        expiresInSeconds: 3600,
        author: "M-Arham07",
      });
    }

    // Format human-friendly terminal plain text
    const kb = (fileBuffer.length / 1024).toFixed(1);
    const sizeStr = fileBuffer.length > 1024 * 1024
      ? `${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB`
      : `${kb} KB`;

    const textOutput = `--------------------------------------------------------------------------------
Transfer ID:   ${transferId}
File Name:     ${fileName}
File Size:     ${sizeStr}
Download URL:  ${downloadUrl}
Download Cmd:  ${command}
Expires In:    1 hour (3600s)
Engineered by: M-Arham07 (https://github.com/M-Arham07)
--------------------------------------------------------------------------------
`;

    return new NextResponse(textOutput, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      status: 201,
    });
  } catch (error) {
    console.error("CLI upload error:", error);
    return NextResponse.json(
      { error: "Internal server error during upload" },
      { status: 500 }
    );
  }
}
