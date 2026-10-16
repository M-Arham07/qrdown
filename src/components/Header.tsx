"use client";

import Link from "next/link";
import Image from "next/image";
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
    <header className="w-full border-b border-[#E4E4E7] bg-white sticky top-0 z-40 backdrop-blur-md bg-white/95">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        {/* Logo & Brand */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-[#09090B] flex items-center justify-center p-1 shadow-xs transition-transform group-hover:scale-105 overflow-hidden">
            <svg viewBox="0 0 512 512" fill="none" className="w-full h-full">
              {/* Outer White Squircle Frame */}
              <rect x="86" y="86" width="340" height="340" rx="88" stroke="#FFFFFF" strokeWidth="48" fill="none"/>
              {/* Little Blue QR Code Matrix */}
              <g fill="#3B82F6">
                <rect x="168" y="168" width="66" height="66" rx="16" stroke="#3B82F6" strokeWidth="13" fill="none"/>
                <rect x="191" y="191" width="20" height="20" rx="5"/>
                <rect x="278" y="168" width="66" height="66" rx="16" stroke="#3B82F6" strokeWidth="13" fill="none"/>
                <rect x="301" y="191" width="20" height="20" rx="5"/>
                <rect x="168" y="278" width="66" height="66" rx="16" stroke="#3B82F6" strokeWidth="13" fill="none"/>
                <rect x="191" y="301" width="20" height="20" rx="5"/>
                <rect x="246" y="172" width="20" height="20" rx="5"/>
                <rect x="246" y="209" width="20" height="20" rx="5"/>
                <rect x="246" y="246" width="20" height="20" rx="5"/>
                <rect x="246" y="283" width="20" height="20" rx="5"/>
                <rect x="246" y="320" width="20" height="20" rx="5"/>
                <rect x="172" y="246" width="20" height="20" rx="5"/>
                <rect x="209" y="246" width="20" height="20" rx="5"/>
                <rect x="283" y="246" width="20" height="20" rx="5"/>
                <rect x="320" y="246" width="20" height="20" rx="5"/>
                <rect x="283" y="283" width="20" height="20" rx="5"/>
                <rect x="320" y="283" width="20" height="20" rx="5"/>
                <rect x="283" y="320" width="20" height="20" rx="5"/>
                <rect x="320" y="320" width="20" height="20" rx="5"/>
              </g>
            </svg>
          </div>
          <div className="flex items-center">
            <span className="text-lg font-bold tracking-tight text-[#09090B]">QRDown</span>
          </div>
        </Link>

        {/* Right Section: Author reference + Device Name Pill */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Made by M-Arham07 Link */}
          <a
            href="https://github.com/M-Arham07"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#09090B] font-medium py-1 px-2.5 rounded-full hover:bg-[#F4F4F5] transition-colors"
            title="View M-Arham07 on GitHub"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-[#71717A]">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span className="hidden sm:inline">Made by</span>
            <span className="font-semibold text-[#09090B] hover:underline underline-offset-2">M-Arham07</span>
          </a>

          {/* Device Name Pill */}
          {isEditing ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
              <input
                aria-label="Device name"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={30}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#1D4ED8] bg-white text-[#18181B] focus:outline-none w-28 sm:w-40"
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
              className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-[#18181B] bg-[#F4F4F5] hover:bg-[#E4E4E7] border border-[#D4D4D8] px-2.5 sm:px-3 py-1.5 rounded-full transition-colors cursor-pointer group"
              title="Click to rename this device"
            >
              {myDevice.isMobile ? (
                <Smartphone className="w-3.5 h-3.5 text-[#52525B]" />
              ) : (
                <Monitor className="w-3.5 h-3.5 text-[#52525B]" />
              )}
              <span className="max-w-[100px] sm:max-w-[160px] truncate">{myDevice.name}</span>
              <Edit2 className="w-3 h-3 text-[#71717A] group-hover:text-[#1D4ED8] transition-colors" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
