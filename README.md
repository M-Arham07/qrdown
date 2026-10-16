# qrdown

qrdown is a browser-based file transfer tool providing two distinct transmission modes:

1. **Air-Gapped Optical Transfer**: Streams files visually across physical space using high-frequency animated QR codes on one screen and a camera scanner on the receiving device. Operates 100% offline with zero network connectivity, Wi-Fi, or Bluetooth.
2. **Direct Network Transfer**: Peer-to-peer data channel transfer using WebRTC with automatic STUN/TURN traversal and encrypted cloud fallback (Cloudflare R2 / S3) when direct connection fails due to symmetric NAT or firewall restrictions.

---

## Architecture Overview

### 1. Optical Transfer Protocol (WS2)

The optical transfer mode encodes binary files into sequential, high-density alphanumeric QR codes rendered on a canvas and captured via a Web Worker camera scanner.

- **Alphanumeric Base45 Encoding**: Encodes raw bytes using the QR alphanumeric character set (`0-9`, `A-Z`, ` $%*+-./:`), maximizing barcode data density while minimizing visual complexity for the camera sensor.
- **Adaptive Compression**: Streams passing through `CompressionStream("gzip")` before chunking if compression yields a smaller transfer size.
- **Interleaved Headers**: Header frames containing metadata (filename, original size, transfer size, total chunks, compression type, and SHA-256 hash) are repeated every 16 chunks so receivers can join mid-stream without waiting for an entire cycle.
- **Integrity Verification**: The receiver calculates an independent SHA-256 digest on the assembled file before saving. Transfers with checksum mismatches are rejected.
- **Multi-threaded Scanning**: Video frame capture and decoding run inside an `OffscreenCanvas` Web Worker using `jsQR`, preventing UI stuttering and maintaining consistent 60 FPS scanning throughput.
- **Backward Compatibility**: Automatically detects and handles legacy `WS1` base64 frames.

#### Frame Structure

* **Header Frame**:
  ```text
  WS2:H:<12-HEX-ID>:<BASE45_JSON_METADATA>
  ```
  Metadata array schema: `[name, mimeType, size, transferSize, totalChunks, chunkSize, compression, sha256]`

* **Chunk Frame**:
  ```text
  WS2:C:<12-HEX-ID>:<BASE36_INDEX>:<BASE45_PAYLOAD>
  ```

---

### 2. Direct Network Transfer (WebRTC + Cloud Fallback)

For transfers between networked devices:
- **Pairing**: Short 6-digit numeric codes or room link QR codes coordinate the session.
- **Signaling**: Coordinated using Upstash Redis with short TTL session keys.
- **Transport**: WebRTC `RTCDataChannel` with backpressure monitoring against `bufferedAmountLowThreshold` to avoid memory exhaustion during large transfers.
- **Relay Support**: Authenticated TURN relay allocation via Cloudflare Realtime TURN or coturn REST secrets for symmetric NAT traversal.
- **Cloud Fallback**: End-to-end encrypted chunked upload via presigned S3/R2 URLs when WebRTC fails to establish a direct or relayed peer connection.

---

## Getting Started

### Prerequisites

- Node.js 20.x or later
- pnpm 9.x or later

### Local Development

1. Clone the repository:
   ```sh
   git clone https://github.com/M-Arham07/qrdown.git
   cd qrdown
   ```

2. Install dependencies:
   ```sh
   pnpm install
   ```

3. Create a local environment file:
   ```sh
   cp .env.example .env.local
   ```

4. Run the development server:
   ```sh
   pnpm dev
   ```

Open `http://localhost:3000` in your browser.

---

## Configuration

All environment variables are optional for local development (which falls back to in-memory coordination). For production deployments with multiple serverless instances, configure the following:

### Upstash Redis (Session & Signaling)

Required in serverless environments (e.g. Vercel) where memory state cannot be shared across lambdas:

```dotenv
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token
```

### Dedicated TURN Relay

Recommended for reliable cross-network WebRTC connections across mobile carriers and corporate firewalls.

#### Option A: Cloudflare Realtime TURN (Recommended)

1. Open Cloudflare Dashboard > Realtime > TURN and generate a TURN key.
2. Configure:
   ```dotenv
   CLOUDFLARE_TURN_KEY_ID=your_key_id
   CLOUDFLARE_TURN_API_TOKEN=your_api_token
   ```

#### Option B: Static Relay Credentials / coturn

```dotenv
TURN_URLS=turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:443?transport=tcp
TURN_USERNAME=your_username
TURN_CREDENTIAL=your_password
```

For coturn with shared secret authentication:
```dotenv
TURN_SHARED_SECRET=your_coturn_shared_secret
```

### Cloud Storage Fallback (Optional)

Configure Cloudflare R2 or an S3-compatible bucket for encrypted cloud fallback:

```dotenv
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com
CRON_SECRET=your_cleanup_cron_secret
```

---

## Production Deployment

### Vercel

The application is optimized for deployment on Vercel:

```sh
pnpm exec vercel --prod
```

Ensure environment variables are configured either through the Vercel CLI (`vercel env add`) or in the project settings dashboard.

---

## Browser Support & Permissions

- **Camera Scanner**: Requires HTTPS in production (browsers restrict `navigator.mediaDevices.getUserMedia` to secure origins).
- **Streams API**: Requires support for `CompressionStream` and `DecompressionStream` for transparent gzip support (supported in Chrome 80+, Safari 16.4+, Firefox 113+).
- **Wake Lock**: Uses the Screen Wake Lock API to prevent mobile screens from sleeping during active transfers.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
