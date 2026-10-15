// WebSend system constants and configurations

export const APP_CONFIG = {
  name: "WebSend",
  version: "1.0.0",
  description: "Direct peer-to-peer file transfer in your browser. Fast, private, no install.",
  roomTtlSeconds: 600, // 10 minutes
  reconnectGraceSeconds: 30,
  iceTimeoutMs: 12000, // 12 seconds connection timeout
  chunkSizeBytes: 16 * 1024, // 16 KiB chunks for RTCDataChannel
  bufferThresholdBytes: 256 * 1024, // 256 KiB backpressure limit
  maxCloudSizeBytes: 100 * 1024 * 1024, // 100 MB max for cloud fallback
  cloudRetentionHours: 24,
  presignedUrlTtlSeconds: 900, // 15 mins
};

// Chain of free STUN servers for maximum NAT traversal redundancy
export const STUN_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun.services.mozilla.com",
      "stun:global.stun.twilio.com:3478",
    ],
  },
];
