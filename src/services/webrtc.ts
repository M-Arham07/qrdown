import { STUN_SERVERS, TURN_SERVERS } from "@/lib/constants";
import { ConnectionMode } from "@/types/transfer";
import { SignalMessage } from "@/types/signaling";
import { APP_CONFIG } from "@/lib/constants";

export interface WebRTCOptions {
  isInitiator: boolean;
  iceServers?: RTCIceServer[];
  onSignal: (msg: SignalMessage) => void;
  onDataChannelReady: (channel: RTCDataChannel) => void;
  onDataChannelMessage: (event: MessageEvent) => void;
  onConnectionModeChange: (mode: ConnectionMode) => void;
  onReconnectingChange?: (reconnecting: boolean) => void;
  onConnectionTimeout: () => void;
  onDisconnected: () => void;
}

export class WebRTCEngine {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private options: WebRTCOptions;
  private iceTimeoutTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private recoveryAttempted = false;
  private recovering = false;
  private fallbackOffered = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private routeMonitor: ReturnType<typeof setInterval> | null = null;
  private readingRoute = false;

  constructor(options: WebRTCOptions) {
    this.options = options;
  }

  public init() {
    if (typeof window === "undefined") return;

    // Include both STUN and TURN for maximum connectivity:
    // STUN for direct P2P, TURN relay for symmetric NAT / corporate networks
    this.pc = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? [...STUN_SERVERS, ...TURN_SERVERS],
      iceTransportPolicy: "all", // allow local, server-reflexive and relay candidates
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

    this.pc.onicecandidateerror = (event) => {
      // No credentials are logged. Errors from one server do not fail other routes.
      console.warn("[WebRTC] ICE server unavailable", {
        url: event.url, code: event.errorCode, reason: event.errorText,
      });
    };

    this.pc.onicegatheringstatechange = () => {
      console.log("[WebRTC] ICE gathering state:", this.pc?.iceGatheringState);
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);

      if (state === "checking") {
        if (this.isConnected) this.options.onReconnectingChange?.(true);
        // Start timeout when ICE checking begins — use constant value
        this.startIceTimer(APP_CONFIG.iceTimeoutMs);
      } else if (state === "connected" || state === "completed") {
        // An ICE route alone is not yet a usable file channel.
        if (this.dc?.readyState === "open") {
          this.clearIceTimer();
          this.isConnected = true;
        }
        this.options.onReconnectingChange?.(this.dc?.readyState !== "open");
        this.detectConnectionMode();
      } else if (state === "failed") {
        this.isConnected = false;
        this.options.onReconnectingChange?.(true);
        void this.recoverConnection();
      } else if (state === "disconnected") {
        this.isConnected = false;
        this.options.onReconnectingChange?.(true);
        this.startIceTimer(8000);
      } else if (state === "closed") {
        this.options.onDisconnected();
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.connectionState;
      console.log("[WebRTC] Peer connection state:", state);
      if (state === "connected" && this.dc?.readyState === "open") {
        this.clearIceTimer();
        this.isConnected = true;
      } else if (state === "failed") {
        this.isConnected = false;
        void this.recoverConnection();
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
    // Cover missing offers/answers as well as ICE and data-channel negotiation.
    this.startIceTimer(APP_CONFIG.iceTimeoutMs + (this.options.isInitiator ? 0 : 5000));
  }

  public async startNegotiation(iceRestart = false) {
    if (!this.pc || !this.options.isInitiator) return;
    try {
      console.log("[WebRTC] Creating SDP offer");
      const offer = await this.pc.createOffer({ iceRestart });
      this.startIceTimer(APP_CONFIG.iceTimeoutMs);
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
    // Suppress retransmitted offers, but accept new SDP for ICE restarts.
    if (this.pc.remoteDescription?.sdp === sdp.sdp) {
      console.warn("[WebRTC] Ignoring duplicate offer (already stable)");
      return;
    }
    try {
      console.log("[WebRTC] Handling remote offer");
      this.fallbackOffered = false;
      this.startIceTimer(APP_CONFIG.iceTimeoutMs + 5000);
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
    if (!this.pc.remoteDescription || !this.pc.remoteDescription.type ||
        (candidateInit.usernameFragment &&
          !this.pc.remoteDescription.sdp.includes(`a=ice-ufrag:${candidateInit.usernameFragment}`))) {
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

  public getMaxMessageSize(): number {
    return this.pc?.sctp?.maxMessageSize ?? 64 * 1024;
  }

  public getStats(): Promise<RTCStatsReport> | null {
    return this.pc ? this.pc.getStats() : null;
  }

  public close() {
    this.clearIceTimer();
    if (this.routeMonitor) clearInterval(this.routeMonitor);
    this.routeMonitor = null;
    this.isConnected = false;
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
      void this.detectConnectionMode();
      // Stats can settle after channel opening; also track route switches.
      if (!this.routeMonitor) {
        this.routeMonitor = setInterval(() => void this.detectConnectionMode(), 2000);
      }
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
      this.options.onReconnectingChange?.(true);
      this.options.onDisconnected();
      void this.recoverConnection();
    };
  }

  private startIceTimer(timeoutMs: number) {
    this.clearIceTimer();
    if (!this.pc) return;
    this.iceTimeoutTimer = setTimeout(() => {
      this.iceTimeoutTimer = null;
      if (!this.isConnected) {
        console.warn(`[WebRTC] ICE timeout after ${timeoutMs / 1000}s — checking recovery`);
        void this.recoverConnection();
      }
    }, timeoutMs);
  }

  private async recoverConnection() {
    if (!this.pc || this.pc.signalingState === "closed" || this.fallbackOffered || this.recovering) return;
    // ICE and peer-connection failure events can describe the same failure.
    // Give the active restart its full deadline before falling back.
    if (this.recoveryAttempted && this.iceTimeoutTimer) return;
    this.clearIceTimer();
    if (!this.recoveryAttempted) {
      this.recoveryAttempted = true;
      this.recovering = true;
      this.isConnected = false;
      this.options.onReconnectingChange?.(true);
      // Only the sender offers; the receiver waits for the restart offer.
      if (this.options.isInitiator && this.pc.signalingState === "stable") {
        await this.startNegotiation(true);
      }
      this.startIceTimer(APP_CONFIG.iceTimeoutMs + (this.options.isInitiator ? 0 : 5000));
      this.recovering = false;
      return;
    }
    this.fallbackOffered = true;
    console.warn("[WebRTC] Connection and recovery failed", {
      iceState: this.pc.iceConnectionState,
      signalingState: this.pc.signalingState,
      hasRelay: (this.options.iceServers ?? TURN_SERVERS).some(server =>
        [server.urls].flat().some(url => /^turns?:/.test(url))),
    });
    this.options.onConnectionTimeout();
  }

  private clearIceTimer() {
    if (this.iceTimeoutTimer) {
      clearTimeout(this.iceTimeoutTimer);
      this.iceTimeoutTimer = null;
    }
  }

  private async detectConnectionMode() {
    const pc = this.pc;
    if (!pc || this.readingRoute) return;
    this.readingRoute = true;
    try {
      const stats = await pc.getStats();
      if (this.pc !== pc) return;
      // A successful connectivity check does not mean the pair carries traffic.
      // Follow the transport's selectedCandidatePairId instead.
      let selected: RTCIceCandidatePairStats | undefined;
      stats.forEach((report) => {
        if (report.type === "transport" && report.selectedCandidatePairId) {
          selected = stats.get(report.selectedCandidatePairId);
        }
      });
      if (!selected) {
        // Older browsers may expose only the nonstandard selected flag or a
        // single nominated pair. Never guess between multiple successful pairs.
        const nominated: RTCIceCandidatePairStats[] = [];
        stats.forEach((report) => {
          if (report.type !== "candidate-pair" || report.state !== "succeeded") return;
          if (report.selected === true) selected = report;
          if (report.nominated) nominated.push(report);
        });
        if (!selected && nominated.length === 1) selected = nominated[0];
      }
      if (!selected) return;
      const local = stats.get(selected.localCandidateId);
      const remote = stats.get(selected.remoteCandidateId);
      if (!local?.candidateType || !remote?.candidateType) return;
      const mode: ConnectionMode = local.candidateType === "relay" || remote.candidateType === "relay"
        ? "TURN_RELAY"
        : local.candidateType === "host" && remote.candidateType === "host"
          ? "LOCAL_P2P"
          : "INTERNET_P2P";

      // Log candidate types and latency, without IP addresses or credentials.
      console.debug("[WebRTC] Selected file route", {
        mode,
        localType: local.candidateType,
        remoteType: remote.candidateType,
        protocol: local.protocol,
        relayProtocol: local.relayProtocol,
        roundTripTimeMs: selected.currentRoundTripTime === undefined
          ? undefined : Math.round(selected.currentRoundTripTime * 1000),
      });
      this.options.onConnectionModeChange(mode);
    } catch {
      // Preserve the last known route if statistics are temporarily unavailable.
    } finally {
      this.readingRoute = false;
    }
  }
}
