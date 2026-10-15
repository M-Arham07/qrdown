import { STUN_SERVERS, TURN_SERVERS } from "@/lib/constants";
import { ConnectionMode } from "@/types/transfer";
import { SignalMessage } from "@/types/signaling";
import { APP_CONFIG } from "@/lib/constants";

export interface WebRTCOptions {
  isInitiator: boolean;
  onSignal: (msg: SignalMessage) => void;
  onDataChannelReady: (channel: RTCDataChannel) => void;
  onDataChannelMessage: (event: MessageEvent) => void;
  onConnectionModeChange: (mode: ConnectionMode) => void;
  onConnectionTimeout: () => void;
  onDisconnected: () => void;
}

export class WebRTCEngine {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private options: WebRTCOptions;
  private iceTimeoutTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(options: WebRTCOptions) {
    this.options = options;
  }

  public init() {
    if (typeof window === "undefined") return;

    // Include both STUN and TURN for maximum connectivity:
    // STUN for direct P2P, TURN relay for symmetric NAT / corporate networks
    this.pc = new RTCPeerConnection({
      iceServers: [...STUN_SERVERS, ...TURN_SERVERS],
      iceTransportPolicy: "all", // allow STUN first, fall back to TURN
      iceCandidatePoolSize: 10,  // pre-gather candidates to speed up connection
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const { type, protocol } = event.candidate;
        console.log("[WebRTC] Local ICE candidate:", type, protocol, event.candidate.address);
        this.options.onSignal({
          type: "signal:ice",
          candidate: event.candidate.toJSON(),
        });
      } else {
        // null candidate = gathering complete
        console.log("[WebRTC] ICE gathering complete");
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log("[WebRTC] ICE gathering state:", this.pc?.iceGatheringState);
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);

      if (state === "checking") {
        // Start timeout when ICE checking begins — use constant value
        this.startIceTimer(APP_CONFIG.iceTimeoutMs);
      } else if (state === "connected" || state === "completed") {
        this.clearIceTimer();
        this.isConnected = true;
        this.detectConnectionMode();
      } else if (state === "failed") {
        console.warn("[WebRTC] ICE connection failed — attempting ICE restart");
        this.clearIceTimer();
        // Try ICE restart before giving up
        if (this.options.isInitiator && this.pc) {
          this.pc.restartIce();
          this.startIceTimer(10000); // 10s extra for restart
        } else {
          this.options.onConnectionTimeout();
        }
      } else if (state === "disconnected") {
        // Transient disconnects can self-heal; give 8s grace period
        console.warn("[WebRTC] ICE disconnected — waiting for reconnect...");
        this.startIceTimer(8000);
      } else if (state === "closed") {
        this.options.onDisconnected();
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.connectionState;
      console.log("[WebRTC] Peer connection state:", state);
      if (state === "connected") {
        this.clearIceTimer();
        this.isConnected = true;
      } else if (state === "failed") {
        this.clearIceTimer();
        this.options.onConnectionTimeout();
      }
    };

    if (this.options.isInitiator) {
      // Sender creates the DataChannel with optimized settings
      console.log("[WebRTC] Initiator creating DataChannel 'file-transfer'");
      this.dc = this.pc.createDataChannel("file-transfer", {
        ordered: true,           // Reliable delivery; use false + maxRetransmits:0 for raw speed (requires reorder)
        maxPacketLifeTime: undefined,
      });
      this.setupDataChannel(this.dc);
    } else {
      // Receiver listens for DataChannel
      this.pc.ondatachannel = (event) => {
        console.log("[WebRTC] Receiver received DataChannel:", event.channel.label);
        this.dc = event.channel;
        this.setupDataChannel(this.dc);
      };
    }
  }

  public async startNegotiation() {
    if (!this.pc || !this.options.isInitiator) return;
    try {
      console.log("[WebRTC] Creating SDP offer");
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.options.onSignal({
        type: "signal:offer",
        sdp: offer,
      });
    } catch (err) {
      console.error("[WebRTC] Failed to create offer:", err);
    }
  }

  public async handleOffer(sdp: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    // Ignore stale offers if already in a stable state with a remote description
    if (this.pc.signalingState === "stable" && this.pc.remoteDescription) {
      console.warn("[WebRTC] Ignoring duplicate offer (already stable)");
      return;
    }
    try {
      console.log("[WebRTC] Handling remote offer");
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log("[WebRTC] Created and sent SDP answer");
      this.options.onSignal({
        type: "signal:answer",
        sdp: answer,
      });
    } catch (err) {
      console.error("[WebRTC] Failed to handle offer:", err);
    }
  }

  public async handleAnswer(sdp: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    // Only set remote answer if we are in have-local-offer state
    if (this.pc.signalingState !== "have-local-offer") {
      console.warn("[WebRTC] Ignoring answer in unexpected signaling state:", this.pc.signalingState);
      return;
    }
    try {
      console.log("[WebRTC] Handling remote answer");
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainPendingCandidates();
    } catch (err) {
      console.error("[WebRTC] Failed to handle answer:", err);
    }
  }

  public async addIceCandidate(candidateInit: RTCIceCandidateInit) {
    if (!this.pc) return;

    // Handle null/empty candidate (signaling end-of-candidates)
    if (!candidateInit.candidate) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch {
        // Some browsers reject null candidates — safe to ignore
      }
      return;
    }

    // Queue candidate if remote description is not set yet
    if (!this.pc.remoteDescription || !this.pc.remoteDescription.type) {
      console.log("[WebRTC] Queueing candidate until remoteDescription is set");
      this.pendingCandidates.push(candidateInit);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      console.log("[WebRTC] Added remote ICE candidate:", candidateInit.candidate?.split(" ")[7]);
    } catch (err) {
      console.warn("[WebRTC] Error adding ICE candidate (may be stale):", err);
    }
  }

  private async drainPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    console.log(`[WebRTC] Draining ${this.pendingCandidates.length} queued ICE candidates`);
    const toProcess = [...this.pendingCandidates];
    this.pendingCandidates = [];
    for (const candidate of toProcess) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("[WebRTC] Failed to add drained candidate:", err);
      }
    }
  }

  public getDataChannel(): RTCDataChannel | null {
    return this.dc;
  }

  public getStats(): Promise<RTCStatsReport> | null {
    return this.pc ? this.pc.getStats() : null;
  }

  public close() {
    this.clearIceTimer();
    this.pendingCandidates = [];
    if (this.dc) {
      try { this.dc.close(); } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
    this.isConnected = false;
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    // 4 MiB backpressure threshold — allows large chunks to queue without
    // blocking the JavaScript event loop
    channel.bufferedAmountLowThreshold = APP_CONFIG.bufferThresholdBytes;

    channel.onopen = () => {
      console.log("[WebRTC] DataChannel OPEN | readyState:", channel.readyState);
      this.clearIceTimer();
      this.isConnected = true;
      // Log the negotiated SCTP max message size for debugging
      try {
        const sctp = (this.pc as RTCPeerConnection & { sctp?: { maxMessageSize: number } }).sctp;
        if (sctp) console.log("[WebRTC] SCTP maxMessageSize:", sctp.maxMessageSize);
      } catch {}
      this.options.onDataChannelReady(channel);
    };

    channel.onmessage = (event) => {
      this.options.onDataChannelMessage(event);
    };

    channel.onerror = (error) => {
      console.warn("[WebRTC] RTCDataChannel error:", error);
    };

    channel.onclose = () => {
      console.log("[WebRTC] RTCDataChannel closed");
      if (this.isConnected) {
        this.options.onDisconnected();
      }
    };
  }

  private startIceTimer(timeoutMs: number) {
    this.clearIceTimer();
    this.iceTimeoutTimer = setTimeout(() => {
      if (!this.isConnected) {
        console.warn(`[WebRTC] ICE timeout after ${timeoutMs / 1000}s — triggering fallback`);
        this.options.onConnectionTimeout();
      }
    }, timeoutMs);
  }

  private clearIceTimer() {
    if (this.iceTimeoutTimer) {
      clearTimeout(this.iceTimeoutTimer);
      this.iceTimeoutTimer = null;
    }
  }

  private async detectConnectionMode() {
    if (!this.pc) return;
    try {
      const stats = await this.pc.getStats();
      let mode: ConnectionMode = "INTERNET_P2P";

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          const local = stats.get(report.localCandidateId);
          const remote = stats.get(report.remoteCandidateId);

          if (local?.candidateType === "host" && remote?.candidateType === "host") {
            mode = "LOCAL_P2P";
          } else if (local?.candidateType === "relay" || remote?.candidateType === "relay") {
            mode = "TURN_RELAY";
          } else {
            mode = "INTERNET_P2P";
          }
        }
      });

      console.log("[WebRTC] Detected connection mode:", mode);
      this.options.onConnectionModeChange(mode);
    } catch {
      this.options.onConnectionModeChange("INTERNET_P2P");
    }
  }
}
