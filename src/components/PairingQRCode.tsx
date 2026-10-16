"use client";

import { useState, useEffect } from "react";
import QRCode from "react-qr-code";
import { Copy, Check, Clock, QrCode as QrIcon, Link2 } from "lucide-react";
import { toast } from "sonner";

interface PairingQRCodeProps {
  roomId: string;
  code: string;
  expiresAt: number;
}

export function PairingQRCode({ code, expiresAt }: PairingQRCodeProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [timeLeft, setTimeLeft] = useState("");

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/?code=${code}`
      : `/?code=${code}`;

  useEffect(() => {
    const updateCountdown = () => {
      const remainingMs = Math.max(0, expiresAt - Date.now());
      const mins = Math.floor(remainingMs / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, "0")}`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const copyToClipboard = (text: string, type: "code" | "link") => {
    navigator.clipboard.writeText(text);
    if (type === "code") {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
      toast.success("Code copied");
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      toast.success("Link copied");
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-[#18181B] tracking-tight">Connect your other device</h2>
        <p className="text-xs text-[#52525B] mt-1 max-w-sm">
          Open QRDown on your other device and scan the QR code or enter the 6-digit room code.
        </p>
      </div>

      {/* QR Code Container */}
      <div className="p-4 sm:p-5 bg-white rounded-lg border-2 border-[#E4E4E7]  flex flex-col items-center gap-3">
        <div className="bg-white p-2 rounded-lg">
          <QRCode
            value={shareUrl}
            size={180}
            bgColor="#FFFFFF"
            fgColor="#18181B"
            level="M"
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[#71717A]">
          <QrIcon className="w-3.5 h-3.5" />
          <span>Point your phone camera here</span>
        </div>
      </div>

      {/* 6-Digit Room Code Card */}
      <div className="w-full max-w-sm flex flex-col gap-2">
        <div className="text-xs font-semibold text-[#52525B] text-center uppercase tracking-wider">
          Connection code
        </div>
        <button
          type="button"
          aria-label={`Copy connection code ${code}`}
          onClick={() => copyToClipboard(code, "code")}
          className="flex items-center justify-between p-3.5 bg-white rounded-lg border border-[#D4D4D8]  hover:border-[#1D4ED8] transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <span className="room-code-badge text-2xl font-bold text-[#1D4ED8] pl-2">{code}</span>
          </div>
          <span
            className="flex items-center gap-1 text-xs font-medium text-[#52525B] group-hover:text-[#1D4ED8] transition-colors px-2 py-1 rounded-md bg-[#F4F4F5]"
          >
            {copiedCode ? <Check className="w-3.5 h-3.5 text-[#2E7D4F]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedCode ? "Copied" : "Copy"}</span>
          </span>
        </button>

        {/* Shareable Link Button */}
        <button
          onClick={() => copyToClipboard(shareUrl, "link")}
          className="w-full py-2.5 px-3 rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] hover:bg-[#F3ECE0] text-xs font-medium text-[#52525B] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          {copiedLink ? <Check className="w-3.5 h-3.5 text-[#2E7D4F]" /> : <Link2 className="w-3.5 h-3.5" />}
          <span>{copiedLink ? "Link copied!" : "Copy link"}</span>
        </button>
      </div>

      {/* Expiry / Waiting indicator */}
      <div className="flex items-center gap-4 text-xs text-[#71717A]">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>Expires in {timeLeft}</span>
        </div>
        <span>•</span>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#1D4ED8]" />
          <span className="text-[#52525B]">Waiting for device</span>
        </div>
      </div>
    </div>
  );
}
