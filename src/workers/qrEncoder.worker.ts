import QRCode from "qrcode";
import { createOpticalFrames } from "../services/qrProtocol";
import type { EncoderRequest, EncoderResponse } from "../services/qrWorkerTypes";

let frameAt: ((index: number) => string) | null = null;
let version: number | undefined;
const cache = new Map<number, { size: number; modules: Uint8Array; chunkIndex: number | null }>();
function encode(index: number) {
  let matrix = cache.get(index);
  if (matrix) return matrix;
  const text = frameAt!(index);
  const qr = QRCode.create([{ data: text, mode: "alphanumeric" }], { errorCorrectionLevel: "M", version });
  const match = /^WS3:C:[A-F0-9]{12}:([0-9A-Z]+):/.exec(text);
  matrix = { size: qr.modules.size, modules: new Uint8Array(qr.modules.data), chunkIndex: match ? parseInt(match[1], 36) : null };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(index, matrix);
  return matrix;
}
function send(message: EncoderResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}
self.onmessage = async ({ data }: MessageEvent<EncoderRequest>) => {
  try {
    if (data.type === "prepare") {
      const prepared = await createOpticalFrames(data.file);
      frameAt = prepared.frameAt;
      // Keep source and repair packets on the same grid for camera tracking.
      version = QRCode.create([{ data: prepared.largestFrame, mode: "alphanumeric" }], { errorCorrectionLevel: "M" }).version;
      cache.clear();
      send({ type: "ready", info: prepared.fileInfo });
    } else if (frameAt && Number.isInteger(data.index) && data.index >= 0 && data.index <= 0xffffffff - 2) {
      const matrix = encode(data.index);
      const modules = matrix.modules.slice();
      send({ type: "frame", index: data.index, ...matrix, modules }, [modules.buffer]);
      // Prepare upcoming frames while the current frame is displayed.
      for (let offset = 1; offset <= 2; offset++) encode(data.index + offset);
    }
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "Could not prepare QR stream" });
  }
};
