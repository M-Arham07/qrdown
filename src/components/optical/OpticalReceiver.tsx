"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import jsQR from "jsqr";
import {
  parseOpticalFrame,
  assembleOpticalFile,
  OpticalFileInfo,
} from "@/services/qrProtocol";
import {
  Camera,
  Download,
  CheckCircle2,
  AlertCircle,
  SwitchCamera,
  FileCheck,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

export function OpticalReceiver() {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [cameraPermission, setCameraPermission] = useState<
    "prompt" | "granted" | "denied"
  >("prompt");
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment"
  );
  const [fileInfo, setFileInfo] = useState<OpticalFileInfo | null>(null);
  const [collectedChunks, setCollectedChunks] = useState<Map<number, string>>(
    new Map()
  );
  const [lastScannedFrameId, setLastScannedFrameId] = useState<string>("");
  const [completedBlob, setCompletedBlob] = useState<{
    blob: Blob;
    url: string;
  } | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Keep a ref to collectedChunks and fileInfo to prevent stale closure inside animation loop
  const collectedChunksRef = useRef<Map<number, string>>(new Map());
  const fileInfoRef = useRef<OpticalFileInfo | null>(null);

  // Stop camera media tracks
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setActiveStream(null);
    setIsScanning(false);
  }, []);

  // Finish assembly once all chunks are present
  const finalizeFile = useCallback((info: OpticalFileInfo, chunks: Map<number, string>) => {
    try {
      const blob = assembleOpticalFile(info, chunks);
      const url = URL.createObjectURL(blob);
      setCompletedBlob({ blob, url });
      stopCamera();
      toast.success(`Received ${info.name} (${(info.size / 1024).toFixed(1)} KB)!`);

      // Trigger auto-download
      const a = document.createElement("a");
      a.href = url;
      a.download = info.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Assembly error:", err);
      toast.error("Failed to assemble file from collected frames");
    }
  }, [stopCamera]);

  // Frame processing loop with jsQR
  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if (code && code.data) {
      const parsed = parseOpticalFrame(code.data);
      if (parsed) {
        // Draw emerald bounding box over detected QR code
        ctx.beginPath();
        ctx.moveTo(code.location.topLeftCorner.x, code.location.topLeftCorner.y);
        ctx.lineTo(code.location.topRightCorner.x, code.location.topRightCorner.y);
        ctx.lineTo(code.location.bottomRightCorner.x, code.location.bottomRightCorner.y);
        ctx.lineTo(code.location.bottomLeftCorner.x, code.location.bottomLeftCorner.y);
        ctx.closePath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#10B981";
        ctx.stroke();

        if (parsed.type === "HEADER") {
          setLastScannedFrameId(`Header (${parsed.name})`);
          if (!fileInfoRef.current || fileInfoRef.current.id !== parsed.id) {
            const newInfo: OpticalFileInfo = {
              id: parsed.id,
              name: parsed.name,
              size: parsed.size,
              type: parsed.mimeType,
              totalChunks: parsed.totalChunks,
              chunkSize: Math.ceil(parsed.size / parsed.totalChunks),
            };
            fileInfoRef.current = newInfo;
            setFileInfo(newInfo);
            const newMap = new Map<number, string>();
            collectedChunksRef.current = newMap;
            setCollectedChunks(new Map(newMap));
          }
        } else if (parsed.type === "CHUNK") {
          const currentInfo = fileInfoRef.current;
          if (!currentInfo || currentInfo.id === parsed.id) {
            setLastScannedFrameId(`Chunk #${parsed.index + 1}`);

            if (!collectedChunksRef.current.has(parsed.index)) {
              collectedChunksRef.current.set(parsed.index, parsed.data);
              const updated = new Map(collectedChunksRef.current);
              setCollectedChunks(updated);

              if (currentInfo && updated.size === currentInfo.totalChunks) {
                finalizeFile(currentInfo, updated);
                return;
              }
            }
          }
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }, [finalizeFile]);

  // Attach stream to video whenever activeStream updates
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStream) return;

    video.srcObject = activeStream;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;

    let isCancelled = false;
    video
      .play()
      .then(() => {
        if (!isCancelled) {
          setIsScanning(true);
          setIsLoadingCamera(false);
          animationFrameRef.current = requestAnimationFrame(scanFrame);
        }
      })
      .catch((err) => {
        console.error("Video play() failed:", err);
        if (!isCancelled) {
          setIsLoadingCamera(false);
          toast.error("Tap screen or retry to allow video playback.");
        }
      });

    return () => {
      isCancelled = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [activeStream, scanFrame]);

  // Request camera access with progressive fallbacks for mobile browsers
  const startCamera = async () => {
    setIsLoadingCamera(true);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        toast.error("Camera is not supported in this browser environment. Ensure HTTPS is used.");
        setIsLoadingCamera(false);
        return;
      }

      // Stop previous tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      let stream: MediaStream | null = null;

      // 1. Try with ideal facingMode and resolution
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err1) {
        console.warn("First camera constraint failed, trying basic facingMode:", err1);
        // 2. Fallback to basic facingMode without dimensions
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode,
            },
            audio: false,
          });
        } catch (err2) {
          console.warn("Second camera constraint failed, trying generic video constraint:", err2);
          // 3. Last fallback: any available video device
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      if (stream) {
        streamRef.current = stream;
        setActiveStream(stream);
        setCameraPermission("granted");
      }
    } catch (err: unknown) {
      console.error("All camera access attempts failed:", err);
      setCameraPermission("denied");
      setIsLoadingCamera(false);
      setIsScanning(false);
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast.error("Camera permission was denied. Please allow camera access in browser settings.");
      } else {
        toast.error("Camera could not be opened. Ensure no other app is using it.");
      }
    }
  };

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  // Switch camera when facingMode changes if already scanning
  useEffect(() => {
    if (activeStream) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const total = fileInfo?.totalChunks || 0;
  const receivedCount = collectedChunks.size;
  const progressPercent = total > 0 ? Math.round((receivedCount / total) * 100) : 0;

  // Calculate missing chunks
  const missingIndices: number[] = [];
  if (total > 0 && receivedCount < total) {
    for (let i = 0; i < total; i++) {
      if (!collectedChunks.has(i)) {
        missingIndices.push(i + 1);
        if (missingIndices.length >= 8) break;
      }
    }
  }

  const handleReset = () => {
    setCompletedBlob(null);
    setFileInfo(null);
    fileInfoRef.current = null;
    collectedChunksRef.current = new Map();
    setCollectedChunks(new Map());
    setLastScannedFrameId("");
  };

  return (
    <div className="w-full space-y-6">
      {completedBlob && fileInfo ? (
        /* Completed Download Card */
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-6 shadow-sm text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div>
            <h3 className="text-base font-semibold text-[#18181B]">
              Air-Gapped Transfer Complete!
            </h3>
            <p className="text-xs text-[#71717A] mt-1">
              Received 100% offline via optical QR stream
            </p>
          </div>

          <div className="max-w-xs mx-auto bg-[#F4F4F5] p-3 rounded-xl text-left border border-[#E4E4E7]">
            <p className="text-xs font-semibold text-[#18181B] truncate">
              {fileInfo.name}
            </p>
            <p className="text-[11px] text-[#71717A] mt-0.5">
              {(fileInfo.size / 1024).toFixed(1)} KB • {fileInfo.totalChunks} chunks assembled
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2">
            <a
              href={completedBlob.url}
              download={fileInfo.name}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium rounded-xl transition-all shadow-sm"
            >
              <Download className="w-4 h-4" /> Save File Again
            </a>

            <button
              onClick={handleReset}
              className="px-4 py-2.5 bg-[#F4F4F5] hover:bg-[#E4E4E7] text-[#18181B] text-xs font-medium rounded-xl transition-colors"
            >
              Scan Another File
            </button>
          </div>
        </div>
      ) : (
        /* Scanner UI */
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-[#F4F4F5]">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-[#2563EB]" />
              <h3 className="text-sm font-semibold text-[#18181B]">
                Optical Camera Scanner
              </h3>
            </div>

            {activeStream && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleFacingMode}
                  className="p-1.5 text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-lg transition-colors text-xs flex items-center gap-1.5"
                  title="Switch Front/Rear Camera"
                >
                  <SwitchCamera className="w-3.5 h-3.5" /> Flip Camera
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-medium transition-colors"
                >
                  Stop Camera
                </button>
              </div>
            )}
          </div>

          {/* Always-mounted Viewfinder Container */}
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-video max-h-[380px] flex items-center justify-center border border-[#E4E4E7]">
            {/* The HTML5 Video Element: Always present in the DOM */}
            <video
              ref={videoRef}
              playsInline
              autoPlay
              muted
              className={`w-full h-full object-cover ${activeStream ? "block" : "hidden"}`}
            />

            {/* Overlay Canvas for QR Tracking Reticle */}
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 w-full h-full pointer-events-none ${activeStream ? "block" : "hidden"}`}
            />

            {/* Target Reticle when active */}
            {activeStream && (
              <>
                <div className="absolute w-52 h-52 sm:w-56 sm:h-56 border-2 border-white/70 rounded-2xl pointer-events-none flex items-center justify-center shadow-lg">
                  <div className="w-44 h-44 sm:w-48 sm:h-48 border border-dashed border-white/50 rounded-xl" />
                </div>

                {/* Live HUD Banner */}
                <div className="absolute top-3 inset-x-3 flex items-center justify-between px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-xl text-white text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Live Scanning
                  </span>
                  <span className="text-white/80 truncate max-w-[180px]">
                    {lastScannedFrameId || "Aim camera at QR stream"}
                  </span>
                </div>
              </>
            )}

            {/* Placeholder state when camera is inactive */}
            {!activeStream && (
              <div className="absolute inset-0 bg-[#FAFAFA] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-blue-50 text-[#2563EB] flex items-center justify-center mb-3">
                  <Camera className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-semibold text-[#18181B] mb-1">
                  Point camera at sender&apos;s animated QR code
                </h4>
                <p className="text-xs text-[#71717A] max-w-sm mb-4">
                  The scanner reads frames directly from your screen and downloads the
                  file 100% offline.
                </p>
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={isLoadingCamera}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#18181B] hover:bg-[#27272A] text-white text-xs font-medium rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {isLoadingCamera ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Opening Camera...
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" /> Start Camera Scan
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Transfer Progress HUD */}
          {fileInfo ? (
            <div className="bg-[#F4F4F5] border border-[#E4E4E7] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <FileCheck className="w-4 h-4 text-[#2563EB]" />
                  <span className="font-semibold text-[#18181B] truncate max-w-[180px]">
                    {fileInfo.name}
                  </span>
                </div>
                <span className="font-bold text-[#18181B]">
                  {progressPercent}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 w-full bg-[#E4E4E7] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#71717A]">
                <span>
                  Collected {receivedCount} of {total} chunks
                </span>
                <span>{(fileInfo.size / 1024).toFixed(1)} KB</span>
              </div>

              {missingIndices.length > 0 && (
                <div className="text-[11px] text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Waiting for missing chunks: #{missingIndices.join(", #")}
                    {fileInfo.totalChunks - receivedCount > 8 ? "..." : ""}
                  </span>
                </div>
              )}
            </div>
          ) : (
            isScanning && (
              <div className="text-xs text-[#71717A] text-center bg-[#FAFAFA] p-3 rounded-xl border border-[#F4F4F5]">
                Waiting for header frame... Keep the sender QR code inside the camera box.
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
