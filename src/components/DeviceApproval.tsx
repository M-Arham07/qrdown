"use client";

import { DeviceInfo } from "@/types/session";
import { Smartphone, Monitor, Check, X } from "lucide-react";

interface DeviceApprovalProps {
  device: DeviceInfo;
  onApprove: () => void;
  onReject: () => void;
}

export function DeviceApproval({ device, onApprove, onReject }: DeviceApprovalProps) {
  return (
    <div className="w-full flex flex-col items-center gap-6 text-center">
      <div className="w-16 h-16 rounded-lg bg-[#EFF6FF] text-[#1D4ED8] flex items-center justify-center ">
        {device.isMobile ? <Smartphone className="w-8 h-8" /> : <Monitor className="w-8 h-8" />}
      </div>

      <div>
        <h2 className="text-xl font-bold text-[#18181B] mt-2">Connect with this device?</h2>
        <p className="text-sm font-medium text-[#52525B] mt-1">{device.name}</p>
        <p className="text-xs text-[#71717A] mt-2 max-w-sm">
          Only accept if you recognize this device.
        </p>
      </div>

      <div className="flex items-center gap-3 w-full max-w-xs mt-2">
        <button
          onClick={onReject}
          className="flex-1 py-3 px-4 rounded-lg border border-[#D4D4D8] bg-white hover:bg-[#FDEEEB] hover:text-[#C23E2A] hover:border-[#C23E2A] text-sm font-semibold text-[#52525B] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Decline</span>
        </button>

        <button
          onClick={onApprove}
          className="flex-1 py-3 px-4 rounded-lg btn-primary text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>Accept</span>
        </button>
      </div>
    </div>
  );
}
