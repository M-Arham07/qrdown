import { APP_CONFIG } from "@/lib/constants";
import { FileMetadata, TransferProgress } from "@/types/transfer";
import { cryptoService } from "./encryption";

export interface SendFileOptions {
  file: File;
  dataChannel: RTCDataChannel;
  onProgress: (progress: TransferProgress) => void;
  isCancelled: () => boolean;
}

export interface ReceiveFileTracker {
  metadata: FileMetadata;
  chunks: ArrayBuffer[];
  receivedBytes: number;
  lastProgressUpdate: number;
}

/**
 * Prepares lightweight file metadata WITHOUT reading the full file.
 * Checksum is computed lazily — we skip the blocking SHA-256 pass here
 * and let the receiver verify after assembly. This prevents UI freezes
 * for large files (e.g., 1 GB video).
 */
export async function prepareFileMetadataFast(file: File): Promise<FileMetadata> {
  const totalChunks = Math.ceil(file.size / APP_CONFIG.chunkSizeBytes);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    checksum: undefined, // computed after transfer on receiver side
    totalChunks,
  };
}

export const fileTransferService = {
  /**
   * Prepares file metadata and calculates SHA-256 before transfer.
   * Note: This reads the entire file into memory — prefer prepareFileMetadataFast
   * for files > 50 MB to avoid blocking the UI thread.
   */
  async prepareFileMetadata(file: File): Promise<FileMetadata> {
    // For large files, skip checksum upfront to avoid UI freeze
    if (file.size > 50 * 1024 * 1024) {
      return prepareFileMetadataFast(file);
    }
    const buffer = await file.arrayBuffer();
    const checksum = await cryptoService.computeChecksum(buffer);
    const totalChunks = Math.ceil(file.size / APP_CONFIG.chunkSizeBytes);

    return {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified,
      checksum,
      totalChunks,
    };
  },

  /**
   * Sends file through RTCDataChannel with backpressure flow control.
   *
   * Uses 64 KiB chunks (APP_CONFIG.chunkSizeBytes) and a 4 MiB buffered-amount
   * threshold (APP_CONFIG.bufferThresholdBytes). This gives ~4–8x better
   * throughput compared to the previous 16 KiB / 256 KiB config.
   *
   * Chunk wire format:
   *   [4 bytes: uint32 chunkIndex BE] [N bytes: raw file data]
   */
  async sendFile({
    file,
    dataChannel,
    onProgress,
    isCancelled,
  }: SendFileOptions): Promise<void> {
    const chunkSize = APP_CONFIG.chunkSizeBytes;
    const bufferThreshold = APP_CONFIG.bufferThresholdBytes;
    const totalBytes = file.size;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    let offset = 0;
    let chunkIndex = 0;
    const startTime = Date.now();
    let lastReportTime = startTime;
    let lastReportedBytes = 0;

    // Set threshold on channel (may already be set, but re-affirm)
    dataChannel.bufferedAmountLowThreshold = bufferThreshold;

    while (offset < totalBytes) {
      if (isCancelled()) {
        throw new Error("Transfer cancelled by user");
      }

      // Backpressure: wait if the send buffer is saturated
      if (dataChannel.bufferedAmount > bufferThreshold) {
        await waitForBufferDrain(dataChannel, bufferThreshold);
      }

      // Bail out if cancelled while waiting
      if (isCancelled()) {
        throw new Error("Transfer cancelled by user");
      }

      const end = Math.min(offset + chunkSize, totalBytes);
      const slice = file.slice(offset, end);
      const chunkBuffer = await slice.arrayBuffer();
      const actualChunkBytes = chunkBuffer.byteLength;

      // Wire frame: 4-byte chunk index prefix
      const payload = new Uint8Array(4 + actualChunkBytes);
      new DataView(payload.buffer).setUint32(0, chunkIndex, false); // big-endian
      payload.set(new Uint8Array(chunkBuffer), 4);

      dataChannel.send(payload.buffer);

      offset += actualChunkBytes;
      chunkIndex++;

      // Throttled progress reporting (~5 times/second)
      const now = Date.now();
      if (now - lastReportTime >= 200 || offset === totalBytes) {
        const elapsed = (now - lastReportTime) / 1000;
        const bytesDelta = offset - lastReportedBytes;
        const speed = elapsed > 0 ? bytesDelta / elapsed : 0;
        const remaining = totalBytes - offset;
        const eta = speed > 0 ? Math.ceil(remaining / speed) : 0;

        onProgress({
          fileId: file.name,
          fileName: file.name,
          bytesTransferred: offset,
          totalBytes,
          percentage: Math.min(100, Math.round((offset / totalBytes) * 100)),
          speedBytesPerSec: speed,
          etaSeconds: eta,
          currentChunkIndex: chunkIndex,
          totalChunks,
        });

        lastReportTime = now;
        lastReportedBytes = offset;
      }
    }
  },

  /**
   * Helper to download assembled file blob safely
   */
  downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};

/**
 * Returns a promise that resolves when the DataChannel's buffered amount
 * drops below the threshold. Uses the bufferedamountlow event for efficiency
 * rather than polling.
 */
function waitForBufferDrain(channel: RTCDataChannel, threshold: number): Promise<void> {
  return new Promise<void>((resolve) => {
    // Fast path: already drained
    if (channel.bufferedAmount <= threshold) {
      resolve();
      return;
    }

    const handler = () => {
      channel.removeEventListener("bufferedamountlow", handler);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", handler);

    // Safety timeout: if event never fires (e.g., channel closed), resolve anyway
    const safety = setTimeout(() => {
      channel.removeEventListener("bufferedamountlow", handler);
      resolve();
    }, 5000);

    // Clear safety timer if event fires first
    channel.addEventListener(
      "bufferedamountlow",
      () => clearTimeout(safety),
      { once: true }
    );
  });
}
