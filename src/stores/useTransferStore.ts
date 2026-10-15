import { create } from "zustand";
import { TransferState, ConnectionMode, FileMetadata, TransferProgress } from "@/types/transfer";

interface TransferStore {
  state: TransferState;
  connectionMode: ConnectionMode;
  selectedFiles: File[];
  incomingFiles: FileMetadata[];
  activeFileIndex: number;
  progress: TransferProgress | null;
  errorMessage: string | null;
  cloudOfferPayload: {
    files: FileMetadata[];
    downloadUrl: string;
    encryptionKeyJwk?: JsonWebKey;
    ivHex?: string;
    objectKey?: string;
  } | null;

  // Actions
  setState: (state: TransferState) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setSelectedFiles: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  removeFile: (index: number) => void;
  setIncomingFiles: (files: FileMetadata[]) => void;
  setActiveFileIndex: (index: number) => void;
  setProgress: (progress: TransferProgress | null) => void;
  setErrorMessage: (msg: string | null) => void;
  setCloudOfferPayload: (payload: TransferStore["cloudOfferPayload"]) => void;
  reset: () => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  state: "IDLE",
  connectionMode: "INTERNET_P2P",
  selectedFiles: [],
  incomingFiles: [],
  activeFileIndex: 0,
  progress: null,
  errorMessage: null,
  cloudOfferPayload: null,

  setState: (state) => set({ state }),
  setConnectionMode: (connectionMode) => set({ connectionMode }),
  setSelectedFiles: (selectedFiles) => set({ selectedFiles }),
  addFiles: (newFiles) =>
    set((s) => ({
      selectedFiles: [...s.selectedFiles, ...newFiles],
    })),
  removeFile: (index) =>
    set((s) => ({
      selectedFiles: s.selectedFiles.filter((_, i) => i !== index),
    })),
  setIncomingFiles: (incomingFiles) => set({ incomingFiles }),
  setActiveFileIndex: (activeFileIndex) => set({ activeFileIndex }),
  setProgress: (progress) => set({ progress }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  setCloudOfferPayload: (cloudOfferPayload) => set({ cloudOfferPayload }),
  reset: () =>
    set({
      state: "IDLE",
      connectionMode: "INTERNET_P2P",
      selectedFiles: [],
      incomingFiles: [],
      activeFileIndex: 0,
      progress: null,
      errorMessage: null,
      cloudOfferPayload: null,
    }),
}));
