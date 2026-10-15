import { STUN_SERVERS } from "@/lib/constants";
import { ConnectionMode } from "@/types/transfer";
import { SignalMessage } from "@/types/signaling";

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

    this.pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
            "stun:stun.services.mozilla.com",
            "stun:global.stun.twilio.com:3478",
          ],
        },
      ],
      iceCandidatePoolSize: 6,
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[WebRTC] Local ICE candidate gathered:", event.candidate.type, event.candidate.candidate);
        this.options.onSignal({
          type: "signal:ice",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      console.log("[WebRTC] ICE connection state:", state);

      if (state === "checking") {
        // Start timeout only when ICE checking actually begins
        this.startIceTimer(20000); // 20s generous window for NAT traversal
      } else if (state === "connected" || state === "completed") {
        this.clearIceTimer();
        this.isConnected = true;
        this.detectConnectionMode();
      } else if (state === "failed") {
        console.warn("[WebRTC] ICE connection failed");
        this.clearIceTimer();
        this.options.onConnectionTimeout();
      } else if (state === "disconnected" || state === "closed") {
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
      }
    };

    if (this.options.isInitiator) {
      // Sender creates the DataChannel
      console.log("[WebRTC] Initiator creating DataChannel 'file-transfer'");
      this.dc = this.pc.createDataChannel("file-transfer", {
        ordered: true,
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
    try {
      console.log("[WebRTC] Handling remote answer");
      if (this.pc.signalingState !== "stable") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await this.drainPendingCandidates();
      }
    } catch (err) {
      console.error("[WebRTC] Failed to handle answer:", err);
    }
  }

  public async addIceCandidate(candidateInit: RTCIceCandidateInit) {
    if (!this.pc) return;

    // Queue candidate if remote description is not set yet!
    if (!this.pc.remoteDescription || !this.pc.remoteDescription.type) {
      console.log("[WebRTC] Queueing candidate until remoteDescription is set");
      this.pendingCandidates.push(candidateInit);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
      console.log("[WebRTC] Successfully added remote ICE candidate");
    } catch (err) {
      console.error("[WebRTC] Error adding ICE candidate:", err);
    }
  }

  private async drainPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    console.log(`[WebRTC] Draining ${this.pendingCandidates.length} queued ICE candidates`);
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("[WebRTC] Failed to add drained candidate:", err);
        }
      }
    }
  }

  public getDataChannel(): RTCDataChannel | null {
    return this.dc;
  }

  public close() {
    this.clearIceTimer();
    this.pendingCandidates = [];
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    this.isConnected = false;
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;

    channel.onopen = () => {
      console.log("[WebRTC] DataChannel OPEN and ready for transfer");
      this.clearIceTimer();
      this.isConnected = true;
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
      this.options.onDisconnected();
    };
  }

  private startIceTimer(timeoutMs = 20000) {
    this.clearIceTimer();
    this.iceTimeoutTimer = setTimeout(() => {
      if (!this.isConnected) {
        console.warn(`[WebRTC] ICE connection timeout after ${timeoutMs / 1000}s`);
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

      this.options.onConnectionModeChange(mode);
    } catch {
      this.options.onConnectionModeChange("INTERNET_P2P");
    }
  }
}
