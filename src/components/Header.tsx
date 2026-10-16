"use client";

import Link from "next/link";
import { useState } from "react";
import { useSessionStore } from "@/stores/useSessionStore";
import { updateDeviceName } from "@/services/deviceDetection";
import { Smartphone, Monitor, Edit2, Check } from "lucide-react";
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
    <header className="w-full border-b border-[#E4E4E7] bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">WebSend</Link>

        {/* Device Name Pill */}
        <div className="flex items-center gap-2">
          {isEditing ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
              <input
                aria-label="Device name"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={30}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#1D4ED8] bg-white text-[#18181B] focus:outline-none w-36 sm:w-44"
                autoFocus
              />
              <button
                type="submit"
                className="p-1.5 rounded-lg bg-[#1D4ED8] text-white hover:bg-[#1E40AF] transition-colors"
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
              className="flex items-center gap-2 text-xs font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] border border-[#D4D4D8] px-3 py-1.5 rounded-full transition-colors cursor-pointer group"
              title="Click to rename this device"
            >
              {myDevice.isMobile ? (
                <Smartphone className="w-3.5 h-3.5 text-[#52525B]" />
              ) : (
                <Monitor className="w-3.5 h-3.5 text-[#52525B]" />
              )}
              <span className="max-w-[130px] sm:max-w-[180px] truncate">{myDevice.name}</span>
              <Edit2 className="w-3 h-3 text-[#71717A] group-hover:text-[#1D4ED8] transition-colors" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
