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
let canvas: OffscreenCanvas | null = null;
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
      let pixels: ImageData;
      if (data.type === "scan") {
        const bitmap = data.bitmap;
        try {
          if (!canvas) canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
          if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Camera image processing is unavailable");
          context.drawImage(bitmap, 0, 0);
          pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        } finally { bitmap.close(); }
      } else pixels = new ImageData(data.pixels as Uint8ClampedArray<ArrayBuffer>, data.width, data.height);
      const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "dontInvert" });
      if (code?.data) await consume(code.data);
    }
  } catch (error) {
    finished = true;
    chunks.clear();
    send({ type: "error", message: error instanceof Error ? error.message : "Could not read QR stream" });
  } finally { send({ type: "scanned" }); }
};
