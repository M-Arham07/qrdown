import { PeerRole } from "@/types/session";
import { SignalEnvelope, SignalMessage } from "@/types/signaling";

type SignalListener = (msg: SignalMessage, env: SignalEnvelope) => void | Promise<void>;

/**
 * Long-poll signaling client.
 *
 * Poll interval strategy:
 *  - During WebRTC negotiation (ICE candidates flying): 150ms for low-latency
 *  - After DataChannel open / idle: 1000ms to reduce server load
 *
 * The caller can call setFastMode(true/false) to switch modes.
 */
export class SignalingClient {
  private roomId: string;
  private secret: string;
  private role: PeerRole;
  private lastTimestamp = 0;
  private seenSignals = new Set<string>();
  private sendQueue: Promise<void> = Promise.resolve();
  private polling = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private listeners: Set<SignalListener> = new Set();
  private fastMode = true; // start fast for negotiation
  private consecutiveErrors = 0;

  constructor(roomId: string, secret: string, role: PeerRole) {
    this.roomId = roomId;
    this.secret = secret;
    this.role = role;
  }

  public subscribe(listener: SignalListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public start() {
    if (this.polling) return;
    this.polling = true;
    this.consecutiveErrors = 0;
    this.pollLoop();
  }

  public stop() {
    this.polling = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  /**
   * Switch between fast (150ms) and slow (1000ms) poll intervals.
   * Call setFastMode(false) after P2P DataChannel is open to reduce load.
   */
  public setFastMode(fast: boolean) {
    this.fastMode = fast;
  }

  public send(message: SignalMessage): Promise<void> {
    // Preserve approval/offer/candidate order even when HTTP requests vary in latency.
    const request = this.sendQueue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.polling) return;
        try {
          const res = await fetch("/api/sessions/signal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify({ roomId: this.roomId, secret: this.secret,
              fromRole: this.role, message }),
          });
          if (res.ok) return;
          if (res.status < 500) throw new Error(`Signaling rejected (${res.status})`);
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      throw new Error("Signaling unavailable after retries");
    });
    this.sendQueue = request.catch((error) => console.error("[Signaling] Send failed:", error));
    return this.sendQueue;
  }

  public async cancel(): Promise<void> {
    // Cancellation bypasses queued ICE messages and survives stop().
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch("/api/sessions/cancel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(5000), keepalive: true,
          body: JSON.stringify({ roomId: this.roomId, secret: this.secret }),
        });
        if (response.ok) return;
        throw new Error(`Cancellation failed (${response.status})`);
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }

  private async pollLoop() {
    if (!this.polling) return;

    try {
      const res = await fetch(
        `/api/sessions/signal?roomId=${encodeURIComponent(this.roomId)}&secret=${encodeURIComponent(
          this.secret
        )}&role=${this.role}&since=${Math.max(0, this.lastTimestamp - 2000)}`,
        {
          // Abort if the server takes > 5s to respond
          signal: AbortSignal.timeout(5000),
        }
      );

      if (res.ok) {
        this.consecutiveErrors = 0;
        const data = await res.json();
        if (!this.polling) return;
        if (data.session?.status === "closed") {
          const envelope: SignalEnvelope = {
            id: `cancel:${this.roomId}`, roomId: this.roomId,
            fromRole: this.role === "sender" ? "receiver" : "sender",
            timestamp: data.timestamp ?? 0,
            message: { type: "transfer:cancel" },
          };
          for (const listener of this.listeners) await listener(envelope.message, envelope);
          this.stop();
          return;
        }
        if (data.signals && Array.isArray(data.signals)) {
          for (const env of data.signals as SignalEnvelope[]) {
            if (!this.polling) return;
            if (this.seenSignals.has(env.id)) continue;
            this.seenSignals.add(env.id);
            this.lastTimestamp = Math.max(this.lastTimestamp, env.timestamp);
            for (const listener of this.listeners) {
              try {
                await listener(env.message, env);
              } catch (e) {
                console.error("[Signaling] Listener error:", e);
              }
            }
          }
        }
      } else {
        this.consecutiveErrors++;
      }
    } catch {
      // Transient network error or abort — back off slightly
      this.consecutiveErrors++;
    }

    if (!this.polling) return;

    // Adaptive interval: fast during negotiation, slow after connected
    // Back off on repeated errors to avoid hammering the server
    const baseInterval = this.fastMode ? 150 : 1000;
    const errorBackoff = Math.min(this.consecutiveErrors * 200, 3000);
    const interval = baseInterval + errorBackoff;

    this.pollTimeout = setTimeout(() => this.pollLoop(), interval);
  }
}
