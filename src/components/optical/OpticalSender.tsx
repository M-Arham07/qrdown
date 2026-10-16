"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "react-qr-code";
import {
  createOpticalFrames,
  ChunkDensity,
  CHUNK_DENSITIES,
  OpticalFileInfo,
} from "@/services/qrProtocol";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  UploadCloud,
  FileText,
  Maximize2,
  Minimize2,
  RefreshCw,
  Gauge,
  Sliders,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export function OpticalSender() {
  const [file, setFile] = useState<File | null>(null);
  const [density, setDensity] = useState<ChunkDensity>("balanced");
  const [fps, setFps] = useState<number>(6);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [fileInfo, setFileInfo] = useState<OpticalFileInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Generate frames whenever file or density changes
  useEffect(() => {
    if (!file) {
      setFrames([]);
      setFileInfo(null);
      setCurrentIndex(0);
      return;
    }

    let isMounted = true;
    setIsGenerating(true);

    createOpticalFrames(file, density)
      .then(({ frames: generatedFrames, fileInfo: info }) => {
        if (!isMounted) return;
        setFrames(generatedFrames);
        setFileInfo(info);
        setCurrentIndex(0);
        setIsPlaying(true);
        setIsGenerating(false);
      })
      .catch((err) => {
        console.error("Frame generation failed", err);
        toast.error("Failed to process file into QR frames");
        setIsGenerating(false);
      });

    return () => {
      isMounted = false;
    };
  }, [file, density]);

  // Frame animation loop
  useEffect(() => {
    if (!isPlaying || frames.length <= 1) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = Math.round(1000 / fps);
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % frames.length);
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, frames.length, fps]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.size > 2 * 1024 * 1024) {
        toast.warning(
          "File is over 2 MB. Optical QR transfers work best with small files (under 1–2 MB)."
        );
      }
      setFile(selected);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      if (dropped.size > 2 * 1024 * 1024) {
        toast.warning(
          "File is over 2 MB. Optical QR transfers work best with small files (under 1–2 MB)."
        );
      }
      setFile(dropped);
    }
  };

  const currentFrameText = frames[currentIndex] || "";
  const isHeader = currentIndex === 0;
  const chunkNumber = isHeader ? 0 : currentIndex;
  const totalDataChunks = fileInfo ? fileInfo.totalChunks : 0;

  return (
    <div className="w-full space-y-6">
      {/* File Dropzone / Selected card */}
      {!file ? (
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="border-2 border-dashed border-[#D4D4D8] hover:border-[#2563EB] rounded-2xl p-8 text-center transition-colors bg-white shadow-sm flex flex-col items-center justify-center min-h-[220px]"
        >
          <div className="w-14 h-14 rounded-full bg-blue-50 text-[#2563EB] flex items-center justify-center mb-4">
            <UploadCloud className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-[#18181B] mb-1">
            Choose a file for Air-Gapped Optical Transfer
          </h3>
          <p className="text-xs text-[#71717A] max-w-sm mb-4">
            Encodes your file into an animated high-contrast QR stream. Point the
            receiver&apos;s camera to transfer 100% offline.
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium rounded-lg cursor-pointer transition-colors shadow-sm">
            <UploadCloud className="w-4 h-4" />
            Select File
            <input
              type="file"
              className="hidden"
              onChange={handleFileChange}
              id="optical-file-input"
            />
          </label>
          <span className="text-[11px] text-[#A1A1AA] mt-3">
            Recommended: documents, keys, configs, notes & images up to ~2 MB
          </span>
        </div>
      ) : (
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5 shadow-sm space-y-4">
          {/* File Header Details */}
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-[#F4F4F5]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#18181B] truncate max-w-[220px] sm:max-w-xs">
                  {file.name}
                </p>
                <p className="text-xs text-[#71717A]">
                  {(file.size / 1024).toFixed(1)} KB • {frames.length} total QR frames
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setFile(null);
                setFrames([]);
              }}
              className="text-xs text-[#71717A] hover:text-[#DC2626] transition-colors px-2 py-1 rounded"
            >
              Change file
            </button>
          </div>

          {/* Density & Speed Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-medium text-[#71717A] flex items-center gap-1.5 mb-1.5">
                <Sliders className="w-3.5 h-3.5" /> QR Code Density
              </label>
              <div className="grid grid-cols-3 gap-1 bg-[#F4F4F5] p-1 rounded-lg">
                {(Object.keys(CHUNK_DENSITIES) as ChunkDensity[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDensity(d)}
                    className={`text-xs py-1.5 px-2 rounded-md font-medium capitalize transition-all ${
                      density === d
                        ? "bg-white text-[#18181B] shadow-sm"
                        : "text-[#71717A] hover:text-[#18181B]"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#71717A] flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" /> Transfer Speed
                </label>
                <span className="text-xs font-semibold text-[#18181B]">
                  {fps} FPS (~{Math.round((frames.length / fps) * 10) / 10}s cycle)
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="12"
                step="1"
                value={fps}
                onChange={(e) => setFps(parseInt(e.target.value, 10))}
                className="w-full accent-[#2563EB] cursor-pointer h-2 bg-[#E4E4E7] rounded-lg"
              />
            </div>
          </div>

          {/* QR Display Area */}
          <div
            className={`relative flex flex-col items-center justify-center p-6 bg-white rounded-xl border border-[#E4E4E7] transition-all ${
              isFullscreen
                ? "fixed inset-0 z-50 bg-white p-8 flex flex-col items-center justify-center"
                : ""
            }`}
          >
            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="absolute top-3 right-3 p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-lg transition-colors"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen for easier scanning"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>

            {/* Current Frame Status Badge */}
            <div className="flex items-center gap-2 mb-4">
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  isHeader
                    ? "bg-amber-100 text-amber-800"
                    : "bg-blue-100 text-[#1D4ED8]"
                }`}
              >
                {isHeader
                  ? "Header Frame (Meta)"
                  : `Frame ${chunkNumber} of ${totalDataChunks}`}
              </span>
              <span className="text-xs text-[#71717A]">
                Cycle: {Math.round(((currentIndex + 1) / frames.length) * 100)}%
              </span>
            </div>

            {/* The Animated QR SVG */}
            <div className="p-4 bg-white rounded-xl shadow-sm border border-[#E4E4E7]">
              {currentFrameText ? (
                <QRCode
                  value={currentFrameText}
                  size={isFullscreen ? 360 : 256}
                  level="M"
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center text-xs text-[#71717A]">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#2563EB] mb-2" />
                </div>
              )}
            </div>

            {/* Playback Progress Indicator */}
            <div className="w-full max-w-xs mt-4">
              <div className="h-1.5 w-full bg-[#E4E4E7] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#2563EB] transition-all duration-150"
                  style={{
                    width: `${((currentIndex + 1) / frames.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Player Controls */}
            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={() =>
                  setCurrentIndex((prev) =>
                    prev === 0 ? frames.length - 1 : prev - 1
                  )
                }
                className="p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-full transition-colors"
                title="Previous Frame"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="px-4 py-2 bg-[#18181B] text-white hover:bg-[#27272A] rounded-full font-medium text-xs flex items-center gap-2 transition-all shadow-sm"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Pause Stream
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" /> Resume Stream
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  setCurrentIndex((prev) => (prev + 1) % frames.length)
                }
                className="p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-full transition-colors"
                title="Next Frame"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {isFullscreen && (
              <button
                onClick={() => setIsFullscreen(false)}
                className="mt-6 px-4 py-1.5 bg-[#F4F4F5] hover:bg-[#E4E4E7] text-[#18181B] text-xs font-medium rounded-lg transition-colors"
              >
                Close Fullscreen
              </button>
            )}
          </div>

          <div className="text-[11px] text-[#71717A] text-center bg-blue-50/60 p-2.5 rounded-lg border border-blue-100 flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
            <span>
              The sender loops frames continuously. The receiver camera will grab
              each chunk automatically until complete.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
