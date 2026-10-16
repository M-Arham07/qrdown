import { NextResponse } from "next/server";
import { objectStorageService } from "@/lib/objectStorage";
import { sessionStore } from "@/lib/redis";

interface CliTransferRecord {
  transferId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  createdAt: number;
  expiresAt: number;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const transferId = id.toUpperCase();
    const record = await sessionStore.get<CliTransferRecord>(`cli:${transferId}`);

    if (!record) {
      const accept = req.headers.get("accept") || "";
      if (accept.includes("application/json")) {
        return NextResponse.json(
          { error: "Transfer not found or expired" },
          { status: 404 }
        );
      }
      return new NextResponse("Error: Transfer not found or already purged.\n", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const downloadUrl = await objectStorageService.createDownloadUrl(record.objectKey);
    const accept = req.headers.get("accept") || "";
    const url = new URL(req.url);

    // If client asks for JSON explicitly without wanting direct download
    if (accept.includes("application/json") && !url.searchParams.get("download")) {
      return NextResponse.json({
        success: true,
        transferId: record.transferId,
        fileName: record.fileName,
        fileSize: record.fileSize,
        contentType: record.contentType,
        downloadUrl,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        author: "M-Arham07",
      });
    }

    // Redirect to direct presigned storage download with Content-Disposition
    const response = NextResponse.redirect(downloadUrl, { status: 307 });
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(record.fileName)}"`
    );
    response.headers.set("X-Transfer-Id", record.transferId);
    return response;
  } catch (error) {
    console.error("CLI download error:", error);
    return NextResponse.json(
      { error: "Failed to process download request" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const transferId = id.toUpperCase();
    const record = await sessionStore.get<CliTransferRecord>(`cli:${transferId}`);

    if (!record) {
      return NextResponse.json(
        { error: "Transfer not found or already purged" },
        { status: 404 }
      );
    }

    await objectStorageService.deleteObject(record.objectKey);
    await sessionStore.del(`cli:${transferId}`);

    return NextResponse.json({
      success: true,
      message: `Transfer ${transferId} purged from storage.`,
      purgedBy: "M-Arham07/qrdown",
    });
  } catch (error) {
    console.error("CLI delete error:", error);
    return NextResponse.json(
      { error: "Failed to purge transfer" },
      { status: 500 }
    );
  }
}
