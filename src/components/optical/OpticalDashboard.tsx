"use client";

import { useState } from "react";
import { OpticalSender } from "./OpticalSender";
import { OpticalReceiver } from "./OpticalReceiver";
import { QrCode, Camera, ShieldCheck, WifiOff } from "lucide-react";

export function OpticalDashboard() {
  const [subTab, setSubTab] = useState<"send" | "receive">("send");

  return (
    <div className="w-full space-y-5">
      {/* Informational Air-Gapped Banner */}
      <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-blue-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-700 flex items-center justify-center shrink-0">
            <WifiOff className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#18181B]">
                Air-Gapped Optical Mode
              </span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded-full">
                100% Offline
              </span>
            </div>
            <p className="text-[11px] text-[#71717A]">
              Transfers data purely through visual light using animated QR codes & camera. Zero Wi-Fi, zero Bluetooth, zero server access needed.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] bg-white/80 px-2.5 py-1 rounded-lg border border-emerald-500/10">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Air-gapped safe</span>
        </div>
      </div>

      {/* Sub-tab Switcher: Send vs Receive */}
      <div className="flex items-center justify-center">
        <div className="inline-flex bg-[#F4F4F5] p-1 rounded-xl border border-[#E4E4E7]">
          <button
            type="button"
            onClick={() => setSubTab("send")}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              subTab === "send"
                ? "bg-white text-[#18181B] shadow-sm"
                : "text-[#71717A] hover:text-[#18181B]"
            }`}
          >
            <QrCode className="w-3.5 h-3.5 text-[#2563EB]" />
            Send via Animated QR
          </button>
          <button
            type="button"
            onClick={() => setSubTab("receive")}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              subTab === "receive"
                ? "bg-white text-[#18181B] shadow-sm"
                : "text-[#71717A] hover:text-[#18181B]"
            }`}
          >
            <Camera className="w-3.5 h-3.5 text-emerald-600" />
            Receive with Camera
          </button>
        </div>
      </div>

      {/* Active Mode Component */}
      {subTab === "send" ? <OpticalSender /> : <OpticalReceiver />}
    </div>
  );
}
