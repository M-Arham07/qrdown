// Transfer state machine & file metadata types

export type TransferState =
  | "IDLE"
  | "PAIRING"
  | "NEGOTIATING"
  | "P2P_CONNECTED"
  | "WAITING_APPROVAL"
  | "TRANSFERRING"
  | "VERIFYING"
  | "COMPLETED"
  | "P2P_FAILED"
  | "CLOUD_OFFERED"
  | "ENCRYPTING"
  | "UPLOADING"
  | "DOWNLOADING"
  | "DECRYPTING"
  | "CANCELLED"
  | "ERROR";

export type ConnectionMode = "LOCAL_P2P" | "INTERNET_P2P" | "TURN_RELAY" | "CLOUD";

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified?: number;
  checksum?: string; // SHA-256 hex string
  totalChunks?: number;
}

export interface TransferProgress {
  fileId: string;
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  currentChunkIndex?: number;
  totalChunks?: number;
}

export interface TransferChunkHeader {
  type: "chunk";
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
}
