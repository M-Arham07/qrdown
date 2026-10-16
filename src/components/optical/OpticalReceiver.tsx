"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReceivedText } from "@/components/ReceivedText";
import { canPreviewText } from "@/services/textTransfer";
import { Camera } from "lucide-react";
import type { OpticalFileInfo } from "@/services/qrProtocol";
import type { ScannerRequest, ScannerResponse } from "@/services/qrWorkerTypes";
import { useWakeLock } from "@/hooks/useWakeLock";

type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string; cornerPoints?: { x: number; y: number }[] }[]> };
type DetectorConstructor = {
  new(options: { formats: string[] }): Detector;
};
type Phase = "idle" | "opening" | "scanning" | "verifying" | "complete";

export function OpticalReceiver() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [info, setInfo] = useState<OpticalFileInfo | null>(null);
  const [progress, setProgress] = useState({ bytes: 0, chunks: 0, speed: 0 });
  const [receivedText, setReceivedText] = useState<Blob | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [cameraPaused, setCameraPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef("");
  const generationRef = useRef(0);
  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const scheduleRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outlineRef = useRef<HTMLCanvasElement>(null);
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWakeLock(phase === "scanning" || phase === "verifying");

  const stop = useCallback(() => {
    generationRef.current++;
    runningRef.current = false;
    busyRef.current = false;
    if (scheduleRef.current !== null) cancelAnimationFrame(scheduleRef.current);
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
    const outline = outlineRef.current;
    outline?.getContext("2d")?.clearRect(0, 0, outline.width, outline.height);
    scheduleRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);
  useEffect(() => () => {
    stop();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, [stop]);

  const start = async () => {
    stop();
    const generation = generationRef.current;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setDownloadUrl("");
    setReceivedText(null);
    setInfo(null);
    setProgress({ bytes: 0, chunks: 0, speed: 0 });
    setError("");
    setCameraPaused(false);
    setPhase("opening");
    let startedAt = 0;
    try {
      if (!window.isSecureContext) throw new Error("Open WebSend using HTTPS on your phone. Camera access does not work on an HTTP Wi-Fi address.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable. Open this page directly in Safari or Chrome.");
      const requestCamera = async (video: boolean | MediaTrackConstraints) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const pending = navigator.mediaDevices.getUserMedia({ audio: false, video }).then(stream => {
          // A permission prompt can resolve after cancellation or the timeout.
          if (generation !== generationRef.current) stream.getTracks().forEach(track => track.stop());
          return stream;
        });
        try {
          return await Promise.race([pending, new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              const error = new Error("Camera access timed out. Allow camera access in your browser’s site settings, then retry. If this page is inside another app, open it directly in Safari or Chrome.");
              error.name = "CameraPermissionTimeout";
              reject(error);
            }, 20000);
          })]);
        } finally { if (timeout) clearTimeout(timeout); }
      };
      let stream: MediaStream;
      try {
        stream = await requestCamera({
          facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
        });
      } catch (cameraError) {
        if (cameraError instanceof Error && ["NotAllowedError", "SecurityError", "CameraPermissionTimeout"].includes(cameraError.name)) throw cameraError;
        if (generation !== generationRef.current) return;
        stream = await requestCamera(true);
      }
      if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const worker = new Worker(new URL("../../workers/qrScanner.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onerror = () => {
        if (generation !== generationRef.current) return;
        stop();
        setPhase("idle");
        setError("The QR scanner could not start. Please update your browser and try again.");
      };
      let captureRegion = { x: 0, y: 0, width: 1, height: 1, outputWidth: 1, outputHeight: 1 };
      const drawOutline = (corners: { x: number; y: number }[]) => {
        const outline = outlineRef.current;
        if (!outline || corners.length !== 4) return;
        if (outlineTimerRef.current) clearTimeout(outlineTimerRef.current);
        outline.width = videoRef.current?.videoWidth || 1;
        outline.height = videoRef.current?.videoHeight || 1;
        const context = outline.getContext("2d");
        if (!context) return;
        context.strokeStyle = "#22c55e";
        context.lineWidth = Math.max(3, outline.width / 200);
        context.lineJoin = "round";
        context.beginPath();
        corners.forEach((point, index) => { if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); });
        context.closePath();
        context.stroke();
        outlineTimerRef.current = setTimeout(() => context.clearRect(0, 0, outline.width, outline.height), 600);
      };
      worker.onmessage = ({ data }: MessageEvent<ScannerResponse>) => {
        if (generation !== generationRef.current) return;
        if (data.type === "scanned") { busyRef.current = false; return; }
        if (data.type === "located") {
          drawOutline(data.corners.map(point => ({
            x: captureRegion.x + point.x / captureRegion.outputWidth * captureRegion.width,
            y: captureRegion.y + point.y / captureRegion.outputHeight * captureRegion.height,
          })));
          return;
        }
        if (data.type === "error") {
          stop();
          setPhase("idle");
          setError(data.message);
          return;
        }
        if (data.type === "progress") {
          const now = performance.now();
          if (!startedAt) startedAt = now;
          const seconds = (now - startedAt) / 1000;
          setInfo(data.info);
          setProgress({ bytes: data.bytes, chunks: data.chunks, speed: seconds > 0 ? data.bytes / seconds : 0 });
          if (data.verifying) setPhase("verifying");
          return;
        }
        if (data.type === "complete") {
          const url = URL.createObjectURL(data.blob);
          urlRef.current = url;
          setInfo(data.info);
          setDownloadUrl(url);
          setReceivedText(canPreviewText(data.blob, data.info.name) ? data.blob : null);
          stop();
          setPhase("complete");
          if (!canPreviewText(data.blob, data.info.name)) {
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = data.info.name;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          }
        }
      };
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable");
      // Set DOM properties before attaching the stream for mobile Safari.
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.srcObject = stream;
      runningRef.current = true;
      setCameraPaused(true);
      setPhase("scanning");
      const resume = () => {
        if (generation !== generationRef.current || document.hidden) return;
        void video.play().then(() => {
          if (generation === generationRef.current) setCameraPaused(false);
        }).catch(() => {
          if (generation === generationRef.current) setCameraPaused(true);
        });
      };
      const track = stream.getVideoTracks()[0];
      const focus = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
      if (focus?.focusMode?.includes("continuous")) {
        void track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {
          // Optional focus tuning must never prevent an otherwise working camera.
        });
      }
      const ended = () => {
        if (generation !== generationRef.current) return;
        stop();
        setPhase("idle");
        setError("The camera disconnected. Reconnect it or close other camera apps, then try again.");
      };
      track?.addEventListener("ended", ended);
      track?.addEventListener("unmute", resume);
      document.addEventListener("visibilitychange", resume);
      const startupTimeout = setTimeout(() => {
        if (generation !== generationRef.current || (video.readyState >= 2 && video.videoWidth > 0 && !video.paused)) return;
        setCameraPaused(true);
        setError("No camera image yet. Tap Resume camera, or close other apps using the camera and retry.");
      }, 10000);
      cleanupRef.current = () => {
        clearTimeout(startupTimeout);
        track?.removeEventListener("ended", ended);
        track?.removeEventListener("unmute", resume);
        document.removeEventListener("visibilitychange", resume);
      };
      resume();
      detectorRef.current = null;
      const NativeDetector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (NativeDetector) {
        try { detectorRef.current = new NativeDetector({ formats: ["qr_code"] }); }
        catch { /* Worker decoder is available on browsers without native QR support. */ }
      }
      let lastVideoTime = -1;
      let fullFrame = false;
      let sentAt = 0;
      let missed = 0;
      let lastNativeCode = "";
      const schedule = () => {
        if (!runningRef.current || generation !== generationRef.current) return;
        // RAF also recovers after backgrounding on browsers with stalled video-frame callbacks.
        scheduleRef.current = requestAnimationFrame(() => { void scan(); });
      };
      const capture = () => {
        // Alternate a sharp center crop with the full view so off-center codes aren't clipped.
        const square = Math.min(video.videoWidth, video.videoHeight);
        const width = fullFrame ? video.videoWidth : square;
        const height = fullFrame ? video.videoHeight : square;
        const scale = Math.min(1, 960 / Math.max(width, height));
        const canvas = canvasRef.current ??= document.createElement("canvas");
        const outputWidth = Math.max(1, Math.round(width * scale));
        const outputHeight = Math.max(1, Math.round(height * scale));
        if (canvas.width !== outputWidth) canvas.width = outputWidth;
        if (canvas.height !== outputHeight) canvas.height = outputHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Camera image processing is unavailable");
        context.drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
          width, height, 0, 0, outputWidth, outputHeight);
        const image = context.getImageData(0, 0, outputWidth, outputHeight);
        captureRegion = { x: (video.videoWidth - width) / 2, y: (video.videoHeight - height) / 2,
          width, height, outputWidth, outputHeight };
        worker.postMessage({ type: "scanPixels", pixels: image.data, width: outputWidth, height: outputHeight } satisfies ScannerRequest, [image.data.buffer]);
        fullFrame = !fullFrame;
      };
      const scan = async () => {
        if (!runningRef.current || generation !== generationRef.current) return;
        if (busyRef.current) {
          if (performance.now() - sentAt > 10000) {
            stop();
            setPhase("idle");
            setError("The QR decoder stopped responding. Start the camera again.");
            return;
          }
          schedule();
          return;
        }
        if (video.readyState < 2 || !video.videoWidth || video.paused || document.hidden || video.currentTime === lastVideoTime) { schedule(); return; }
        lastVideoTime = video.currentTime;
        busyRef.current = true;
        sentAt = performance.now();
        try {
          let code: { rawValue: string; cornerPoints?: { x: number; y: number }[] } | undefined;
          if (detectorRef.current && missed < 3) {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              const codes = await Promise.race([
                detectorRef.current.detect(video),
                new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Decoder timeout")), 500); }),
              ]);
              if (generation !== generationRef.current) return;
              code = codes.find(candidate => candidate.rawValue.startsWith("WS2:") || candidate.rawValue.startsWith("WS1|"));
              if (code && code.rawValue !== lastNativeCode) {
                missed = 0;
                lastNativeCode = code.rawValue;
              } else missed++;
              // Some native decoders keep returning a cached symbol after the screen changes.
              if (missed >= 3) code = undefined;
            } catch { detectorRef.current = null; }
            finally { if (timeout) clearTimeout(timeout); }
          }
          if (generation !== generationRef.current) return;
          if (code) {
            if (code.cornerPoints) drawOutline(code.cornerPoints);
            worker.postMessage({ type: "text", text: code.rawValue } satisfies ScannerRequest);
          }
          else capture();
        } catch (scanError) {
          if (generation !== generationRef.current) return;
          stop();
          setPhase("idle");
          setError(scanError instanceof Error ? scanError.message : "Could not read the camera image. Try again.");
          return;
        }
        schedule();
      };
      schedule();
    } catch (cameraError) {
      if (generation !== generationRef.current) return;
      stop();
      setPhase("idle");
      setError(cameraError instanceof DOMException && cameraError.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access, then try again."
        : cameraError instanceof DOMException && cameraError.name === "NotReadableError"
          ? "The camera is busy. Close other camera apps or tabs, then try again."
          : cameraError instanceof DOMException && cameraError.name === "NotFoundError"
            ? "No camera was found. Connect a webcam or enable your phone’s camera."
            : cameraError instanceof Error ? cameraError.message : "Could not open the camera");
    }
  };

  const active = phase === "scanning" || phase === "verifying";
  const percent = phase === "complete" ? 100 : info && info.transferSize > 0
    ? Math.min(99, Math.floor(progress.bytes / info.transferSize * 100)) : 0;
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-zinc-950">{info?.name || "Receive a file"}</h2>
          <p className="mt-1 text-sm text-zinc-600">{phase === "complete" ? (receivedText ? "Text received. Copy it or save it below." : "File verified. Your download is ready.") : phase === "verifying" ? "Restoring and verifying file…" : "Keep the sender’s code inside the camera view."}</p>
        </div>
        <span className="shrink-0 text-4xl font-semibold tabular-nums tracking-tight text-zinc-950" aria-label={`${percent}% received`}>{percent}%</span>
      </div>
      <div role="progressbar" aria-label="QR transfer received" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full bg-blue-700 transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
      <div className={`${phase === "complete" ? "hidden" : "block"} relative aspect-square overflow-hidden rounded-lg bg-zinc-950`}>
        <video ref={videoRef} autoPlay playsInline muted onPlaying={() => { if (runningRef.current) { setCameraPaused(false); setError(""); } }}
          onPause={() => { if (runningRef.current) setCameraPaused(true); }}
          className="h-full w-full object-contain" />
        <canvas ref={outlineRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
        {active && <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg border-2 border-green-500" />}
        {active && cameraPaused && <button type="button" onClick={() => { void videoRef.current?.play().catch(() => setError("Camera playback is blocked. Open this page directly in Safari or Chrome and try again.")); }} className="btn-primary absolute bottom-4 left-1/2 min-h-11 -translate-x-1/2 rounded-lg px-5 text-sm">Resume camera</button>}
        {!active && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-50 p-6 text-center">
          <Camera className="h-7 w-7 text-zinc-500" aria-hidden="true" />
          <button type="button" onClick={() => void start()} disabled={phase === "opening"} className="btn-primary min-h-11 rounded-lg px-5 text-sm font-medium disabled:opacity-50">
            {phase === "opening" ? "Opening camera…" : "Start camera"}
          </button>
        </div>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {info && active && <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums text-zinc-600">
        <span>{progress.chunks} / {info.totalChunks} frames received</span>
        <span>{progress.speed > 0 ? `${(progress.speed / 1024).toFixed(1)} KB/s` : "Waiting for data"}</span>
      </div>}
      {phase === "complete" && receivedText && <ReceivedText blob={receivedText} name={info?.name || "Received text"} />}
      {phase === "complete" && <div className="flex flex-wrap gap-3">
        {!receivedText && <a href={downloadUrl} download={info?.name} className="btn-primary inline-flex min-h-11 items-center rounded-lg px-5 text-sm font-medium">Save file</a>}
        <button onClick={() => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = ""; setDownloadUrl(""); setReceivedText(null); setInfo(null); setPhase("idle"); setProgress({ bytes: 0, chunks: 0, speed: 0 }); }} className="btn-secondary min-h-11 rounded-lg px-5 text-sm">Receive another</button>
      </div>}
      {(active || phase === "opening") && <button onClick={() => { stop(); setPhase("idle"); setInfo(null); setProgress({ bytes: 0, chunks: 0, speed: 0 }); }} className="btn-secondary min-h-11 w-full rounded-lg px-5 text-sm">Cancel</button>}
    </div>
  );
}
