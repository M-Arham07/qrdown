"use client";

import { useState } from "react";
import { useSessionStore } from "@/stores/useSessionStore";
import { updateDeviceName } from "@/services/deviceDetection";
import { Share2, Smartphone, Monitor, Edit2, ShieldCheck, Check } from "lucide-react";
import { toast } from "sonner";

export function Header() {
  const { myDevice, setMyDevice } = useSessionStore();
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(myDevice.name);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const updated = updateDeviceName(nameInput);
    setMyDevice(updated);
    setIsEditing(false);
    toast.success("Device name updated");
  };

  return (
    <header className="w-full border-b border-[#EDE2D3] bg-[#FDFBF7]/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#C45F2C] flex items-center justify-center text-white shadow-sm">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg text-[#2C1A11] tracking-tight">WebSend</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FBECE3] text-[#C45F2C]">
                P2P
              </span>
            </div>
          </div>
        </div>

        {/* Center / Privacy Notice */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-[#6B5244] bg-[#F8F3EA] px-3 py-1 rounded-full border border-[#EDE2D3]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#2E7D4F]" />
          <span>No accounts · No file storage on P2P</span>
        </div>

        {/* Device Name Pill */}
        <div className="flex items-center gap-2">
          {isEditing ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={30}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#C45F2C] bg-white text-[#2C1A11] focus:outline-none w-36 sm:w-44"
                autoFocus
              />
              <button
                type="submit"
                className="p-1.5 rounded-lg bg-[#C45F2C] text-white hover:bg-[#AA4E20] transition-colors"
                title="Save"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => {
                setNameInput(myDevice.name);
                setIsEditing(true);
              }}
              className="flex items-center gap-2 text-xs font-medium text-[#2C1A11] bg-[#F8F3EA] hover:bg-[#EFE6D8] border border-[#DFD0BE] px-3 py-1.5 rounded-full transition-colors cursor-pointer group"
              title="Click to rename this device"
            >
              {myDevice.isMobile ? (
                <Smartphone className="w-3.5 h-3.5 text-[#6B5244]" />
              ) : (
                <Monitor className="w-3.5 h-3.5 text-[#6B5244]" />
              )}
              <span className="max-w-[130px] sm:max-w-[180px] truncate">{myDevice.name}</span>
              <Edit2 className="w-3 h-3 text-[#9C8373] group-hover:text-[#C45F2C] transition-colors" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
