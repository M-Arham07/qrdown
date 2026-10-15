import { PeerRole } from "@/types/session";
import { SignalEnvelope, SignalMessage } from "@/types/signaling";

type SignalListener = (msg: SignalMessage, env: SignalEnvelope) => void;

export class SignalingClient {
  private roomId: string;
  private secret: string;
  private role: PeerRole;
  private lastTimestamp = 0;
  private polling = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private listeners: Set<SignalListener> = new Set();

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
    this.pollLoop();
  }

  public stop() {
    this.polling = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  public async send(message: SignalMessage) {
    try {
      const res = await fetch("/api/sessions/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: this.roomId,
          secret: this.secret,
          fromRole: this.role,
          message,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn("Signal send failed:", data);
      }
    } catch (err) {
      console.error("Failed to send signal:", err);
    }
  }

  private async pollLoop() {
    if (!this.polling) return;

    try {
      const res = await fetch(
        `/api/sessions/signal?roomId=${encodeURIComponent(this.roomId)}&secret=${encodeURIComponent(
          this.secret
        )}&role=${this.role}&since=${this.lastTimestamp}`
      );

      if (res.ok) {
        const data = await res.json();
        if (data.signals && Array.isArray(data.signals)) {
          for (const env of data.signals as SignalEnvelope[]) {
            if (env.timestamp > this.lastTimestamp) {
              this.lastTimestamp = env.timestamp;
            }
            this.listeners.forEach((listener) => {
              try {
                listener(env.message, env);
              } catch (e) {
                console.error("Signal listener error:", e);
              }
            });
          }
        }
      }
    } catch {
      // transient network error, retry next cycle
    }

    if (this.polling) {
      this.pollTimeout = setTimeout(() => this.pollLoop(), 350);
    }
  }
}
