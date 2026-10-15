"use client";

import { DeviceInfo } from "@/types/session";
import { Smartphone, Monitor, ShieldCheck, Check, X } from "lucide-react";

interface DeviceApprovalProps {
  device: DeviceInfo;
  onApprove: () => void;
  onReject: () => void;
}

export function DeviceApproval({ device, onApprove, onReject }: DeviceApprovalProps) {
  return (
    <div className="w-full flex flex-col items-center gap-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#FBECE3] text-[#C45F2C] flex items-center justify-center shadow-sm">
        {device.isMobile ? <Smartphone className="w-8 h-8" /> : <Monitor className="w-8 h-8" />}
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-[#C45F2C] bg-[#FBECE3] px-2.5 py-1 rounded-full">
          Pairing Request
        </span>
        <h2 className="text-xl font-bold text-[#2C1A11] mt-2">Connect with this device?</h2>
        <p className="text-sm font-medium text-[#6B5244] mt-1">{device.name}</p>
        <p className="text-xs text-[#9C8373] mt-2 max-w-sm">
          A peer entered your pairing code and is requesting to establish a direct WebRTC connection.
        </p>
      </div>

      <div className="flex items-center gap-3 w-full max-w-xs mt-2">
        <button
          onClick={onReject}
          className="flex-1 py-3 px-4 rounded-xl border border-[#DFD0BE] bg-white hover:bg-[#FDEEEB] hover:text-[#C23E2A] hover:border-[#C23E2A] text-sm font-semibold text-[#6B5244] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Decline</span>
        </button>

        <button
          onClick={onApprove}
          className="flex-1 py-3 px-4 rounded-xl btn-primary text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>Accept</span>
        </button>
      </div>

      <div className="flex items-center gap-1 text-[11px] text-[#9C8373]">
        <ShieldCheck className="w-3.5 h-3.5 text-[#2E7D4F]" />
        <span>End-to-end encrypted connection</span>
      </div>
    </div>
  );
}
