"use client";

import { FileMetadata } from "@/types/transfer";
import { DeviceInfo } from "@/types/session";
import { FileIcon, ShieldCheck, Download, X } from "lucide-react";

interface FileApprovalProps {
  senderDevice?: DeviceInfo | null;
  files: FileMetadata[];
  onAccept: () => void;
  onDecline: () => void;
}

export function FileApproval({
  senderDevice,
  files,
  onAccept,
  onDecline,
}: FileApprovalProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="w-full flex flex-col items-center gap-5 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#EAF6EE] text-[#2E7D4F] flex items-center justify-center shadow-sm">
        <Download className="w-7 h-7" />
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-[#2E7D4F] bg-[#EAF6EE] px-2.5 py-1 rounded-full">
          Incoming Transfer
        </span>
        <h2 className="text-xl font-bold text-[#2C1A11] mt-2">Accept incoming files?</h2>
        <p className="text-xs text-[#6B5244] mt-1">
          From: <span className="font-semibold text-[#2C1A11]">{senderDevice?.name || "Connected Peer"}</span>
        </p>
      </div>

      {/* File summary list */}
      <div className="w-full max-w-sm flex flex-col gap-2 max-h-52 overflow-y-auto pr-1 text-left">
        {files.map((file, idx) => (
          <div
            key={`${file.name}-${idx}`}
            className="flex items-center justify-between p-3 rounded-xl bg-white border border-[#EDE2D3] shadow-sm"
          >
            <div className="flex items-center gap-3 min-w-0 pr-2">
              <div className="w-7 h-7 rounded-lg bg-[#F8F3EA] text-[#6B5244] flex items-center justify-center shrink-0">
                <FileIcon className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#2C1A11] truncate">{file.name}</p>
                <p className="text-[11px] text-[#9C8373]">{formatSize(file.size)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs font-medium text-[#6B5244]">
        Total: {files.length} {files.length === 1 ? "file" : "files"} ({formatSize(totalBytes)})
      </div>

      <div className="flex items-center gap-3 w-full max-w-xs mt-1">
        <button
          onClick={onDecline}
          className="flex-1 py-3 px-4 rounded-xl border border-[#DFD0BE] bg-white hover:bg-[#FDEEEB] hover:text-[#C23E2A] hover:border-[#C23E2A] text-sm font-semibold text-[#6B5244] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Decline</span>
        </button>

        <button
          onClick={onAccept}
          className="flex-1 py-3 px-4 rounded-xl btn-primary text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Accept</span>
        </button>
      </div>

      <div className="flex items-center gap-1 text-[11px] text-[#9C8373]">
        <ShieldCheck className="w-3.5 h-3.5 text-[#2E7D4F]" />
        <span>Integrity verified with SHA-256</span>
      </div>
    </div>
  );
}
