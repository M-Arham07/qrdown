import { create } from "zustand";
import { DeviceInfo, PeerRole, RoomSession } from "@/types/session";
import { getDeviceInfo } from "@/services/deviceDetection";

interface SessionStore {
  myDevice: DeviceInfo;
  peerDevice: DeviceInfo | null;
  role: PeerRole | null;
  session: RoomSession | null;
  pendingApproval: boolean;
  approvalGranted: boolean;

  setMyDevice: (device: DeviceInfo) => void;
  setPeerDevice: (device: DeviceInfo | null) => void;
  setRole: (role: PeerRole | null) => void;
  setSession: (session: RoomSession | null) => void;
  setPendingApproval: (pending: boolean) => void;
  setApprovalGranted: (granted: boolean) => void;
  resetSession: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  myDevice: getDeviceInfo(),
  peerDevice: null,
  role: null,
  session: null,
  pendingApproval: false,
  approvalGranted: false,

  setMyDevice: (myDevice) => set({ myDevice }),
  setPeerDevice: (peerDevice) => set({ peerDevice }),
  setRole: (role) => set({ role }),
  setSession: (session) => set({ session }),
  setPendingApproval: (pendingApproval) => set({ pendingApproval }),
  setApprovalGranted: (approvalGranted) => set({ approvalGranted }),
  resetSession: () =>
    set({
      peerDevice: null,
      role: null,
      session: null,
      pendingApproval: false,
      approvalGranted: false,
    }),
}));
