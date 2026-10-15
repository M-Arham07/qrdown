// Signaling protocol messages
import { DeviceInfo, PeerRole } from "./session";
import { FileMetadata } from "./transfer";

export type SignalMessage =
  | { type: "peer:join"; role: PeerRole; device: DeviceInfo }
  | { type: "peer:request_approval"; device: DeviceInfo }
  | { type: "peer:approved"; approved: boolean }
  | { type: "signal:offer"; sdp: RTCSessionDescriptionInit }
  | { type: "signal:answer"; sdp: RTCSessionDescriptionInit }
  | { type: "signal:ice"; candidate: RTCIceCandidateInit }
  | { type: "transfer:request"; files: FileMetadata[] }
  | { type: "transfer:accepted"; accepted: boolean }
  | { type: "transfer:completed"; fileId: string; checksumVerified: boolean }
  | { type: "transfer:cancel"; reason?: string }
  | { type: "cloud:offer"; files: FileMetadata[]; downloadUrl: string; encryptionKeyJwk?: JsonWebKey; ivHex?: string }
  | { type: "peer:disconnect"; role: PeerRole };

export interface SignalEnvelope {
  id: string;
  roomId: string;
  fromRole: PeerRole;
  timestamp: number;
  message: SignalMessage;
}
