"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Pause, Play, Maximize2 } from "lucide-react";
import { TransferComposer } from "@/components/TransferComposer";
import { QR_STREAM } from "@/services/qrProtocol";
import type { OpticalFileInfo } from "@/services/qrProtocol";
import type { EncoderRequest, EncoderResponse } from "@/services/qrWorkerTypes";
import { useWakeLock } from "@/hooks/useWakeLock";

export function OpticalSender() {
  const [info, setInfo] = useState<OpticalFileInfo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [frameNumber, setFrameNumber] = useState(0);
  const [error, setError] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRef = useRef({ playing: true, index: 0, count: 0, reportedAt: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  useWakeLock(!!info && playing);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const chooseFile = (file?: File) => {
    if (!file) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    setInfo(null);
    setError("");
    setFrameNumber(0);
    if (file.size > QR_STREAM.maxFileBytes) {
      setError("Choose a file up to 1 MB, or use a network transfer.");
      setPreparing(false);
      return;
    }
    setPreparing(true);
    setPlaying(true);
    playbackRef.current = { playing: true, index: 0, count: 0, reportedAt: 0 };
    const worker = new Worker(new URL("../../workers/qrEncoder.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const request = (message: EncoderRequest) => worker.postMessage(message);
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setPreparing(false);
      setError("Could not prepare the stream. Try a smaller file.");
      worker.terminate();
      workerRef.current = null;
      setInfo(null);
    };
    worker.onmessage = ({ data }: MessageEvent<EncoderResponse>) => {
      if (workerRef.current !== worker) return;
      if (data.type === "error") {
        setError(data.message);
        setPreparing(false);
        worker.terminate();
        workerRef.current = null;
        setInfo(null);
        return;
      }
      if (data.type === "ready") {
        setInfo(data.info);
        setPreparing(false);
        playbackRef.current.count = data.frameCount;
        request({ type: "frame", index: 0 });
        return;
      }
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { alpha: false });
      if (!canvas || !context) return;
      const side = data.size + 8; // Four white modules on every side.
      const scale = Math.max(1, Math.floor(900 / side));
      if (canvas.width !== side * scale) canvas.width = canvas.height = side * scale;
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#000000";
      for (let row = 0; row < data.size; row++) {
        for (let col = 0; col < data.size; col++) {
          if (data.modules[row * data.size + col]) context.fillRect((col + 4) * scale, (row + 4) * scale, scale, scale);
        }
      }
      const playback = playbackRef.current;
      playback.index = data.index;
      const now = performance.now();
      if (now - playback.reportedAt > 250) {
        setFrameNumber(data.chunkIndex === null ? 0 : data.chunkIndex + 1);
        playback.reportedAt = now;
      }
      if (playback.playing) {
        // The worker caches ahead so the UI only paints each ready matrix.
        const delay = data.index === 0 ? 100 : 1000 / QR_STREAM.framesPerSecond;
        timerRef.current = setTimeout(() => request({ type: "frame", index: (data.index + 1) % playback.count }), delay);
      }
    };
    request({ type: "prepare", file });
  };

  const togglePlayback = () => {
    const playback = playbackRef.current;
    playback.playing = !playback.playing;
    setPlaying(playback.playing);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (playback.playing) workerRef.current?.postMessage({ type: "frame", index: (playback.index + 1) % playback.count } satisfies EncoderRequest);
  };
  const reset = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    setInfo(null);
    setPreparing(false);
    setError("");
  };

  return (
    <div className="space-y-5">
      <input ref={inputRef} type="file" aria-label="File to send by QR" className="hidden"
        onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
      {!info && !preparing && (
        <button type="button" onClick={() => inputRef.current?.click()}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}
          className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 px-5 py-8 text-center transition-colors hover:border-blue-700 hover:bg-zinc-50">
          <Upload className="h-6 w-6 text-zinc-500" aria-hidden="true" />
          <span className="text-sm font-medium text-zinc-950">Choose a file</span>
          <span className="text-sm text-zinc-600">Up to 1 MB. Compression is automatic.</span>
        </button>
      )}
      {!info && !preparing && <TransferComposer maxBytes={QR_STREAM.maxFileBytes} actionLabel="Start QR transfer" onAdd={files => chooseFile(files[0])} />}
      {preparing && <p className="py-12 text-center text-sm text-zinc-600" role="status">Preparing file…</p>}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div ref={stageRef} className={`${info ? "block" : "hidden"} bg-white fullscreen:flex fullscreen:h-screen fullscreen:flex-col fullscreen:items-center fullscreen:justify-center fullscreen:p-4 [&:fullscreen_canvas]:max-w-[min(90vw,85vh)]`}>
        <canvas ref={canvasRef} role="img" aria-label="Animated QR file stream"
          className="mx-auto aspect-square w-full max-w-[460px]" style={{ imageRendering: "pixelated" }} />
      </div>
      {info && (
        <>
          <div className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-950">{info.name}</p>
              <p className="mt-1 text-zinc-600">{(info.size / 1024).toFixed(1)} KB{info.compression === "gzip" && ` · ${Math.round((1 - info.transferSize / info.size) * 100)}% smaller`}</p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-zinc-600">{frameNumber ? `${frameNumber} / ${info.totalChunks}` : "File details"}</span>
          </div>
          <p className="text-sm leading-relaxed text-zinc-600">Point the receiving camera at this code. Keep it open until the receiver reaches 100%.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={togglePlayback} aria-pressed={!playing} className="btn-secondary flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? "Pause" : "Resume"}
            </button>
            <button onClick={() => { if (stageRef.current?.requestFullscreen) void stageRef.current.requestFullscreen().catch(() => setError("Fullscreen is unavailable in this browser.")); }} className="btn-secondary flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm"><Maximize2 className="h-4 w-4" />Enlarge</button>
            <button onClick={reset} className="min-h-11 rounded-lg px-4 text-sm text-zinc-600 transition-colors hover:bg-zinc-100">Stop</button>
          </div>
        </>
      )}
      {preparing && <button onClick={reset} className="btn-secondary min-h-11 rounded-lg px-4 text-sm">Cancel</button>}
    </div>
  );
}
