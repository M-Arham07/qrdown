import { encodeRepair, fountainDistribution } from "./qrFountain";

// QR stream v3: fountain repair packets, gzip when useful, QR alphanumeric encoding, SHA-256 verification.
export const QR_STREAM = {
  chunkBytes: 640,
  framesPerSecond: 20,
  headerInterval: 16,
  maxFileBytes: 1_000_000,
} as const;

export interface OpticalFileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  transferSize: number;
  totalChunks: number;
  chunkSize: number;
  compression: "none" | "gzip";
  encoding: "base45" | "base64";
  checksum?: string;
  fountain?: boolean;
}
export interface QRHeaderFrame {
  type: "HEADER";
  info: OpticalFileInfo;
}
export interface QRChunkFrame {
  type: "CHUNK";
  id: string;
  index: number;
  bytes: Uint8Array<ArrayBuffer>;
}
export interface QRRepairFrame {
  type: "REPAIR";
  id: string;
  seed: number;
  bytes: Uint8Array<ArrayBuffer>;
}
export type QRFrame = QRHeaderFrame | QRChunkFrame | QRRepairFrame;
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const values = new Map([...alphabet].map((char, index) => [char, index]));
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function frameChecksum(text: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < text.length; i++) crc = crcTable[(crc ^ text.charCodeAt(i)) & 255] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
function sealFrame(text: string): string { return `${text}:${frameChecksum(text)}`; }

export function encodeBase45(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    let value = bytes[i] * (i + 1 < bytes.length ? 256 : 1) + (bytes[i + 1] ?? 0);
    parts.push(alphabet[value % 45]);
    value = Math.floor(value / 45);
    parts.push(alphabet[value % 45]);
    if (i + 1 < bytes.length) parts.push(alphabet[Math.floor(value / 45)]);
  }
  return parts.join("");
}
export function decodeBase45(text: string): Uint8Array<ArrayBuffer> {
  if (text.length % 3 === 1) throw new Error("Invalid QR payload");
  const bytes = new Uint8Array(Math.floor(text.length * 2 / 3));
  let offset = 0;
  for (let i = 0; i < text.length; i += 3) {
    const a = values.get(text[i]);
    const b = values.get(text[i + 1]);
    const c = i + 2 < text.length ? values.get(text[i + 2]) : 0;
    if (a === undefined || b === undefined || c === undefined) throw new Error("Invalid QR payload");
    const value = a + b * 45 + c * 2025;
    if (i + 2 < text.length) {
      if (value > 65535) throw new Error("Invalid QR payload");
      bytes[offset++] = value >> 8;
      bytes[offset++] = value & 255;
    } else {
      if (value > 255) throw new Error("Invalid QR payload");
      bytes[offset++] = value;
    }
  }
  return bytes;
}
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function createOpticalFrames(file: File): Promise<{ frameAt: (index: number) => string; largestFrame: string; fileInfo: OpticalFileInfo }> {
  if (file.size > QR_STREAM.maxFileBytes) throw new Error("QR transfer supports files up to 1 MB. Use a network transfer for larger files.");
  const original = new Uint8Array(await file.arrayBuffer());
  const checksum = await digest(original);
  let bytes = original;
  let compression: OpticalFileInfo["compression"] = "none";
  if (original.length > 128 && typeof CompressionStream !== "undefined") {
    try {
      const compressed = new Uint8Array(await new Response(
        new Blob([original]).stream().pipeThrough(new CompressionStream("gzip"))
      ).arrayBuffer());
      if (compressed.length < original.length) {
        bytes = compressed;
        compression = "gzip";
      }
    } catch { /* Browsers without gzip support send the original bytes. */ }
  }
  const fileInfo: OpticalFileInfo = {
    id: crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
    name: file.name, type: file.type || "application/octet-stream", size: file.size,
    transferSize: bytes.length, totalChunks: Math.max(1, Math.ceil(bytes.length / QR_STREAM.chunkBytes)),
    chunkSize: QR_STREAM.chunkBytes, compression, encoding: "base45", checksum, fountain: true,
  };
  const metadata = JSON.stringify([fileInfo.name, fileInfo.type, fileInfo.size, bytes.length,
    fileInfo.totalChunks, fileInfo.chunkSize, compression, checksum]);
  const header = sealFrame(`WS3:H:${fileInfo.id}:${encodeBase45(new TextEncoder().encode(metadata))}`);
  const blocks = Array.from({ length: fileInfo.totalChunks }, (_, index) =>
    bytes.subarray(index * fileInfo.chunkSize, (index + 1) * fileInfo.chunkSize));
  const cdf = fountainDistribution(blocks.length);
  const systematic = (index: number) => sealFrame(`WS3:C:${fileInfo.id}:${index.toString(36).toUpperCase()}:${encodeBase45(blocks[index])}`);
  const frameAt = (index: number): string => {
    if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) throw new Error("Invalid frame index");
    if (index % (QR_STREAM.headerInterval + 1) === 0) return header;
    const packet = index - Math.floor(index / (QR_STREAM.headerInterval + 1)) - 1;
    if (blocks.length === 1) return systematic(0);
    if (packet < blocks.length) return systematic(packet);
    const repair = packet - blocks.length;
    // Occasional systematic packets keep very slow cameras making progress too.
    if (repair % 8 === 7) return systematic(Math.floor(repair / 8) % blocks.length);
    return sealFrame(`WS3:R:${fileInfo.id}:${repair.toString(36).toUpperCase()}:${encodeBase45(encodeRepair(blocks, fileInfo.chunkSize, repair, cdf))}`);
  };
  const largestData = blocks.length === 1 ? systematic(0)
    : sealFrame(`WS3:R:${fileInfo.id}:1Z141Z3:${encodeBase45(new Uint8Array(fileInfo.chunkSize))}`);
  return { frameAt, largestFrame: header.length > largestData.length ? header : largestData, fileInfo };

}

export function parseOpticalFrame(raw: string): QRFrame | null {
  if (raw.length > 5000) return null;
  try {
    if (raw.startsWith("WS3:")) {
      const body = raw.slice(0, -9);
      if (raw.at(-9) !== ":" || raw.slice(-8) !== frameChecksum(body)) return null;
      raw = body;
    }
    const header = /^WS[23]:H:([A-F0-9]{12}):(.*)$/.exec(raw);
    if (header) {
      const metadata: unknown = JSON.parse(new TextDecoder().decode(decodeBase45(header[2])));
      if (!Array.isArray(metadata) || metadata.length !== 8) return null;
      const [name, type, size, transferSize, totalChunks, chunkSize, compression, checksum] = metadata;
      if (typeof name !== "string" || !name || name.length > 1024 || typeof type !== "string" || type.length > 255 ||
        !Number.isSafeInteger(size) || size < 0 || size > QR_STREAM.maxFileBytes ||
        !Number.isSafeInteger(transferSize) || transferSize < 0 || transferSize > QR_STREAM.maxFileBytes ||
        chunkSize !== QR_STREAM.chunkBytes || totalChunks !== Math.max(1, Math.ceil(transferSize / chunkSize)) ||
        !["none", "gzip"].includes(compression) || (compression === "none" && size !== transferSize) ||
        typeof checksum !== "string" || !/^[A-F0-9]{64}$/.test(checksum)) return null;
      return { type: "HEADER", info: { id: header[1], name, type, size, transferSize, totalChunks,
        chunkSize, compression, encoding: "base45", checksum, fountain: raw.startsWith("WS3:") } };
    }
    const repair = /^WS3:R:([A-F0-9]{12}):([0-9A-Z]{1,7}):(.*)$/.exec(raw);
    if (repair) {
      const seed = parseInt(repair[2], 36);
      const bytes = decodeBase45(repair[3]);
      if (seed > 0xffffffff || bytes.length !== QR_STREAM.chunkBytes) return null;
      return { type: "REPAIR", id: repair[1], seed, bytes };
    }
    const chunk = /^WS[23]:C:([A-F0-9]{12}):([0-9A-Z]{1,6}):(.*)$/.exec(raw);
    if (chunk) {
      const bytes = decodeBase45(chunk[3]);
      if (bytes.length > QR_STREAM.chunkBytes) return null;
      return { type: "CHUNK", id: chunk[1], index: parseInt(chunk[2], 36), bytes };
    }
    // Receive streams from the previous WebSend release as well.
    const parts = raw.split("|");
    if (parts[0] !== "WS1" || !/^[a-z0-9]{1,32}$/i.test(parts[2] || "")) return null;
    if (parts[1] === "H" && parts.length === 7) {
      const totalChunks = Number(parts[3]);
      const size = Number(parts[4]);
      if (!Number.isSafeInteger(size) || size < 0 || size > QR_STREAM.maxFileBytes ||
        !Number.isSafeInteger(totalChunks) || totalChunks < 1 || totalChunks > Math.ceil(QR_STREAM.maxFileBytes / 250) + 1) return null;
      return { type: "HEADER", info: { id: parts[2], name: decodeURIComponent(parts[6]),
        type: decodeURIComponent(parts[5]), size, transferSize: size, totalChunks,
        chunkSize: 0, compression: "none", encoding: "base64" } };
    }
    if (parts[1] === "C" && parts.length === 5 && /^\d{1,6}$/.test(parts[3])) {
      const binary = atob(parts[4]);
      if (binary.length > 750) return null;
      return { type: "CHUNK", id: parts[2], index: Number(parts[3]),
        bytes: Uint8Array.from(binary, char => char.charCodeAt(0)) };
    }
  } catch { /* Ignore camera noise and unrelated QR codes. */ }
  return null;
}

export async function assembleOpticalFile(info: OpticalFileInfo, chunks: Map<number, Uint8Array<ArrayBuffer>>): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let byteCount = 0;
  for (let index = 0; index < info.totalChunks; index++) {
    const bytes = chunks.get(index);
    if (!bytes) throw new Error("Some frames are still missing");
    byteCount += bytes.length;
    parts.push(bytes);
  }
  if (byteCount !== info.transferSize) throw new Error("The received file is incomplete");
  let blob = new Blob(parts, { type: info.type });
  if (info.compression === "gzip") {
    if (typeof DecompressionStream === "undefined") throw new Error("Update your browser to receive compressed files");
    const reader = blob.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const expanded: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > info.size) throw new Error("The received file has an invalid size");
        expanded.push(new Uint8Array(value));
      }
    } finally { await reader.cancel(); }
    blob = new Blob(expanded, { type: info.type });
  }
  if (blob.size !== info.size) throw new Error("The received file has an invalid size");
  if (info.checksum && await digest(new Uint8Array(await blob.arrayBuffer())) !== info.checksum) {
    throw new Error("File verification failed. Start the QR transfer again.");
  }
  return blob;
}
