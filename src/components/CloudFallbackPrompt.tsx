"use client";

import { Cloud, Lock, ShieldCheck, ArrowRight, X } from "lucide-react";

interface CloudFallbackPromptProps {
  onAccept: () => void;
  onCancel: () => void;
}

export function CloudFallbackPrompt({ onAccept, onCancel }: CloudFallbackPromptProps) {
  return (
    <div className="w-full flex flex-col items-center gap-5 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#EAF2FA] text-[#2B72A8] flex items-center justify-center shadow-sm">
        <Cloud className="w-7 h-7" />
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-[#2B72A8] bg-[#EAF2FA] px-2.5 py-1 rounded-full">
          Connection Notice
        </span>
        <h2 className="text-xl font-bold text-[#2C1A11] mt-2">Direct connection unavailable</h2>
        <p className="text-xs text-[#6B5244] mt-1 max-w-sm">
          Both devices could not establish a direct peer-to-peer route (often caused by restrictive corporate or cellular NATs).
        </p>
      </div>

      {/* Security explanation card */}
      <div className="w-full bg-[#FAF6EF] p-4 rounded-xl border border-[#EDE2D3] text-left flex flex-col gap-2.5">
        <div className="flex items-center gap-2 text-xs font-bold text-[#2C1A11]">
          <Lock className="w-4 h-4 text-[#C45F2C]" />
          <span>Switch to Encrypted Cloud Transfer?</span>
        </div>
        <ul className="text-xs text-[#6B5244] space-y-1.5 list-disc pl-4">
          <li>Your browser encrypts files with <strong>AES-256-GCM</strong> before uploading.</li>
          <li>The cloud server never receives your plaintext files or encryption keys.</li>
          <li>Temporary storage is <strong>immediately purged</strong> once download is verified.</li>
        </ul>
      </div>

      <div className="flex items-center gap-3 w-full max-w-xs mt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-3 px-4 rounded-xl border border-[#DFD0BE] bg-white hover:bg-[#F8F3EA] text-sm font-semibold text-[#6B5244] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Cancel</span>
        </button>

        <button
          onClick={onAccept}
          className="flex-1 py-3 px-4 rounded-xl btn-primary text-sm font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <span>Use Cloud</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 text-[11px] text-[#9C8373]">
        <ShieldCheck className="w-3.5 h-3.5 text-[#2E7D4F]" />
        <span>End-to-end client-side encryption guaranteed</span>
      </div>
    </div>
  );
}
