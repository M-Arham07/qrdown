"use client";

import { TransferProgress, ConnectionMode } from "@/types/transfer";
import { DeviceInfo } from "@/types/session";
import { XCircle } from "lucide-react";

interface TransferDashboardProps {
  progress: TransferProgress | null;
  connectionMode: ConnectionMode;
  isReconnecting?: boolean;
  peerDevice?: DeviceInfo | null;
  currentFileName?: string;
  onCancel: () => void;
}

export function TransferDashboard({
  progress,
  connectionMode,
  isReconnecting = false,
  peerDevice,
  currentFileName,
  onCancel,
}: TransferDashboardProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const modeLabel = {
    LOCAL_P2P: "Direct connection",
    INTERNET_P2P: "Direct connection",
    TURN_RELAY: "Relay connection",
    CLOUD: "Cloud transfer",
  }[connectionMode];

  const percentage = progress?.percentage || 0;
  const fileName = progress?.fileName || currentFileName || "Transferring file...";
  const transferred = progress ? formatSize(progress.bytesTransferred) : "0 B";
  const total = progress ? formatSize(progress.totalBytes) : "0 B";
  const speed = progress ? formatSpeed(progress.speedBytesPerSec) : "Calculating...";
  const eta = progress?.etaSeconds ? `~${progress.etaSeconds}s remaining` : "";

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Header status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[#52525B]">{isReconnecting ? "Reconnecting…" : modeLabel}</span>
        <div className="text-xs text-[#71717A] font-medium">
          {isReconnecting ? `Waiting for ${peerDevice?.name || "peer"}` : `Connected to ${peerDevice?.name || "Peer"}`}
        </div>
      </div>

      {isReconnecting && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" aria-live="polite">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-700 border-t-transparent" />
          <span>Connection interrupted. Trying to restore the transfer.</span>
        </div>
      )}

      {/* Progress card */}
      <div className="bg-[#FAFAFA] p-5 sm:p-6 rounded-lg border border-[#E4E4E7] flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-[#18181B] truncate">{fileName}</h3>
            <p className="text-xs text-[#52525B] mt-0.5">
              {transferred} of {total}
            </p>
          </div>
          <span className="text-2xl font-extrabold text-[#1D4ED8] shrink-0">{percentage}%</span>
        </div>

        {/* Progress bar */}
        <div role="progressbar" aria-label="File transfer" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} className="w-full h-2 rounded-full bg-[#E4E4E7] overflow-hidden">
          <div
            className="h-full bg-[#1D4ED8] rounded-full progress-fill"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Metrics line */}
        <div className="flex items-center justify-between text-xs text-[#52525B] font-medium pt-1">
          <span>{speed}</span>
          {eta && <span>{eta}</span>}
        </div>
      </div>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        className="w-full py-2.5 px-4 rounded-lg border border-[#D4D4D8] bg-white hover:bg-[#FDEEEB] hover:text-[#C23E2A] hover:border-[#C23E2A] text-xs font-semibold text-[#52525B] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
      >
        <XCircle className="w-4 h-4" />
        <span>Cancel Transfer</span>
      </button>
    </div>
  );
}
