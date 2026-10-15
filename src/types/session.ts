// Session, Room and Device types

export interface DeviceInfo {
  id: string;
  name: string;
  os?: string;
  browser?: string;
  isMobile: boolean;
}

export type PeerRole = "sender" | "receiver";

export interface RoomSession {
  roomId: string;
  secret: string;
  code: string; // 6-digit numeric room code
  createdAt: number;
  expiresAt: number;
  sender?: DeviceInfo;
  receiver?: DeviceInfo;
  status: "waiting" | "paired" | "active" | "closed";
  approved: boolean;
}
