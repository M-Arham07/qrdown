import { APP_CONFIG } from "@/lib/constants";
import { FileMetadata, TransferProgress } from "@/types/transfer";
import { cryptoService } from "./encryption";

export interface SendFileOptions {
  file: File;
  dataChannel: RTCDataChannel;
  onProgress: (progress: TransferProgress) => void;
  isCancelled: () => boolean;
  maxMessageSize?: number;
}

export interface ReceiveFileTracker {
  metadata: FileMetadata;
  chunks: ArrayBuffer[];
  receivedBytes: number;
  lastProgressUpdate: number;
}

/** Build metadata without reading the file; WebRTC provides transport integrity. */
export async function prepareFileMetadataFast(file: File): Promise<FileMetadata> {
  const totalChunks = Math.ceil(file.size / APP_CONFIG.chunkSizeBytes);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
    checksum: undefined,
    totalChunks,
  };
}

export const fileTransferService = {
  prepareFileMetadataFast,
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
   * Chunk wire format:
   *   [4 bytes: uint32 chunkIndex BE] [N bytes: raw file data]
   */
  async sendFile({
    file,
    dataChannel,
    onProgress,
    isCancelled,
    maxMessageSize = 64 * 1024,
  }: SendFileOptions): Promise<void> {
    // Include the four byte header in the negotiated SCTP message limit.
    const messageLimit = maxMessageSize > 0 ? maxMessageSize : 64 * 1024;
    const chunkSize = Math.min(APP_CONFIG.chunkSizeBytes, messageLimit - 4);
    if (chunkSize <= 0) throw new Error("Negotiated message size is too small");
    const bufferThreshold = APP_CONFIG.bufferThresholdBytes;
    const totalBytes = file.size;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    let offset = 0;
    let chunkIndex = 0;
    const startTime = Date.now();
    let lastReportTime = startTime;
    let lastReportedBytes = 0;
    let readBuffer = new Uint8Array(0);
    let readOffset = 0;

    // Set threshold on channel (may already be set, but re-affirm)
    dataChannel.bufferedAmountLowThreshold = bufferThreshold;

    while (offset < totalBytes) {
      if (isCancelled()) throw new Error("Transfer cancelled by user");
      if (dataChannel.readyState !== "open") throw new Error("Connection closed during transfer");

      // Backpressure: wait if the send buffer is saturated
      if (dataChannel.bufferedAmount > bufferThreshold) {
        await waitForBufferDrain(dataChannel, bufferThreshold);
      }

      // Bail out if cancelled while waiting
      if (isCancelled()) {
        throw new Error("Transfer cancelled by user");
      }

      if (readOffset >= readBuffer.byteLength) {
        readBuffer = new Uint8Array(await file.slice(offset, offset + chunkSize * 16).arrayBuffer());
        readOffset = 0;
      }
      if (isCancelled()) throw new Error("Transfer cancelled by user");
      if (dataChannel.readyState !== "open") throw new Error("Connection closed during transfer");
      const chunkBuffer = readBuffer.subarray(readOffset, readOffset + chunkSize);
      const actualChunkBytes = chunkBuffer.byteLength;
      readOffset += actualChunkBytes;

      // Wire frame: 4-byte chunk index prefix
      const payload = new Uint8Array(4 + actualChunkBytes);
      new DataView(payload.buffer).setUint32(0, chunkIndex, false); // big-endian
      payload.set(chunkBuffer, 4);

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
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", onDrain);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onClose);
    };
    const onDrain = () => {
      if (channel.bufferedAmount > threshold) return;
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connection closed while sending"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Transfer stalled. Reconnect the devices and try again."));
    }, 30000);
    channel.addEventListener("bufferedamountlow", onDrain);
    channel.addEventListener("close", onClose);
    channel.addEventListener("error", onClose);
    if (channel.readyState !== "open") onClose();
    else onDrain();
  });
}
