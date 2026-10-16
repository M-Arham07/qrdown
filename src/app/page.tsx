"use client";

import { useState, useEffect, useEffectEvent, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import { FilePicker } from "@/components/FilePicker";
import { PairingQRCode } from "@/components/PairingQRCode";
import { TransferDashboard } from "@/components/TransferDashboard";
import { CloudFallbackPrompt } from "@/components/CloudFallbackPrompt";
import { TransferStatus } from "@/components/TransferStatus";
import { useTransferStore } from "@/stores/useTransferStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { useWakeLock } from "@/hooks/useWakeLock";
import { SignalingClient } from "@/services/signaling";
import { WebRTCEngine } from "@/services/webrtc";
import { fileTransferService } from "@/services/fileTransfer";
import { cloudFallbackService } from "@/services/cloudFallback";
import { FileMetadata } from "@/types/transfer";
import { SignalMessage } from "@/types/signaling";
import { ArrowDownToLine, Send, Zap, QrCode } from "lucide-react";
import { OpticalDashboard } from "@/components/optical/OpticalDashboard";
import { toast } from "sonner";

function MainContent() {
  const searchParams = useSearchParams();
  const [transferMode, setTransferMode] = useState<"network" | "optical">("network");
  const [activeTab, setActiveTab] = useState<"send" | "receive">(searchParams.get("code") ? "receive" : "send");
  const [codeInputValue, setCodeInputValue] = useState(searchParams.get("code") || "");
  const [isJoining, setIsJoining] = useState(false);

  const {
    state,
    connectionMode,
    selectedFiles,
    incomingFiles,
    progress,
    errorMessage,
    setState,
    setConnectionMode,
    setIncomingFiles,
    setProgress,
    setErrorMessage,
    setCloudOfferPayload,
    reset: resetTransfer,
  } = useTransferStore();

  const {
    myDevice,
    peerDevice,
    role,
    session,
    setRole,
    setSession,
    setPeerDevice,
    resetSession,
  } = useSessionStore();

  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRTCEngine | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const cancelRequestedRef = useRef(false);
  const operationRef = useRef<AbortController | null>(null);
  // Use a ref for transfer state to avoid stale closure in WebRTC callbacks
  const transferStateRef = useRef(state);

  // Signaling and RTC callbacks must use the latest render's session and file state.
  const handlersRef = useRef<{
    sender: (msg: SignalMessage) => Promise<void>;
    receiver: (msg: SignalMessage) => Promise<void>;
    data: (data: ArrayBuffer | string, receivedAt: number) => Promise<void>;
    sendFiles: () => Promise<void>;
  } | null>(null);


  // Buffer state for receiving files
  const incomingChunksRef = useRef<ArrayBuffer[]>([]);
  const currentReceivingFileIndexRef = useRef(0);
  const receiveStatsRef = useRef({ bytes: 0, chunks: 0, reportedBytes: 0, reportedAt: 0 });
  const incomingMessageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileAckRef = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  // Keep transferStateRef in sync so WebRTC callbacks don't see stale closures
  useEffect(() => {
    transferStateRef.current = state;
  }, [state]);

  // Screen WakeLock active when transferring
  useWakeLock(state === "TRANSFERRING" || state === "UPLOADING" || state === "DOWNLOADING");

  const cleanupConnections = () => {
    cancelRequestedRef.current = true;
    operationRef.current?.abort();
    incomingChunksRef.current = [];
    receiveStatsRef.current = { bytes: 0, chunks: 0, reportedBytes: 0, reportedAt: 0 };
    fileAckRef.current?.reject(new Error("Transfer cancelled"));
    fileAckRef.current = null;
    if (signalingRef.current) {
      signalingRef.current.stop();
      signalingRef.current = null;
    }
    if (webrtcRef.current) {
      webrtcRef.current.close();
      webrtcRef.current = null;
    }
    dataChannelRef.current = null;
  };

  /**
   * SENDER: Creates room, launches signaling listener, waits for receiver
   */
  const handleStartSharing = async () => {
    if (selectedFiles.length === 0) {
      toast.error("Please select at least one file to send");
      return;
    }

    cleanupConnections();
    const operation = new AbortController();
    operationRef.current = operation;
    cancelRequestedRef.current = false;
    try {
      setState("PAIRING");
      setRole("sender");

      const res = await fetch("/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: myDevice }),
        signal: operation.signal,
      });

      if (!res.ok) {
        throw new Error("Failed to create pairing session");
      }

      const sessionData = await res.json();
      operation.signal.throwIfAborted();
      setSession({
        roomId: sessionData.roomId,
        secret: sessionData.secret,
        code: sessionData.code,
        createdAt: Date.now(),
        expiresAt: sessionData.expiresAt,
        sender: myDevice,
        status: "waiting",
        approved: false,
      });

      // Start signaling client
      const signaling = new SignalingClient(sessionData.roomId, sessionData.secret, "sender");
      signalingRef.current = signaling;

      signaling.subscribe((msg) => handlersRef.current?.sender(msg));
      signaling.start();
    } catch (err) {
      if (operation.signal.aborted) return;
      console.error(err);
      setState("ERROR");
      setErrorMessage("Could not initialize pairing session. Please check connection.");
      toast.error("Failed to start session");
    }
  };

  /**
   * RECEIVER: Joins room using 6-digit code
   */
  const handleJoinWithCode = async (targetCode?: string) => {
    const codeToUse = targetCode || codeInputValue.trim();
    if (!codeToUse || codeToUse.length < 6) {
      toast.error("Please enter a valid 6-digit room code");
      return;
    }

    cleanupConnections();
    const operation = new AbortController();
    operationRef.current = operation;
    cancelRequestedRef.current = false;
    try {
      setIsJoining(true);
      setRole("receiver");

      const res = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToUse, device: myDevice }),
        signal: operation.signal,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Room code not found");
      }

      const { roomId, secret, session: roomSession } = await res.json();
      operation.signal.throwIfAborted();
      setSession(roomSession);
      setPeerDevice(roomSession.sender || null);

      setState("NEGOTIATING");
      toast.info("Connecting to sender...");

      // Code entry authorizes pairing and receipt of the selected files.
      const signaling = new SignalingClient(roomId, secret, "receiver");
      signalingRef.current = signaling;

      signaling.subscribe((msg) => handlersRef.current?.receiver(msg));
      signaling.start();
    } catch (err: unknown) {
      if (operation.signal.aborted) return;
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setIsJoining(false);
    }
  };

  /**
   * Setup WebRTC Engine (sender or receiver)
   */
  const setupWebRTC = async (isInitiator: boolean) => {
    const signaling = signalingRef.current;
    const currentSession = useSessionStore.getState().session;
    if (!currentSession || !signaling || cancelRequestedRef.current) return;
    let iceServers: RTCIceServer[] | undefined;
    try {
      const response = await fetch("/api/sessions/ice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({ roomId: currentSession.roomId, secret: currentSession.secret }),
      });
      if (!response.ok) throw new Error(`ICE configuration failed (${response.status})`);
      const config = await response.json();
      iceServers = config.iceServers;
      if (!config.dedicatedRelay) {
        console.warn("[WebRTC] No dedicated TURN configured; using public relay fallback");
      }
    } catch (error) {
      if (signalingRef.current !== signaling || cancelRequestedRef.current) return;
      console.warn("[WebRTC] ICE configuration unavailable:", error);
      setErrorMessage("Could not load connection settings. Please try again.");
      setState("ERROR");
      return;
    }
    if (signalingRef.current !== signaling || cancelRequestedRef.current) return;
    webrtcRef.current?.close();

    const webrtc = new WebRTCEngine({
      isInitiator,
      iceServers,
      onSignal: (msg) => {
        signalingRef.current?.send(msg);
      },
      onDataChannelReady: (channel) => {
        if (cancelRequestedRef.current || signalingRef.current !== signaling) { channel.close(); return; }
        dataChannelRef.current = channel;
        setState("P2P_CONNECTED");
        // Once DataChannel is open, slow down signaling poll — no more ICE candidates
        signalingRef.current?.setFastMode(false);
        toast.success("Secure connection established!");

        // If sender, now send file transfer request
        if (isInitiator) {
          void handlersRef.current?.sendFiles();
        }
      },
      onDataChannelMessage: (event) => {
        if (signalingRef.current !== signaling) return;
        if (typeof event.data === "string") {
          try {
            if (JSON.parse(event.data).type === "transfer:cancel") {
              stopTransfer();
              return;
            }
          } catch { /* The regular message handler reports malformed messages. */ }
        }
        // Preserve message order while a file is being verified asynchronously.
        incomingMessageQueueRef.current = incomingMessageQueueRef.current
          .then(() => {
            if (signalingRef.current !== signaling) return;
            return handlersRef.current?.data(event.data, event.timeStamp);
          })
          .catch((error) => {
            if (signalingRef.current !== signaling) return;
            console.error("[Transfer] Receive failed:", error);
            setState("ERROR");
            setErrorMessage(error instanceof Error ? error.message : "Could not receive file");
          });
      },
      onConnectionModeChange: (mode) => {
        setConnectionMode(mode);
      },
      onConnectionTimeout: () => {
        if (cancelRequestedRef.current || signalingRef.current !== signaling) return;
        // The engine exhausts connection recovery before offering cloud fallback.
        setState("CLOUD_OFFERED");
      },
      onDisconnected: () => {
        // Use ref to avoid stale closure — state captured at setup time would be wrong
        if (transferStateRef.current === "TRANSFERRING" || transferStateRef.current === "VERIFYING") {
          fileAckRef.current?.reject(new Error("Peer disconnected before confirming the file"));
          setState("ERROR");
          setErrorMessage("Peer disconnected unexpectedly during transfer.");
        }
      },
    });

    webrtc.init();
    webrtcRef.current = webrtc;
  };

  /**
   * SENDER: Signal routing
   */
  const handleSenderSignalMessage = async (msg: SignalMessage) => {
    if (msg.type === "transfer:cancel") { stopTransfer(); return; }
    if (cancelRequestedRef.current) return;
    switch (msg.type) {
      case "peer:join":
        setPeerDevice(msg.device);
        if (!webrtcRef.current) await startPairedConnection();
        break;

      case "signal:answer":
        if (webrtcRef.current) {
          await webrtcRef.current.handleAnswer(msg.sdp);
        }
        break;

      case "signal:ice":
        if (webrtcRef.current) {
          await webrtcRef.current.addIceCandidate(msg.candidate);
        }
        break;

      case "transfer:accepted":
        if (msg.accepted) {
          beginP2PSending();
        } else {
          setState("ERROR");
          setErrorMessage("Receiver declined the file transfer.");
          toast.error("Transfer rejected by receiver");
        }
        break;

      case "transfer:completed":
        setState("COMPLETED");
        toast.success("Transfer complete");
        break;
    }
  };

  /**
   * RECEIVER: Signal routing
   */
  const handleReceiverSignalMessage = async (msg: SignalMessage) => {
    if (msg.type === "transfer:cancel") { stopTransfer(); return; }
    if (cancelRequestedRef.current) return;
    switch (msg.type) {
      case "peer:approved":
        if (msg.approved) {
          if (!webrtcRef.current) await setupWebRTC(false);
        } else {
          setState("ERROR");
          setErrorMessage("Sender declined the pairing request.");
          toast.error("Connection rejected by sender");
        }
        break;

      case "signal:offer":
        if (!webrtcRef.current) {
          await setupWebRTC(false);
        }
        if (webrtcRef.current) {
          await webrtcRef.current.handleOffer(msg.sdp);
        }
        break;

      case "signal:ice":
        if (webrtcRef.current) {
          await webrtcRef.current.addIceCandidate(msg.candidate);
        }
        break;

      case "transfer:request":
        setIncomingFiles(msg.files);
        handleAcceptFiles();
        break;

      case "cloud:offer":
        setCloudOfferPayload({
          files: msg.files,
          downloadUrl: msg.downloadUrl,
          objectKey: msg.objectKey,
          encryptionKeyJwk: msg.encryptionKeyJwk,
          ivHex: msg.ivHex,
        });
        setState("DOWNLOADING");
        handleCloudDownload(msg);
        break;
    }
  };

  /**
   * SENDER: Starts negotiation as soon as the receiver enters the code.
   */
  const startPairedConnection = async () => {
    const signaling = signalingRef.current;
    if (!signaling || cancelRequestedRef.current) return;
    setState("NEGOTIATING");
    await setupWebRTC(true);
    if (signalingRef.current !== signaling || cancelRequestedRef.current || !webrtcRef.current) return;

    await signaling.send({
      type: "peer:approved",
      approved: true,
    });

    if (signalingRef.current !== signaling || cancelRequestedRef.current) return;
    await webrtcRef.current?.startNegotiation();
  };

  /**
   * SENDER: Sends transfer request with file metadata to receiver
   */
  const sendTransferRequest = async () => {
    const metadataList: FileMetadata[] = [];
    for (const file of selectedFiles) {
      const meta = await fileTransferService.prepareFileMetadataFast(file);
      metadataList.push(meta);
    }
    setIncomingFiles(metadataList);

    // Send via DataChannel or signaling
    if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(
        JSON.stringify({
          type: "metadata",
          files: metadataList,
        })
      );
    } else {
      signalingRef.current?.send({
        type: "transfer:request",
        files: metadataList,
      });
    }
  };

  /**
   * RECEIVER: Approves incoming file transfer
   */
  const handleAcceptFiles = () => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(JSON.stringify({ type: "approval", accepted: true }));
    } else {
      signalingRef.current?.send({ type: "transfer:accepted", accepted: true });
    }
    setState("TRANSFERRING");
  };

  /**
   * SENDER: Executes P2P transmission of file queue
   */
  const beginP2PSending = async () => {
    const channel = dataChannelRef.current;
    if (!channel || cancelRequestedRef.current || fileAckRef.current || useTransferStore.getState().state === "TRANSFERRING") return;
    setState("TRANSFERRING");

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        if (cancelRequestedRef.current) break;
        const file = selectedFiles[i];

        await fileTransferService.sendFile({
          file,
          dataChannel: channel,
          maxMessageSize: webrtcRef.current?.getMaxMessageSize(),
          onProgress: (p) => setProgress(p),
          isCancelled: () => cancelRequestedRef.current,
        });

        if (dataChannelRef.current !== channel || cancelRequestedRef.current) return;
        // Wait for verification before starting the next file.
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            fileAckRef.current = null;
            reject(new Error("Receiver did not confirm the file. Please reconnect."));
          }, 120000);
          fileAckRef.current = {
            resolve: () => { clearTimeout(timeout); fileAckRef.current = null; resolve(); },
            reject: (error) => { clearTimeout(timeout); fileAckRef.current = null; reject(error); },
          };
          try {
            channel.send(JSON.stringify({ type: "file-end", fileName: file.name }));
          } catch (error) {
            fileAckRef.current.reject(error instanceof Error ? error : new Error("Connection closed"));
          }
        });
      }

      if (dataChannelRef.current === channel && !cancelRequestedRef.current) setState("COMPLETED");
    } catch (err: unknown) {
      if (dataChannelRef.current !== channel) return;
      if (cancelRequestedRef.current) {
        setState("CANCELLED");
      } else {
        console.error(err);
        setState("ERROR");
        setErrorMessage(err instanceof Error ? err.message : "P2P transfer interrupted");
      }
    }
  };

  /**
   * RECEIVER: Handles raw chunk and control messages from RTCDataChannel
   */
  const handleDataChannelIncoming = async (data: ArrayBuffer | string, receivedAt: number) => {
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "metadata") {
          setIncomingFiles(parsed.files);
          handleAcceptFiles();
        } else if (parsed.type === "approval") {
          if (parsed.accepted) {
            beginP2PSending();
          } else {
            setState("ERROR");
            setErrorMessage("Receiver declined the transfer");
          }
        } else if (parsed.type === "file-end") {
          await finalizeReceivedFile();
        } else if (parsed.type === "file-received") {
          fileAckRef.current?.resolve();
        }
      } catch (error) {
        throw error instanceof Error ? error : new Error("Could not process transfer message");
      }
      return;
    }

    if (data instanceof ArrayBuffer) {
      if (useTransferStore.getState().state !== "TRANSFERRING") return;
      const targetFile = useTransferStore.getState().incomingFiles[currentReceivingFileIndexRef.current];
      if (!targetFile || data.byteLength < 4) throw new Error("Unexpected file data");
      const stats = receiveStatsRef.current;
      const chunkIndex = new DataView(data).getUint32(0, false);
      if (chunkIndex !== stats.chunks) throw new Error("File chunks arrived out of order");
      const chunkBytes = data.slice(4);
      stats.bytes += chunkBytes.byteLength;
      stats.chunks++;
      if (stats.bytes > targetFile.size) throw new Error("Received more data than expected");
      incomingChunksRef.current.push(chunkBytes);
      const now = receivedAt;
      if (!stats.reportedAt) stats.reportedAt = now;
      if (now - stats.reportedAt >= 200 || stats.bytes === targetFile.size) {
        const elapsed = (now - stats.reportedAt) / 1000;
        const speed = elapsed > 0 ? (stats.bytes - stats.reportedBytes) / elapsed : 0;
        setProgress({
          fileId: targetFile.id, fileName: targetFile.name,
          bytesTransferred: stats.bytes, totalBytes: targetFile.size,
          percentage: targetFile.size ? Math.min(100, Math.round(stats.bytes / targetFile.size * 100)) : 100,
          speedBytesPerSec: speed,
          etaSeconds: speed ? Math.ceil((targetFile.size - stats.bytes) / speed) : 0,
        });
        stats.reportedAt = now;
        stats.reportedBytes = stats.bytes;
      }
    }
  };

  /**
   * RECEIVER: Checks length, verifies an optional checksum, and starts the download
   */
  const finalizeReceivedFile = async () => {
    const operation = operationRef.current;
    if (!operation || operation.signal.aborted) return;
    setState("VERIFYING");
    const targetFile = useTransferStore.getState().incomingFiles[currentReceivingFileIndexRef.current];
    if (!targetFile) throw new Error("Missing file metadata");
    if (receiveStatsRef.current.bytes !== targetFile.size) throw new Error("File is incomplete");
    const fullBlob = new Blob(incomingChunksRef.current, { type: targetFile.type });
    if (targetFile.checksum) {
      const hash = await crypto.subtle.digest("SHA-256", await fullBlob.arrayBuffer());
      const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (hashHex !== targetFile.checksum) throw new Error("File checksum mismatch");
    }

    if (operation.signal.aborted) return;
    // Trigger download
    fileTransferService.downloadBlob(fullBlob, targetFile.name);
    toast.success(`Download ready: ${targetFile.name}`);

    // Reset buffer for next file
    incomingChunksRef.current = [];
    receiveStatsRef.current = { bytes: 0, chunks: 0, reportedBytes: 0, reportedAt: 0 };
    currentReceivingFileIndexRef.current++;
    dataChannelRef.current?.send(JSON.stringify({ type: "file-received", fileId: targetFile.id }));

    if (currentReceivingFileIndexRef.current >= useTransferStore.getState().incomingFiles.length) {
      setState("COMPLETED");
      signalingRef.current?.send({
        type: "transfer:completed",
        fileId: targetFile.id,
        checksumVerified: Boolean(targetFile.checksum),
      });
    } else {
      setState("TRANSFERRING");
    }
  };

  /**
   * SENDER: Triggers Cloudflare R2 encrypted upload fallback
   */
  const handleProceedWithCloud = async () => {
    const operation = operationRef.current;
    if (!session || selectedFiles.length === 0 || !operation || operation.signal.aborted) return;
    setState("ENCRYPTING");
    setConnectionMode("CLOUD");

    try {
      const fileToUpload = selectedFiles[0]; // Primary file for cloud fallback
      setState("UPLOADING");
      toast.info("Preparing cloud upload");

      const uploadResult = await cloudFallbackService.uploadEncryptedFile({
        file: fileToUpload,
        roomId: session.roomId,
        secret: session.secret,
        signal: operation.signal,
        onProgress: (p) => { if (!operation.signal.aborted) setProgress(p); },
      });

      operation.signal.throwIfAborted();
      // Send cloud offer to receiver via signaling
      signalingRef.current?.send({
        type: "cloud:offer",
        files: [uploadResult.metadata],
        downloadUrl: uploadResult.downloadUrl,
        objectKey: uploadResult.objectKey,
        encryptionKeyJwk: uploadResult.encryptionKeyJwk,
        ivHex: uploadResult.ivHex,
      });

      setState("VERIFYING");
      toast.info("Uploaded. Waiting for the receiver.");
    } catch (err: unknown) {
      if (operation.signal.aborted) return;
      console.error(err);
      setState("ERROR");
      setErrorMessage(err instanceof Error ? err.message : "Cloud upload failed");
    }
  };

  /**
   * RECEIVER: Downloads, decrypts client-side, verifies SHA-256 and saves
   */
  const handleCloudDownload = async (msg: Extract<SignalMessage, { type: "cloud:offer" }>) => {
    const operation = operationRef.current;
    if (!session || !msg.encryptionKeyJwk || !msg.ivHex || !operation || operation.signal.aborted) return;
    setState("DOWNLOADING");
    setConnectionMode("CLOUD");

    try {
      toast.info("Downloading encrypted file...");
      await cloudFallbackService.downloadAndDecryptFile({
        metadata: msg.files[0],
        downloadUrl: msg.downloadUrl,
        encryptionKeyJwk: msg.encryptionKeyJwk,
        ivHex: msg.ivHex,
        roomId: session.roomId,
        secret: session.secret,
        objectKey: msg.objectKey,
        signal: operation.signal,
        onProgress: (p) => { if (!operation.signal.aborted) setProgress(p); },
      });

      operation.signal.throwIfAborted();
      await signalingRef.current?.send({
        type: "transfer:completed", fileId: msg.files[0].id, checksumVerified: true,
      });
      operation.signal.throwIfAborted();
      setState("COMPLETED");
      toast.success("Download ready");
    } catch (err: unknown) {
      if (operation.signal.aborted) return;
      console.error(err);
      setState("ERROR");
      setErrorMessage(err instanceof Error ? err.message : "Cloud download or decryption failed");
    }
  };

  const stopTransfer = () => {
    cleanupConnections();
    setState("CANCELLED");
    setProgress(null);
  };

  const handleCancel = () => {
    const signaling = signalingRef.current;
    // Notify immediately over the data channel; persist cancellation independently.
    try {
      if (dataChannelRef.current?.readyState === "open") {
        dataChannelRef.current.send(JSON.stringify({ type: "transfer:cancel" }));
      }
    } catch { /* Server cancellation covers a failed data channel. */ }
    stopTransfer();
    void signaling?.cancel().catch(() => {
      toast.error("Stopped locally. Could not confirm cancellation with the server.");
    });
  };

  const handleReset = () => {
    cleanupConnections();
    resetTransfer();
    resetSession();
    setActiveTab("send");
    incomingChunksRef.current = [];
    currentReceivingFileIndexRef.current = 0;
    receiveStatsRef.current = { bytes: 0, chunks: 0, reportedBytes: 0, reportedAt: 0 };
    incomingMessageQueueRef.current = Promise.resolve();
  };

  const autoJoin = useEffectEvent((code: string) => handleJoinWithCode(code));
  const cleanupOnUnmount = useEffectEvent(() => cleanupConnections());
  const joinedCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = searchParams.get("code");
    if (!code || joinedCodeRef.current === code) return;
    // Defer external session creation until mount survives Strict Mode cleanup.
    const timer = setTimeout(() => {
      joinedCodeRef.current = code;
      void autoJoin(code);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams]);
  useEffect(() => () => cleanupOnUnmount(), []);

  useEffect(() => {
    if (state !== "NEGOTIATING") return;
    // This also covers failure to deliver the very first signaling message.
    const timer = setTimeout(() => {
      if (cancelRequestedRef.current) return;
      setErrorMessage("The devices did not finish connecting. Check their internet connections and try again.");
      setState("CLOUD_OFFERED");
    }, 60000);
    return () => clearTimeout(timer);
  }, [state, setErrorMessage, setState]);

  useEffect(() => {
    handlersRef.current = {
      sender: handleSenderSignalMessage,
      receiver: handleReceiverSignalMessage,
      data: handleDataChannelIncoming,
      sendFiles: sendTransferRequest,
    };
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA]">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center sm:text-left">
            <h1 className="text-3xl font-semibold tracking-tight">
              {transferMode === "network"
                ? "Send files between devices."
                : "Air-Gapped Optical Transfer."}
            </h1>
            <p className="mt-2 text-sm text-[#52525B]">
              {transferMode === "network"
                ? "Direct peer-to-peer over local network or secure cloud relay."
                : "Transmit files 100% offline using animated QR codes and camera."}
            </p>
          </div>

          {/* Top-Level Transfer Mode Switcher */}
          <div className="flex items-center justify-center mb-6">
            <div className="inline-flex bg-[#F4F4F5] p-1 rounded-xl border border-[#E4E4E7] shadow-xs">
              <button
                type="button"
                onClick={() => setTransferMode("network")}
                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  transferMode === "network"
                    ? "bg-white text-[#18181B] shadow-xs"
                    : "text-[#71717A] hover:text-[#18181B]"
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-[#2563EB]" />
                <span>Direct Network (P2P & Cloud)</span>
                {state !== "IDLE" && (
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setTransferMode("optical")}
                className={`flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  transferMode === "optical"
                    ? "bg-white text-[#18181B] shadow-xs"
                    : "text-[#71717A] hover:text-[#18181B]"
                }`}
              >
                <QrCode className="w-3.5 h-3.5 text-emerald-600" />
                <span>Air-Gapped (QR)</span>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-medium px-1.5 py-0.5 rounded-full">
                  Offline
                </span>
              </button>
            </div>
          </div>

          {transferMode === "optical" ? (
            <OpticalDashboard />
          ) : (
            /* Main Network Card */
            <div className="warm-card p-6 sm:p-8">
            {/* IDLE state: Mode Selector (Send vs Receive) */}
            {state === "IDLE" && (
              <div className="flex flex-col gap-6">
                {/* Tabs */}
                <div className="flex p-1 rounded-lg bg-[#F4F4F5] border border-[#E4E4E7]">
                  <button
                    onClick={() => setActiveTab("send")}
                    className={`flex-1 py-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                      activeTab === "send"
                        ? "bg-white text-[#18181B] "
                        : "text-[#52525B] hover:text-[#18181B]"
                    }`}
                  >
                    <Send className="w-4 h-4 text-[#1D4ED8]" />
                    <span>Send Files</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("receive")}
                    className={`flex-1 py-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                      activeTab === "receive"
                        ? "bg-white text-[#18181B] "
                        : "text-[#52525B] hover:text-[#18181B]"
                    }`}
                  >
                    <ArrowDownToLine className="w-4 h-4 text-[#2E7D4F]" />
                    <span>Receive Files</span>
                  </button>
                </div>

                {/* Tab: Send */}
                {activeTab === "send" && (
                  <FilePicker onStartSharing={handleStartSharing} />
                )}

                {/* Tab: Receive */}
                {activeTab === "receive" && (
                  <div className="flex flex-col items-center gap-6 py-4 text-center">
                    <div className="w-14 h-14 rounded-lg bg-[#EAF6EE] text-[#2E7D4F] flex items-center justify-center ">
                      <ArrowDownToLine className="w-7 h-7" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-[#18181B] tracking-tight">Receive Files</h2>
                      <p className="text-xs text-[#52525B] mt-1 max-w-sm">
                        Enter the code from the sending device.
                      </p>
                    </div>

                    <div className="w-full max-w-xs flex flex-col gap-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        aria-label="Six digit connection code"
                        autoComplete="off"
                        placeholder="000000"
                        value={codeInputValue}
                        onChange={(e) => setCodeInputValue(e.target.value.replace(/\D/g, ""))}
                        className="room-code-badge text-center text-2xl font-bold py-3 px-4 rounded-lg border border-[#D4D4D8] bg-white text-[#18181B] focus:outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/10 placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-[#71717A]"
                      />

                      <button
                        onClick={() => handleJoinWithCode()}
                        disabled={isJoining || codeInputValue.length < 6}
                        className="w-full py-3.5 px-4 rounded-lg btn-primary font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isJoining ? <span>Connecting...</span> : <span>Connect</span>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PAIRING state (Sender displays QR code and room code) */}
            {state === "PAIRING" && session && (
              <PairingQRCode
                roomId={session.roomId}
                code={session.code}
                expiresAt={session.expiresAt}
              />
            )}

            {/* NEGOTIATING state */}
            {state === "NEGOTIATING" && (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="w-12 h-12 rounded-full border-3 border-[#1D4ED8] border-t-transparent animate-spin" />
                <div>
                  <h3 className="font-bold text-base text-[#18181B]">Connecting devices</h3>
                  <p className="text-xs text-[#52525B] mt-1">
                    Keep WebSend open on both devices.
                  </p>
                </div>
              </div>
            )}

            {/* P2P_CONNECTED / TRANSFERRING state */}
            {(state === "P2P_CONNECTED" ||
              state === "TRANSFERRING" ||
              state === "VERIFYING" ||
              state === "ENCRYPTING" ||
              state === "UPLOADING" ||
              state === "DOWNLOADING") && (
              <TransferDashboard
                progress={progress}
                connectionMode={connectionMode}
                peerDevice={peerDevice}
                currentFileName={selectedFiles[0]?.name || incomingFiles[0]?.name}
                onCancel={handleCancel}
              />
            )}

            {/* CLOUD_OFFERED state: Direct ICE timeout, offer Cloudflare R2 AES fallback */}
            {state === "CLOUD_OFFERED" && (
              <CloudFallbackPrompt
                isSender={role === "sender"}
                onAccept={handleProceedWithCloud}
                onCancel={handleCancel}
              />
            )}

            {(state === "PAIRING" || state === "NEGOTIATING") && (
              <button onClick={handleCancel} className="btn-secondary mt-6 w-full rounded-lg px-4 py-3 text-sm">Cancel</button>
            )}

            {/* COMPLETED / CANCELLED / ERROR state */}
            {(state === "COMPLETED" || state === "CANCELLED" || state === "ERROR") && (
              <TransferStatus
                status={state}
                errorMessage={errorMessage}
                onReset={handleReset}
              />
            )}
          </div>
          )}


        </div>
      </main>


    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAFAFA]" />}>
      <MainContent />
    </Suspense>
  );
}
