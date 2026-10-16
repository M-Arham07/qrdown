// WebSend system constants and configurations

export const APP_CONFIG = {
  name: "WebSend",
  version: "1.0.0",
  description: "Direct peer-to-peer file transfer in your browser. Fast, private, no install.",
  roomTtlSeconds: 600, // 10 minutes
  reconnectGraceSeconds: 30,
  iceTimeoutMs: 25000, // 25s: generous window for TURN relay negotiation
  // Reserve four bytes of the 64 KiB message budget for the chunk index.
  chunkSizeBytes: 64 * 1024 - 4,
  bufferThresholdBytes: 4 * 1024 * 1024, // 4 MiB send buffer limit
  maxCloudSizeBytes: 100 * 1024 * 1024, // 100 MB max for cloud fallback
  cloudRetentionHours: 24,
  presignedUrlTtlSeconds: 900, // 15 mins
};

// Public shortlist from the supplied community list (including its comments):
// https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b
// Keep the shortlist small so obsolete hosts do not multiply ICE requests.
// These services have no availability guarantee; configured TURN takes precedence.
export const STUN_SERVERS: RTCIceServer[] = [
  // Google STUN entries from the list.
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
    ],
  },
  // Independent providers listed in the comments.
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:freestun.net:3478" },
];

// Public credentials from the community list. These are unverified fallbacks,
// not application secrets or substitutes for a working dedicated relay.
export const TURN_SERVERS: RTCIceServer[] = [
  {
    urls: "turn:freestun.net:3478",
    username: "free",
    credential: "free",
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
