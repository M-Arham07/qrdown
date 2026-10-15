// WebSend system constants and configurations

export const APP_CONFIG = {
  name: "WebSend",
  version: "1.0.0",
  description: "Direct peer-to-peer file transfer in your browser. Fast, private, no install.",
  roomTtlSeconds: 600, // 10 minutes
  reconnectGraceSeconds: 30,
  iceTimeoutMs: 25000, // 25s: generous window for TURN relay negotiation
  // DataChannel tuning — 64 KiB chunks give ~3–4x better throughput than 16 KiB
  chunkSizeBytes: 64 * 1024,       // 64 KiB per chunk
  bufferThresholdBytes: 4 * 1024 * 1024, // 4 MiB backpressure limit for high throughput
  maxCloudSizeBytes: 100 * 1024 * 1024, // 100 MB max for cloud fallback
  cloudRetentionHours: 24,
  presignedUrlTtlSeconds: 900, // 15 mins
};

// ICE server chain: multiple free STUN + public TURN fallbacks
// Free TURN courtesy of Metered.ca open relay and numb.viagenie.ca
// Note: for production, set up dedicated TURN via Metered, Twilio, or coturn.
export const STUN_SERVERS: RTCIceServer[] = [
  // Google STUN (most reliable)
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
    ],
  },
  // Mozilla STUN
  { urls: "stun:stun.services.mozilla.com" },
  // Twilio STUN
  { urls: "stun:global.stun.twilio.com:3478" },
];

// Free public TURN servers — these are best-effort community relays.
// Replace with dedicated Metered/Twilio credentials for production SLA.
export const TURN_SERVERS: RTCIceServer[] = [
  // Metered.ca free open TURN (no auth required for short-duration relay)
  {
    urls: [
      "turn:a.relay.metered.ca:80",
      "turn:a.relay.metered.ca:80?transport=tcp",
      "turn:a.relay.metered.ca:443",
      "turn:a.relay.metered.ca:443?transport=tcp",
    ],
    username: "open",
    credential: "open",
  },
  // OpenRelay project
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];
