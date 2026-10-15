import { STUN_SERVERS, APP_CONFIG } from "@/lib/constants";
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

  constructor(options: WebRTCOptions) {
    this.options = options;
  }

  public init() {
    if (typeof window === "undefined") return;

    this.pc = new RTCPeerConnection({
      iceServers: STUN_SERVERS,
      iceCandidatePoolSize: 10,
    });

    // Start 12-second connection timeout guard
    this.startIceTimer();

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.onSignal({
          type: "signal:ice",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;

      if (state === "connected" || state === "completed") {
        this.clearIceTimer();
        this.isConnected = true;
        this.detectConnectionMode();
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        this.options.onDisconnected();
      }
    };

    if (this.options.isInitiator) {
      // Sender creates the DataChannel
      this.dc = this.pc.createDataChannel("file-transfer", {
        ordered: true,
      });
      this.setupDataChannel(this.dc);
    } else {
      // Receiver waits for DataChannel
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.setupDataChannel(this.dc);
      };
    }
  }

  public async startNegotiation() {
    if (!this.pc || !this.options.isInitiator) return;
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.options.onSignal({
        type: "signal:offer",
        sdp: offer,
      });
    } catch (err) {
      console.error("Failed to create WebRTC offer:", err);
    }
  }

  public async handleOffer(sdp: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.options.onSignal({
        type: "signal:answer",
        sdp: answer,
      });
    } catch (err) {
      console.error("Failed to handle WebRTC offer:", err);
    }
  }

  public async handleAnswer(sdp: RTCSessionDescriptionInit) {
    if (!this.pc) return;
    try {
      if (this.pc.signalingState !== "stable") {
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    } catch (err) {
      console.error("Failed to handle WebRTC answer:", err);
    }
  }

  public async addIceCandidate(candidateInit: RTCIceCandidateInit) {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (err) {
      console.error("Failed to add ICE candidate:", err);
    }
  }

  public getDataChannel(): RTCDataChannel | null {
    return this.dc;
  }

  public close() {
    this.clearIceTimer();
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
    channel.bufferedAmountLowThreshold = APP_CONFIG.bufferThresholdBytes;

    channel.onopen = () => {
      this.clearIceTimer();
      this.options.onDataChannelReady(channel);
    };

    channel.onmessage = (event) => {
      this.options.onDataChannelMessage(event);
    };

    channel.onerror = (error) => {
      console.warn("RTCDataChannel error:", error);
    };

    channel.onclose = () => {
      this.options.onDisconnected();
    };
  }

  private startIceTimer() {
    this.clearIceTimer();
    this.iceTimeoutTimer = setTimeout(() => {
      if (!this.isConnected) {
        console.warn("WebRTC ICE connection timeout after 12 seconds");
        this.options.onConnectionTimeout();
      }
    }, APP_CONFIG.iceTimeoutMs);
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
