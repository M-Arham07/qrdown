"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import { FilePicker } from "@/components/FilePicker";
import { PairingQRCode } from "@/components/PairingQRCode";
import { DeviceApproval } from "@/components/DeviceApproval";
import { FileApproval } from "@/components/FileApproval";
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
import { ArrowDownToLine, Send, ShieldCheck, Zap, Lock, Smartphone } from "lucide-react";
import { toast } from "sonner";

function MainContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"send" | "receive">("send");
  const [codeInputValue, setCodeInputValue] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const {
    state,
    connectionMode,
    selectedFiles,
    incomingFiles,
    progress,
    errorMessage,
    cloudOfferPayload,
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

  // Buffer state for receiving files
  const incomingChunksRef = useRef<ArrayBuffer[]>([]);
  const currentReceivingFileIndexRef = useRef(0);

  // Screen WakeLock active when transferring
  useWakeLock(state === "TRANSFERRING" || state === "UPLOADING" || state === "DOWNLOADING");

  // Check URL query parameters for auto-join (e.g. from scanned QR code)
  useEffect(() => {
    const codeFromUrl = searchParams.get("code");
    if (codeFromUrl) {
      setActiveTab("receive");
      setCodeInputValue(codeFromUrl);
      handleJoinWithCode(codeFromUrl);
    }
  }, [searchParams]);

  // Clean up WebRTC and signaling on unmount
  useEffect(() => {
    return () => {
      cleanupConnections();
    };
  }, []);

  const cleanupConnections = () => {
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

    try {
      setState("PAIRING");
      setRole("sender");

      const res = await fetch("/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: myDevice }),
      });

      if (!res.ok) {
        throw new Error("Failed to create pairing session");
      }

      const sessionData = await res.json();
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

      signaling.subscribe((msg) => handleSenderSignalMessage(msg));
      signaling.start();
    } catch (err) {
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

    try {
      setIsJoining(true);
      setRole("receiver");

      const res = await fetch("/api/sessions/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToUse, device: myDevice }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Room code not found");
      }

      const { roomId, secret, session: roomSession } = await res.json();
      setSession(roomSession);
      setPeerDevice(roomSession.sender || null);

      setState("NEGOTIATING");
      toast.info("Connecting to sender...");

      // Start signaling client and await sender's approval
      const signaling = new SignalingClient(roomId, secret, "receiver");
      signalingRef.current = signaling;

      signaling.subscribe((msg) => handleReceiverSignalMessage(msg));
      signaling.start();
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setIsJoining(false);
    }
  };

  /**
   * Setup WebRTC Engine (sender or receiver)
   */
  const setupWebRTC = (isInitiator: boolean) => {
    if (webrtcRef.current) {
      webrtcRef.current.close();
    }

    const webrtc = new WebRTCEngine({
      isInitiator,
      onSignal: (msg) => {
        signalingRef.current?.send(msg);
      },
      onDataChannelReady: (channel) => {
        dataChannelRef.current = channel;
        setState("P2P_CONNECTED");
        toast.success("Direct peer-to-peer connection established!");

        // If sender, now send file transfer request
        if (isInitiator) {
          sendTransferRequest();
        }
      },
      onDataChannelMessage: (event) => {
        handleDataChannelIncoming(event.data);
      },
      onConnectionModeChange: (mode) => {
        setConnectionMode(mode);
      },
      onConnectionTimeout: () => {
        // 12-second ICE timeout
        setState("CLOUD_OFFERED");
      },
      onDisconnected: () => {
        if (state === "TRANSFERRING") {
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
    switch (msg.type) {
      case "peer:join":
        setPeerDevice(msg.device);
        setState("WAITING_APPROVAL");
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
        toast.success("All files delivered successfully!");
        break;
    }
  };

  /**
   * RECEIVER: Signal routing
   */
  const handleReceiverSignalMessage = async (msg: SignalMessage) => {
    switch (msg.type) {
      case "peer:approved":
        if (msg.approved) {
          setupWebRTC(false);
        } else {
          setState("ERROR");
          setErrorMessage("Sender declined the pairing request.");
          toast.error("Connection rejected by sender");
        }
        break;

      case "signal:offer":
        if (!webrtcRef.current) {
          setupWebRTC(false);
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
        setState("WAITING_APPROVAL");
        break;

      case "cloud:offer":
        setCloudOfferPayload({
          files: msg.files,
          downloadUrl: msg.downloadUrl,
          encryptionKeyJwk: msg.encryptionKeyJwk,
          ivHex: msg.ivHex,
        });
        setState("DOWNLOADING");
        handleCloudDownload(msg);
        break;
    }
  };

  /**
   * SENDER: Approves receiver device and starts WebRTC offer
   */
  const handleApproveDevice = async () => {
    if (!session) return;
    setState("NEGOTIATING");
    setupWebRTC(true);

    signalingRef.current?.send({
      type: "peer:approved",
      approved: true,
    });

    // Start negotiation (creates and sends offer)
    setTimeout(() => {
      webrtcRef.current?.startNegotiation();
    }, 150);
  };

  const handleRejectDevice = () => {
    signalingRef.current?.send({
      type: "peer:approved",
      approved: false,
    });
    setState("PAIRING");
    toast.info("Pairing request declined");
  };

  /**
   * SENDER: Sends transfer request with file metadata to receiver
   */
  const sendTransferRequest = async () => {
    const metadataList: FileMetadata[] = [];
    for (const file of selectedFiles) {
      const meta = await fileTransferService.prepareFileMetadata(file);
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

  const handleDeclineFiles = () => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(JSON.stringify({ type: "approval", accepted: false }));
    } else {
      signalingRef.current?.send({ type: "transfer:accepted", accepted: false });
    }
    setState("CANCELLED");
  };

  /**
   * SENDER: Executes P2P transmission of file queue
   */
  const beginP2PSending = async () => {
    if (!dataChannelRef.current) return;
    setState("TRANSFERRING");
    cancelRequestedRef.current = false;

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        if (cancelRequestedRef.current) break;
        const file = selectedFiles[i];

        await fileTransferService.sendFile({
          file,
          dataChannel: dataChannelRef.current,
          onProgress: (p) => setProgress(p),
          isCancelled: () => cancelRequestedRef.current,
        });

        // Notify file completion
        dataChannelRef.current.send(JSON.stringify({ type: "file-end", fileName: file.name }));
      }

      setState("VERIFYING");
    } catch (err: unknown) {
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
  const handleDataChannelIncoming = async (data: ArrayBuffer | string) => {
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === "metadata") {
          setIncomingFiles(parsed.files);
          setState("WAITING_APPROVAL");
        } else if (parsed.type === "approval") {
          if (parsed.accepted) {
            beginP2PSending();
          } else {
            setState("ERROR");
            setErrorMessage("Receiver declined the transfer");
          }
        } else if (parsed.type === "file-end") {
          finalizeReceivedFile();
        }
      } catch (e) {
        console.error("JSON parse error:", e);
      }
      return;
    }

    // Binary chunk data
    if (data instanceof ArrayBuffer) {
      // First 4 bytes are chunk index
      const chunkBytes = data.slice(4);
      incomingChunksRef.current.push(chunkBytes);

      const targetFile = incomingFiles[currentReceivingFileIndexRef.current];
      if (targetFile) {
        const receivedBytes = incomingChunksRef.current.reduce((acc, c) => acc + c.byteLength, 0);
        const percentage = Math.min(100, Math.round((receivedBytes / targetFile.size) * 100));

        setProgress({
          fileId: targetFile.name,
          fileName: targetFile.name,
          bytesTransferred: receivedBytes,
          totalBytes: targetFile.size,
          percentage,
          speedBytesPerSec: 0,
          etaSeconds: 0,
        });
      }
    }
  };

  /**
   * RECEIVER: Verifies SHA-256 and saves received file
   */
  const finalizeReceivedFile = async () => {
    setState("VERIFYING");
    const targetFile = incomingFiles[currentReceivingFileIndexRef.current];
    if (!targetFile) return;

    const fullBlob = new Blob(incomingChunksRef.current, { type: targetFile.type });
    const fullBuffer = await fullBlob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", fullBuffer);
    const hashHex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (targetFile.checksum && hashHex !== targetFile.checksum) {
      setState("ERROR");
      setErrorMessage("File checksum mismatch: data was corrupted.");
      toast.error("Integrity check failed");
      return;
    }

    // Trigger download
    fileTransferService.downloadBlob(fullBlob, targetFile.name);
    toast.success(`Saved "${targetFile.name}" to Downloads`);

    // Reset buffer for next file
    incomingChunksRef.current = [];
    currentReceivingFileIndexRef.current++;

    if (currentReceivingFileIndexRef.current >= incomingFiles.length) {
      setState("COMPLETED");
      signalingRef.current?.send({
        type: "transfer:completed",
        fileId: targetFile.id,
        checksumVerified: true,
      });
    } else {
      setState("TRANSFERRING");
    }
  };

  /**
   * SENDER: Triggers Cloudflare R2 encrypted upload fallback
   */
  const handleProceedWithCloud = async () => {
    if (!session || selectedFiles.length === 0) return;
    setState("ENCRYPTING");
    setConnectionMode("CLOUD");

    try {
      const fileToUpload = selectedFiles[0]; // Primary file for cloud fallback
      setState("UPLOADING");
      toast.info("Encrypting file client-side with AES-256-GCM...");

      const uploadResult = await cloudFallbackService.uploadEncryptedFile({
        file: fileToUpload,
        roomId: session.roomId,
        secret: session.secret,
        onProgress: (p) => setProgress(p),
      });

      // Send cloud offer to receiver via signaling
      signalingRef.current?.send({
        type: "cloud:offer",
        files: [uploadResult.metadata],
        downloadUrl: uploadResult.downloadUrl,
        encryptionKeyJwk: uploadResult.encryptionKeyJwk,
        ivHex: uploadResult.ivHex,
      });

      setState("COMPLETED");
      toast.success("File uploaded! Receiver is now downloading.");
    } catch (err: unknown) {
      console.error(err);
      setState("ERROR");
      setErrorMessage(err instanceof Error ? err.message : "Cloud upload failed");
    }
  };

  /**
   * RECEIVER: Downloads, decrypts client-side, verifies SHA-256 and saves
   */
  const handleCloudDownload = async (msg: Extract<SignalMessage, { type: "cloud:offer" }>) => {
    if (!session || !msg.encryptionKeyJwk || !msg.ivHex) return;
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
        objectKey: msg.downloadUrl,
        onProgress: (p) => setProgress(p),
      });

      setState("COMPLETED");
      toast.success("File downloaded and decrypted successfully!");
    } catch (err: unknown) {
      console.error(err);
      setState("ERROR");
      setErrorMessage(err instanceof Error ? err.message : "Cloud download or decryption failed");
    }
  };

  const handleCancel = () => {
    cancelRequestedRef.current = true;
    cleanupConnections();
    setState("CANCELLED");
    toast.info("Transfer cancelled");
  };

  const handleReset = () => {
    cleanupConnections();
    resetTransfer();
    resetSession();
    setActiveTab("send");
    incomingChunksRef.current = [];
    currentReceivingFileIndexRef.current = 0;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FDFBF7]">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-xl">
          {/* Main Card */}
          <div className="warm-card p-6 sm:p-8">
            {/* IDLE state: Mode Selector (Send vs Receive) */}
            {state === "IDLE" && (
              <div className="flex flex-col gap-6">
                {/* Tabs */}
                <div className="flex p-1 rounded-xl bg-[#F8F3EA] border border-[#EDE2D3]">
                  <button
                    onClick={() => setActiveTab("send")}
                    className={`flex-1 py-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      activeTab === "send"
                        ? "bg-white text-[#2C1A11] shadow-sm"
                        : "text-[#6B5244] hover:text-[#2C1A11]"
                    }`}
                  >
                    <Send className="w-4 h-4 text-[#C45F2C]" />
                    <span>Send Files</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("receive")}
                    className={`flex-1 py-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      activeTab === "receive"
                        ? "bg-white text-[#2C1A11] shadow-sm"
                        : "text-[#6B5244] hover:text-[#2C1A11]"
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
                    <div className="w-14 h-14 rounded-2xl bg-[#EAF6EE] text-[#2E7D4F] flex items-center justify-center shadow-sm">
                      <ArrowDownToLine className="w-7 h-7" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-[#2C1A11] tracking-tight">Receive Files</h2>
                      <p className="text-xs text-[#6B5244] mt-1 max-w-sm">
                        Enter the 6-digit room code shown on the sender&apos;s screen to start receiving.
                      </p>
                    </div>

                    <div className="w-full max-w-xs flex flex-col gap-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder="e.g. 849201"
                        value={codeInputValue}
                        onChange={(e) => setCodeInputValue(e.target.value.replace(/\D/g, ""))}
                        className="room-code-badge text-center text-2xl font-bold py-3 px-4 rounded-xl border border-[#DFD0BE] bg-white text-[#2C1A11] focus:outline-none focus:border-[#C45F2C] focus:ring-2 focus:ring-[#C45F2C]/10 placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:text-[#9C8373]"
                      />

                      <button
                        onClick={() => handleJoinWithCode()}
                        disabled={isJoining || codeInputValue.length < 6}
                        className="w-full py-3.5 px-4 rounded-xl btn-primary font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {isJoining ? <span>Connecting...</span> : <span>Connect & Receive</span>}
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
                <div className="w-12 h-12 rounded-full border-3 border-[#C45F2C] border-t-transparent animate-spin" />
                <div>
                  <h3 className="font-bold text-base text-[#2C1A11]">Establishing Connection</h3>
                  <p className="text-xs text-[#6B5244] mt-1">
                    Exchanging ICE candidates and testing direct peer-to-peer route...
                  </p>
                </div>
              </div>
            )}

            {/* WAITING_APPROVAL state: Sender approves device OR Receiver approves files */}
            {state === "WAITING_APPROVAL" && (
              <>
                {role === "sender" && peerDevice && (
                  <DeviceApproval
                    device={peerDevice}
                    onApprove={handleApproveDevice}
                    onReject={handleRejectDevice}
                  />
                )}
                {role === "receiver" && (
                  <FileApproval
                    senderDevice={peerDevice}
                    files={incomingFiles}
                    onAccept={handleAcceptFiles}
                    onDecline={handleDeclineFiles}
                  />
                )}
              </>
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
                onAccept={handleProceedWithCloud}
                onCancel={handleCancel}
              />
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

          {/* Value props & badges footer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8">
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white border border-[#EDE2D3] shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-[#FBECE3] text-[#C45F2C] flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <div className="font-bold text-[#2C1A11]">Direct Speed</div>
                <div className="text-[#6B5244]">Full LAN & Wi-Fi bandwidth</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white border border-[#EDE2D3] shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-[#EAF6EE] text-[#2E7D4F] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <div className="font-bold text-[#2C1A11]">100% Private</div>
                <div className="text-[#6B5244]">Files never touch any server</div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white border border-[#EDE2D3] shadow-sm">
              <div className="w-8 h-8 rounded-lg bg-[#EAF2FA] text-[#2B72A8] flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <div className="font-bold text-[#2C1A11]">Zero Installs</div>
                <div className="text-[#6B5244]">Works on iOS, Android, PC & Mac</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full border-t border-[#EDE2D3] py-5 text-center text-xs text-[#9C8373] bg-[#FDFBF7]">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>WebSend · Browser-based P2P File Transfer</span>
          <span className="flex items-center gap-1.5">
            <span>Built with WebRTC &amp; Web Crypto</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FDFBF7]" />}>
      <MainContent />
    </Suspense>
  );
}
