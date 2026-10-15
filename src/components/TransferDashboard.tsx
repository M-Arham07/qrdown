"use client";

import { TransferProgress, ConnectionMode } from "@/types/transfer";
import { DeviceInfo } from "@/types/session";
import { Wifi, Globe, Cloud, XCircle } from "lucide-react";

interface TransferDashboardProps {
  progress: TransferProgress | null;
  connectionMode: ConnectionMode;
  peerDevice?: DeviceInfo | null;
  currentFileName?: string;
  onCancel: () => void;
}

export function TransferDashboard({
  progress,
  connectionMode,
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

  const modeBadge = () => {
    switch (connectionMode) {
      case "LOCAL_P2P":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#2E7D4F] bg-[#EAF6EE] px-2.5 py-0.5 rounded-full border border-[#D0ECD9]">
            <Wifi className="w-3 h-3" />
            <span>Direct Local Wi-Fi (P2P)</span>
          </span>
        );
      case "INTERNET_P2P":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#C45F2C] bg-[#FBECE3] px-2.5 py-0.5 rounded-full border border-[#F3D5C3]">
            <Globe className="w-3 h-3" />
            <span>Direct Internet (P2P)</span>
          </span>
        );
      case "CLOUD":
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#2B72A8] bg-[#EAF2FA] px-2.5 py-0.5 rounded-full border border-[#CDE1F4]">
            <Cloud className="w-3 h-3" />
            <span>Encrypted Cloud Transfer</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#6B5244] bg-[#F8F3EA] px-2.5 py-0.5 rounded-full">
            <Globe className="w-3 h-3" />
            <span>P2P Relay</span>
          </span>
        );
    }
  };

  const percentage = progress?.percentage || 0;
  const fileName = progress?.fileName || currentFileName || "Transferring file...";
  const transferred = progress ? formatSize(progress.bytesTransferred) : "0 B";
  const total = progress ? formatSize(progress.totalBytes) : "0 B";
  const speed = progress ? formatSpeed(progress.speedBytesPerSec) : "Calculating...";
  const eta = progress?.etaSeconds ? `~${progress.etaSeconds}s remaining` : "";

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Header status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{modeBadge()}</div>
        <div className="text-xs text-[#9C8373] font-medium">
          Connected to {peerDevice?.name || "Peer"}
        </div>
      </div>

      {/* Progress card */}
      <div className="bg-[#FAF6EF] p-5 sm:p-6 rounded-2xl border border-[#EDE2D3] flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-[#2C1A11] truncate">{fileName}</h3>
            <p className="text-xs text-[#6B5244] mt-0.5">
              {transferred} of {total}
            </p>
          </div>
          <span className="text-2xl font-extrabold text-[#C45F2C] shrink-0">{percentage}%</span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-3 rounded-full bg-[#EFE6D8] overflow-hidden">
          <div
            className="h-full bg-[#C45F2C] rounded-full progress-fill"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Metrics line */}
        <div className="flex items-center justify-between text-xs text-[#6B5244] font-medium pt-1">
          <span>{speed}</span>
          {eta && <span>{eta}</span>}
        </div>
      </div>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        className="w-full py-2.5 px-4 rounded-xl border border-[#DFD0BE] bg-white hover:bg-[#FDEEEB] hover:text-[#C23E2A] hover:border-[#C23E2A] text-xs font-semibold text-[#6B5244] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
      >
        <XCircle className="w-4 h-4" />
        <span>Cancel Transfer</span>
      </button>
    </div>
  );
}
