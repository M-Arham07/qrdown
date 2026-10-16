"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { OpticalFileInfo } from "@/services/qrProtocol";
import type { ScannerRequest, ScannerResponse } from "@/services/qrWorkerTypes";
import { useWakeLock } from "@/hooks/useWakeLock";

type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorConstructor = {
  new(options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};
type Phase = "idle" | "opening" | "scanning" | "verifying" | "complete";

export function OpticalReceiver() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [info, setInfo] = useState<OpticalFileInfo | null>(null);
  const [progress, setProgress] = useState({ bytes: 0, chunks: 0, speed: 0 });
  const [downloadUrl, setDownloadUrl] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const urlRef = useRef("");
  const generationRef = useRef(0);
  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const scheduleRef = useRef<{ id: number; kind: "video" | "animation" } | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useWakeLock(phase === "scanning" || phase === "verifying");

  const stop = useCallback(() => {
    generationRef.current++;
    runningRef.current = false;
    busyRef.current = false;
    const callback = scheduleRef.current;
    if (callback?.kind === "video") videoRef.current?.cancelVideoFrameCallback(callback.id);
    else if (callback) cancelAnimationFrame(callback.id);
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
    setInfo(null);
    setProgress({ bytes: 0, chunks: 0, speed: 0 });
    setError("");
    setPhase("opening");
    let startedAt = 0;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser.");
      const worker = new Worker(new URL("../../workers/qrScanner.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onerror = () => {
        if (generation !== generationRef.current) return;
        stop();
        setPhase("idle");
        setError("The QR scanner could not start. Please update your browser and try again.");
      };
      worker.onmessage = ({ data }: MessageEvent<ScannerResponse>) => {
        if (generation !== generationRef.current) return;
        if (data.type === "scanned") { busyRef.current = false; return; }
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
          stop();
          setPhase("complete");
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = data.info.name;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
        } });
      } catch (cameraError) {
        if (cameraError instanceof DOMException && cameraError.name === "NotAllowedError") throw cameraError;
        if (generation !== generationRef.current) return;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (generation !== generationRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable");
      video.srcObject = stream;
      await video.play();
      if (generation !== generationRef.current) return;
      // Prefer the browser's native QR decoder; the worker handles other browsers.
      detectorRef.current = null;
      const NativeDetector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (NativeDetector) {
        try {
          const formats = await NativeDetector.getSupportedFormats?.();
          if (!formats || formats.includes("qr_code")) detectorRef.current = new NativeDetector({ formats: ["qr_code"] });
        } catch { /* Use jsQR in the worker. */ }
      }
      if (generation !== generationRef.current) return;
      runningRef.current = true;
      setPhase("scanning");
      let lastVideoTime = -1;
      let useBitmap = typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
      const schedule = () => {
        if (!runningRef.current || generation !== generationRef.current) return;
        if (video.requestVideoFrameCallback) {
          scheduleRef.current = { kind: "video", id: video.requestVideoFrameCallback(() => { void scan(); }) };
        } else scheduleRef.current = { kind: "animation", id: requestAnimationFrame(() => { void scan(); }) };
      };
      const scan = async () => {
        if (!runningRef.current || generation !== generationRef.current) return;
        if (video.readyState < 2 || busyRef.current || video.currentTime === lastVideoTime) { schedule(); return; }
        lastVideoTime = video.currentTime;
        busyRef.current = true;
        try {
          if (detectorRef.current) {
            try {
              const codes = await detectorRef.current.detect(video);
              if (generation !== generationRef.current) return;
              const code = codes.find(candidate => candidate.rawValue.startsWith("WS2:") || candidate.rawValue.startsWith("WS1|"));
              if (code) worker.postMessage({ type: "text", text: code.rawValue } satisfies ScannerRequest);
              else busyRef.current = false;
            } catch { detectorRef.current = null; busyRef.current = false; }
          } else {
            const side = Math.min(video.videoWidth, video.videoHeight);
            const x = Math.floor((video.videoWidth - side) / 2);
            const y = Math.floor((video.videoHeight - side) / 2);
            const size = Math.min(720, side);
            if (useBitmap) {
              let bitmap: ImageBitmap;
              try {
                bitmap = await createImageBitmap(video, x, y, side, side, { resizeWidth: size, resizeHeight: size });
              } catch {
                // Some browsers expose this API without supporting video inputs.
                useBitmap = false;
                busyRef.current = false;
                schedule();
                return;
              }
              if (generation !== generationRef.current) { bitmap.close(); return; }
              worker.postMessage({ type: "scan", bitmap } satisfies ScannerRequest, [bitmap]);
            } else {
              const canvas = canvasRef.current ??= document.createElement("canvas");
              if (canvas.width !== size) canvas.width = canvas.height = size;
              const context = canvas.getContext("2d", { willReadFrequently: true });
              if (!context) throw new Error("Camera image processing is unavailable");
              context.drawImage(video, x, y, side, side, 0, 0, size, size);
              const image = context.getImageData(0, 0, size, size);
              worker.postMessage({ type: "scanPixels", pixels: image.data, width: size, height: size } satisfies ScannerRequest, [image.data.buffer]);
            }
          }
        } catch {
          if (generation !== generationRef.current) return;
          busyRef.current = false;
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
          <p className="mt-1 text-sm text-zinc-600">{phase === "complete" ? "File verified. Your download is ready." : phase === "verifying" ? "Restoring and verifying file…" : "Keep the sender’s code inside the camera view."}</p>
        </div>
        <span className="shrink-0 text-4xl font-semibold tabular-nums tracking-tight text-zinc-950" aria-label={`${percent}% received`}>{percent}%</span>
      </div>
      <div role="progressbar" aria-label="QR transfer received" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full bg-blue-700 transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
      <div className={`${phase === "complete" ? "hidden" : "block"} relative aspect-square overflow-hidden rounded-lg bg-zinc-950`}>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
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
      {phase === "complete" && <div className="flex flex-wrap gap-3">
        <a href={downloadUrl} download={info?.name} className="btn-primary inline-flex min-h-11 items-center rounded-lg px-5 text-sm font-medium">Save file</a>
        <button onClick={() => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = ""; setDownloadUrl(""); setInfo(null); setPhase("idle"); setProgress({ bytes: 0, chunks: 0, speed: 0 }); }} className="btn-secondary min-h-11 rounded-lg px-5 text-sm">Receive another</button>
      </div>}
      {(active || phase === "opening") && <button onClick={() => { stop(); setPhase("idle"); setInfo(null); setProgress({ bytes: 0, chunks: 0, speed: 0 }); }} className="btn-secondary min-h-11 w-full rounded-lg px-5 text-sm">Cancel</button>}
    </div>
  );
}
