"use client";

import { CheckCircle2, AlertCircle, RefreshCw, Send, ShieldCheck } from "lucide-react";

interface TransferStatusProps {
  status: "COMPLETED" | "CANCELLED" | "ERROR";
  errorMessage?: string | null;
  onReset: () => void;
}

export function TransferStatus({ status, errorMessage, onReset }: TransferStatusProps) {
  if (status === "COMPLETED") {
    return (
      <div className="w-full flex flex-col items-center gap-5 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#EAF6EE] text-[#2E7D4F] flex items-center justify-center shadow-sm">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[#2E7D4F] bg-[#EAF6EE] px-2.5 py-1 rounded-full">
            Transfer Finished
          </span>
          <h2 className="text-2xl font-bold text-[#2C1A11] mt-2">Files Transferred Successfully</h2>
          <p className="text-xs text-[#6B5244] mt-1 max-w-sm">
            All bytes transferred with 100% integrity. File has been saved to your downloads.
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-[#2E7D4F] bg-[#EAF6EE] border border-[#D0ECD9] px-3 py-1.5 rounded-full">
          <ShieldCheck className="w-4 h-4" />
          <span>SHA-256 Checksum Verified</span>
        </div>

        <button
          onClick={onReset}
          className="w-full max-w-xs py-3.5 px-6 rounded-xl btn-primary font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer mt-2"
        >
          <Send className="w-4 h-4" />
          <span>Send Another File</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-5 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#FDEEEB] text-[#C23E2A] flex items-center justify-center shadow-sm">
        <AlertCircle className="w-9 h-9" />
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wider text-[#C23E2A] bg-[#FDEEEB] px-2.5 py-1 rounded-full">
          {status === "CANCELLED" ? "Cancelled" : "Transfer Failed"}
        </span>
        <h2 className="text-xl font-bold text-[#2C1A11] mt-2">
          {status === "CANCELLED" ? "Transfer was cancelled" : "An error occurred"}
        </h2>
        <p className="text-xs text-[#6B5244] mt-1 max-w-sm">
          {errorMessage || "The transfer could not be completed. Please try again."}
        </p>
      </div>

      <button
        onClick={onReset}
        className="w-full max-w-xs py-3 px-6 rounded-xl btn-primary font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer mt-2"
      >
        <RefreshCw className="w-4 h-4" />
        <span>Try Again</span>
      </button>
    </div>
  );
}
