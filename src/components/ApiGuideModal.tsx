"use client";

import { useEffect, useState } from "react";
import { X, Copy, Check, Terminal, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface ApiGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApiGuideModal({ isOpen, onClose }: ApiGuideModalProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    toast.success("Command copied to clipboard");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const commands = [
    {
      title: "1. Upload a File via Terminal",
      desc: "Sends any file directly through the CLI API endpoint:",
      cmd: `curl -F "file=@document.pdf" https://qrdown.vercel.app/api/cli`,
    },
    {
      title: "2. Pipe Data or Text from STDIN",
      desc: "Stream piped terminal output or text strings immediately:",
      cmd: `echo "Confidential server token" | curl -F "file=@-" https://qrdown.vercel.app/api/cli`,
    },
    {
      title: "3. Download Transferred File",
      desc: "Fetches and saves the remote file preserving original filename:",
      cmd: `curl -sLOJ https://qrdown.vercel.app/api/cli/<TRANSFER_ID>`,
    },
    {
      title: "4. Query Transfer Metadata (JSON)",
      desc: "Inspect file details, expiration, and download link programmatically:",
      cmd: `curl -sH "Accept: application/json" https://qrdown.vercel.app/api/cli/<TRANSFER_ID>`,
    },
    {
      title: "5. Early Delete / Purge",
      desc: "Immediately purge the object from cloud storage before the 1-hour expiry:",
      cmd: `curl -X DELETE https://qrdown.vercel.app/api/cli/<TRANSFER_ID>`,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-zinc-900 text-white">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 id="api-modal-title" className="text-sm font-bold text-zinc-900">
                Command Line &amp; HTTP API
              </h2>
              <p className="text-xs text-zinc-500">
                Direct headless file transfers via curl
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="rounded-lg bg-blue-50/80 border border-blue-200/70 p-3 text-blue-900 leading-relaxed">
            <p className="font-semibold text-blue-950">Zero-Config CLI Transfers</p>
            <p className="mt-0.5 text-blue-800 text-[11px]">
              Files uploaded via the CLI API are encrypted and retained for 1 hour. Maximum file size is 100 MB.
            </p>
          </div>

          <div className="space-y-3">
            {commands.map((c, i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-800">{c.title}</span>
                  <button
                    onClick={() => copyToClipboard(c.cmd, i)}
                    className="flex items-center gap-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 bg-white px-2 py-0.5 rounded border border-zinc-200 shadow-2xs hover:bg-zinc-50 transition-colors"
                  >
                    {copiedIndex === i ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-700 font-semibold">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">{c.desc}</p>
                <div className="p-2.5 rounded-lg bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto selection:bg-zinc-800">
                  <code>{c.cmd}</code>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modal Footer with Author Credit */}
        <div className="px-5 py-3 border-t border-zinc-200 bg-zinc-50/80 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <span>Engineered by</span>
            <a
              href="https://github.com/M-Arham07"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-900 hover:text-blue-600 underline underline-offset-2 flex items-center gap-1"
            >
              M-Arham07
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
