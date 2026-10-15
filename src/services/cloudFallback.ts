import { FileMetadata, TransferProgress } from "@/types/transfer";
import { cryptoService } from "./encryption";
import { fileTransferService } from "./fileTransfer";

export interface CloudUploadOptions {
  file: File;
  roomId: string;
  secret: string;
  onProgress: (progress: TransferProgress) => void;
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
  }: CloudUploadOptions): Promise<{
    downloadUrl: string;
    encryptionKeyJwk: JsonWebKey;
    ivHex: string;
    metadata: FileMetadata;
    objectKey: string;
  }> {
    const rawBuffer = await file.arrayBuffer();
    const checksum = await cryptoService.computeChecksum(rawBuffer);

    // Generate AES-256-GCM key & IV
    const key = await cryptoService.generateKey();
    const iv = cryptoService.generateIv();
    const ivHex = cryptoService.ivToHex(iv);

    // Encrypt client-side
    const encryptedBuffer = await cryptoService.encrypt(rawBuffer, key, iv);
    const keyJwk = await cryptoService.exportKey(key);

    // Get presigned upload URL
    const authRes = await fetch("/api/uploads/authorize", {
      method: "POST",
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
      const xhr = new XMLHttpRequest();
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
          resolve();
        } else {
          reject(new Error(`Cloud upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during cloud upload"));
      xhr.send(encryptedBuffer);
    });

    // Obtain presigned download URL for receiver
    const dlRes = await fetch(
      `/api/uploads/download?roomId=${encodeURIComponent(roomId)}&secret=${encodeURIComponent(
        secret
      )}&objectKey=${encodeURIComponent(objectKey)}`
    );
    const { downloadUrl } = await dlRes.json();

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
  }: CloudDownloadOptions): Promise<Blob> {
    const response = await fetch(downloadUrl);
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
    if (metadata.checksum && computedHash !== metadata.checksum) {
      throw new Error("Checksum mismatch: File was corrupted in transit");
    }

    // Trigger immediate deletion of cloud object per PRD
    try {
      await fetch("/api/transfers/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          secret,
          objectKey,
          checksumVerified: true,
        }),
      });
    } catch (e) {
      console.warn("Failed to notify immediate cloud deletion:", e);
    }

    const blob = new Blob([decryptedBuffer], { type: metadata.type });
    fileTransferService.downloadBlob(blob, metadata.name);
    return blob;
  },
};
