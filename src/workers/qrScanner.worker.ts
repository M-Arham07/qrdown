import jsQR from "jsqr";
import { assembleOpticalFile, parseOpticalFrame } from "../services/qrProtocol";
import type { OpticalFileInfo, QRChunkFrame } from "../services/qrProtocol";
import type { ScannerRequest, ScannerResponse } from "../services/qrWorkerTypes";

let info: OpticalFileInfo | null = null;
let chunks = new Map<number, Uint8Array<ArrayBuffer>>();
let bytes = 0;
let finishing = false;
let finished = false;
let lastReport = 0;
// Retain early frames until a repeated header arrives. Never mix transfer IDs.
const early: QRChunkFrame[] = [];
function send(message: ScannerResponse) { self.postMessage(message); }
function addChunk(frame: QRChunkFrame) {
  if (!info || frame.id !== info.id || frame.index < 0 || frame.index >= info.totalChunks || chunks.has(frame.index)) return;
  if (info.chunkSize) {
    const expected = Math.min(info.chunkSize, info.transferSize - frame.index * info.chunkSize);
    if (frame.bytes.length !== expected) return;
  }
  if (bytes + frame.bytes.length > info.transferSize) return;
  chunks.set(frame.index, frame.bytes);
  bytes += frame.bytes.length;
}
async function consume(text: string) {
  if (finished || finishing) return;
  const frame = parseOpticalFrame(text);
  if (!frame) return;
  if (frame.type === "HEADER") {
    // Lock this scan to its first transfer until the user starts another scan.
    if (info && info.id !== frame.info.id) return;
    if (!info) {
      info = frame.info;
      if (info.compression === "gzip" && typeof DecompressionStream === "undefined") throw new Error("Update your browser to receive compressed files");
      for (const chunk of early) addChunk(chunk);
      early.length = 0;
      send({ type: "progress", info, bytes, chunks: chunks.size, verifying: false });
    }
  } else if (!info) {
    if (early.length >= 64) early.shift();
    early.push(frame);
  } else addChunk(frame);
  if (!info) return;
  const now = performance.now();
  if (chunks.size === info.totalChunks) {
    finishing = true;
    send({ type: "progress", info, bytes, chunks: chunks.size, verifying: true });
    const blob = await assembleOpticalFile(info, chunks);
    finished = true;
    chunks = new Map();
    send({ type: "complete", info, blob });
  } else if (now - lastReport >= 150) {
    lastReport = now;
    send({ type: "progress", info, bytes, chunks: chunks.size, verifying: false });
  }
}
self.onmessage = async ({ data }: MessageEvent<ScannerRequest>) => {
  try {
    if (data.type === "text") await consume(data.text);
    else {
      // Avoid ImageData/OffscreenCanvas constructors: worker support varies on iOS.
      // Pixels are transferred from a regular canvas without copying their buffer.
      let code: ReturnType<typeof jsQR> = null;
      try {
        code = jsQR(data.pixels, data.width, data.height, { inversionAttempts: "dontInvert" });
      } catch { /* An unreadable camera frame must not discard the transfer. */ }
      if (code?.data && (code.data.startsWith("WS2:") || code.data.startsWith("WS1|"))) {
        const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = code.location;
        send({ type: "located", corners: [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner] });
        await consume(code.data);
      }
    }
  } catch (error) {
    finished = true;
    chunks.clear();
    send({ type: "error", message: error instanceof Error ? error.message : "Could not read QR stream" });
  } finally { send({ type: "scanned" }); }
};
