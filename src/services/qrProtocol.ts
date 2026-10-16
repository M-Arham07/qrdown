/**
 * WebSend Optical (Air-Gapped QR) Protocol
 * Slices files into sequential QR frames and reassembles them from camera feeds.
 * 100% client-side, zero network communication.
 */

export interface OpticalFileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  totalChunks: number;
  chunkSize: number;
}

export type QRFrameType = "HEADER" | "CHUNK";

export interface QRHeaderFrame {
  type: "HEADER";
  id: string;
  totalChunks: number;
  size: number;
  mimeType: string;
  name: string;
}

export interface QRChunkFrame {
  type: "CHUNK";
  id: string;
  index: number;
  data: string; // Base64 data
}

export type QRFrame = QRHeaderFrame | QRChunkFrame;

export const CHUNK_DENSITIES = {
  compact: { label: "Compact (Fast scan)", bytes: 250 },
  balanced: { label: "Balanced (Recommended)", bytes: 450 },
  dense: { label: "Dense (Faster transfer)", bytes: 750 },
} as const;

export type ChunkDensity = keyof typeof CHUNK_DENSITIES;

/**
 * Encodes an ArrayBuffer into an array of QR code text frames
 */
export async function createOpticalFrames(
  file: File,
  density: ChunkDensity = "balanced"
): Promise<{ frames: string[]; fileInfo: OpticalFileInfo }> {
  const chunkSize = CHUNK_DENSITIES[density].bytes;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const totalChunks = Math.ceil(bytes.length / chunkSize) || 1;
  const id = Math.random().toString(36).substring(2, 8);

  const fileInfo: OpticalFileInfo = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    totalChunks,
    chunkSize,
  };

  const frames: string[] = [];

  // Header Frame: WS1|H|<id>|<totalChunks>|<size>|<mimeType>|<encodedFileName>
  const encodedName = encodeURIComponent(file.name);
  const encodedMime = encodeURIComponent(fileInfo.type);
  const headerFrame = `WS1|H|${id}|${totalChunks}|${file.size}|${encodedMime}|${encodedName}`;
  frames.push(headerFrame);

  // Chunk Frames: WS1|C|<id>|<index>|<base64Data>
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, bytes.length);
    const chunkBytes = bytes.subarray(start, end);

    // Convert chunk bytes to binary string then base64
    let binary = "";
    const len = chunkBytes.byteLength;
    for (let j = 0; j < len; j++) {
      binary += String.fromCharCode(chunkBytes[j]);
    }
    const base64 = btoa(binary);

    frames.push(`WS1|C|${id}|${i}|${base64}`);
  }

  return { frames, fileInfo };
}

/**
 * Parses a raw string scanned by a QR scanner into a typed QRFrame
 */
export function parseOpticalFrame(raw: string): QRFrame | null {
  if (!raw.startsWith("WS1|")) return null;

  const parts = raw.split("|");
  if (parts.length < 4) return null;

  const kind = parts[1];
  const id = parts[2];

  if (kind === "H" && parts.length >= 7) {
    const totalChunks = parseInt(parts[3], 10);
    const size = parseInt(parts[4], 10);
    const mimeType = decodeURIComponent(parts[5]);
    const name = decodeURIComponent(parts[6]);

    if (isNaN(totalChunks) || isNaN(size)) return null;

    return {
      type: "HEADER",
      id,
      totalChunks,
      size,
      mimeType,
      name,
    };
  }

  if (kind === "C" && parts.length >= 5) {
    const index = parseInt(parts[3], 10);
    const data = parts.slice(4).join("|"); // in case base64 contained pipes (rare)

    if (isNaN(index)) return null;

    return {
      type: "CHUNK",
      id,
      index,
      data,
    };
  }

  return null;
}

/**
 * Reassembles collected Base64 chunks into a downloadable File / Blob
 */
export function assembleOpticalFile(
  fileInfo: OpticalFileInfo,
  chunks: Map<number, string>
): Blob {
  const byteArrays: Uint8Array[] = [];

  for (let i = 0; i < fileInfo.totalChunks; i++) {
    const base64 = chunks.get(i);
    if (!base64) {
      throw new Error(`Missing chunk #${i}`);
    }

    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let j = 0; j < len; j++) {
      bytes[j] = binaryString.charCodeAt(j);
    }
    byteArrays.push(bytes);
  }

  return new Blob(byteArrays as unknown as BlobPart[], { type: fileInfo.type });
}
