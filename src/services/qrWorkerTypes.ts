import type { OpticalFileInfo } from "./qrProtocol";

export type EncoderRequest = { type: "prepare"; file: File } | { type: "frame"; index: number };
export type EncoderResponse =
  | { type: "ready"; info: OpticalFileInfo }
  | { type: "frame"; index: number; size: number; modules: Uint8Array; chunkIndex: number | null }
  | { type: "error"; message: string };
export type ScannerRequest =
  | { type: "scanPixels"; pixels: Uint8ClampedArray; width: number; height: number }
  | { type: "text"; text: string };
export type ScannerResponse =
  | { type: "scanned" }
  | { type: "located"; corners: { x: number; y: number }[] }
  | { type: "progress"; info: OpticalFileInfo; bytes: number; chunks: number; verifying: boolean }
  | { type: "complete"; info: OpticalFileInfo; blob: Blob }
  | { type: "error"; message: string };
