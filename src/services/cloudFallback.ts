import { FileMetadata, TransferProgress } from "@/types/transfer";
import { canPreviewText } from "./textTransfer";
import { cryptoService } from "./encryption";
import { fileTransferService } from "./fileTransfer";

export interface CloudUploadOptions {
  file: File;
  roomId: string;
  secret: string;
  onProgress: (progress: TransferProgress) => void;
  signal?: AbortSignal;
}

export interface CloudDownloadOptions {
  metadata: FileMetadata;
  downloadUrl: string;
  encryptionKeyJwk: JsonWebKey;
  ivHex: string;
  roomId: string;
  secret: string;
  objectKey: string;
  onProgress: (progress: TransferProgress) => void;
  signal?: AbortSignal;
}

export const cloudFallbackService = {
  /**
   * Encrypts file in browser and uploads to Cloudflare R2 via presigned URL
   */
  async uploadEncryptedFile({
    file,
    roomId,
    secret,
    onProgress,
    signal,
  }: CloudUploadOptions): Promise<{
    downloadUrl: string;
    encryptionKeyJwk: JsonWebKey;
    ivHex: string;
    metadata: FileMetadata;
    objectKey: string;
  }> {
    signal?.throwIfAborted();
    const rawBuffer = await file.arrayBuffer();
    signal?.throwIfAborted();
    const checksum = await cryptoService.computeChecksum(rawBuffer);

    // Generate AES-256-GCM key & IV
    const key = await cryptoService.generateKey();
    const iv = cryptoService.generateIv();
    const ivHex = cryptoService.ivToHex(iv);

    // Encrypt client-side
    const encryptedBuffer = await cryptoService.encrypt(rawBuffer, key, iv);
    const keyJwk = await cryptoService.exportKey(key);
    signal?.throwIfAborted();

    // Get presigned upload URL
    const authRes = await fetch("/api/uploads/authorize", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId,
        secret,
        fileName: file.name,
        fileSize: encryptedBuffer.byteLength,
        contentType: "application/octet-stream",
      }),
    });

    if (!authRes.ok) {
      const err = await authRes.json();
      throw new Error(err.error || "Failed to authorize cloud upload");
    }

    const { uploadUrl, objectKey } = await authRes.json();

    // Upload encrypted payload directly to storage
    await new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted();
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const finish = (error?: Error) => {
        signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      signal?.addEventListener("abort", abort, { once: true });
      xhr.onabort = () => finish(new DOMException("Transfer cancelled", "AbortError"));
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentage = Math.round((e.loaded / e.total) * 100);
          onProgress({
            fileId: file.name,
            fileName: file.name,
            bytesTransferred: e.loaded,
            totalBytes: e.total,
            percentage,
            speedBytesPerSec: 0,
            etaSeconds: 0,
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          finish();
        } else {
          finish(new Error(`Cloud upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => finish(new Error("Network error during cloud upload"));
      xhr.send(encryptedBuffer);
    });

    // Obtain presigned download URL for receiver
    const dlRes = await fetch(
      `/api/uploads/download?roomId=${encodeURIComponent(roomId)}&secret=${encodeURIComponent(
        secret
      )}&objectKey=${encodeURIComponent(objectKey)}`,
      { signal }
    );
    if (!dlRes.ok) throw new Error("Could not create download link");
    const { downloadUrl } = await dlRes.json();
    signal?.throwIfAborted();

    const metadata: FileMetadata = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      checksum,
    };

    return {
      downloadUrl,
      encryptionKeyJwk: keyJwk,
      ivHex,
      metadata,
      objectKey,
    };
  },

  /**
   * Downloads encrypted data from Cloudflare R2, decrypts client-side, and verifies checksum
   */
  async downloadAndDecryptFile({
    metadata,
    downloadUrl,
    encryptionKeyJwk,
    ivHex,
    roomId,
    secret,
    objectKey,
    onProgress,
    signal,
  }: CloudDownloadOptions): Promise<Blob> {
    signal?.throwIfAborted();
    const response = await fetch(downloadUrl, { signal });
    if (!response.ok) {
      throw new Error("Failed to download encrypted file from cloud");
    }

    const encryptedBuffer = await response.arrayBuffer();

    onProgress({
      fileId: metadata.name,
      fileName: metadata.name,
      bytesTransferred: encryptedBuffer.byteLength,
      totalBytes: encryptedBuffer.byteLength,
      percentage: 100,
      speedBytesPerSec: 0,
      etaSeconds: 0,
    });

    // Decrypt locally
    const key = await cryptoService.importKey(encryptionKeyJwk);
    const iv = cryptoService.hexToIv(ivHex);
    const decryptedBuffer = await cryptoService.decrypt(encryptedBuffer, key, iv);

    // Verify SHA-256 integrity
    const computedHash = await cryptoService.computeChecksum(decryptedBuffer);
    signal?.throwIfAborted();
    if (metadata.checksum && computedHash !== metadata.checksum) {
      throw new Error("Checksum mismatch: File was corrupted in transit");
    }

    // Trigger immediate deletion of cloud object per PRD
    try {
      const completion = await fetch("/api/transfers/complete", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          secret,
          objectKey,
          checksumVerified: true,
        }),
      });
      if (!completion.ok) throw new Error(`Cleanup failed (${completion.status})`);
    } catch (e) {
      console.warn("Failed to notify immediate cloud deletion:", e);
    }

    signal?.throwIfAborted();
    const blob = new Blob([decryptedBuffer], { type: metadata.type });
    if (!canPreviewText(blob, metadata.name)) fileTransferService.downloadBlob(blob, metadata.name);
    return blob;
  },
};
