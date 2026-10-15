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

export const fileTransferService = {
  /**
   * Prepares file metadata and calculates SHA-256 before transfer
   */
  async prepareFileMetadata(file: File): Promise<FileMetadata> {
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
   * Sends file through RTCDataChannel with backpressure flow control
   */
  async sendFile({
    file,
    dataChannel,
    onProgress,
    isCancelled,
  }: SendFileOptions): Promise<void> {
    const chunkSize = APP_CONFIG.chunkSizeBytes;
    const totalBytes = file.size;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    let offset = 0;
    let chunkIndex = 0;
    const startTime = Date.now();
    let lastTime = startTime;
    let lastBytes = 0;

    dataChannel.bufferedAmountLowThreshold = APP_CONFIG.bufferThresholdBytes;

    while (offset < totalBytes) {
      if (isCancelled()) {
        throw new Error("Transfer cancelled by user");
      }

      // Backpressure check: if buffer is full, wait for bufferedamountlow event
      if (dataChannel.bufferedAmount > APP_CONFIG.bufferThresholdBytes) {
        await new Promise<void>((resolve) => {
          const handler = () => {
            dataChannel.removeEventListener("bufferedamountlow", handler);
            resolve();
          };
          dataChannel.addEventListener("bufferedamountlow", handler);
        });
      }

      const slice = file.slice(offset, offset + chunkSize);
      const chunkBuffer = await slice.arrayBuffer();

      // Send chunk: we prefix the chunk with a 4-byte chunk index for safety
      const payload = new Uint8Array(4 + chunkBuffer.byteLength);
      new DataView(payload.buffer).setUint32(0, chunkIndex, false);
      payload.set(new Uint8Array(chunkBuffer), 4);

      dataChannel.send(payload.buffer);

      offset += chunkBuffer.byteLength;
      chunkIndex++;

      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.2 || offset === totalBytes) {
        const bytesDiff = offset - lastBytes;
        const currentSpeed = elapsed > 0 ? bytesDiff / elapsed : 0;
        const remainingBytes = totalBytes - offset;
        const eta = currentSpeed > 0 ? Math.ceil(remainingBytes / currentSpeed) : 0;

        onProgress({
          fileId: file.name,
          fileName: file.name,
          bytesTransferred: offset,
          totalBytes,
          percentage: Math.min(100, Math.round((offset / totalBytes) * 100)),
          speedBytesPerSec: currentSpeed,
          etaSeconds: eta,
          currentChunkIndex: chunkIndex,
          totalChunks,
        });

        lastTime = now;
        lastBytes = offset;
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
