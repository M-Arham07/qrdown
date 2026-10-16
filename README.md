# WebSend

Send files between browsers using a six digit code or QR link.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Select files on the sending device and enter its code
on the receiving device. Pairing and file receipt start automatically, without
confirmation screens. Anyone who has the code can receive that transfer.

## Cancellation

Either device can cancel during pairing, connection setup, direct transfer, or
cloud transfer. Cancellation closes the connection, discards pending received
chunks, aborts cloud requests, and rejects pending file acknowledgements. A direct
control message and a server cancellation record notify the other device. Late
negotiation requests cannot reactivate the cancelled session.

If the network is unavailable, stopping locally is immediate; the other device
learns about cancellation when it can reach the server again. Files already saved
by the browser cannot be recalled. Cancelling a cloud request does not guarantee
that an upload already accepted by storage is deleted; configure an R2 lifecycle
rule for temporary objects.

## Reliable cross-network transfers

WebRTC tries local and internet routes, including TURN relays. Connection recovery
sends a new ICE offer before offering cloud transfer. Public TURN servers are only
a fallback; configure a dedicated relay for production.

### Public server list fallback

When no dedicated provider is configured, WebSend uses a small shortlist from
[the supplied STUN/TURN community list](https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b),
including its comments: Google, Cloudflare and FreeSTUN for STUN, and FreeSTUN plus
the existing OpenRelay entry for TURN. This path requires no application API key.
Configured Cloudflare or static TURN credentials still take precedence.

These public relay entries are unverified. Checks from the development network
on 2026-10-16 did not obtain a relay allocation: FreeSTUN/OpenRelay timed out,
Bistri refused connections, and several older hosts did not resolve. Timeouts
can also reflect local network filtering. Adding more STUN hosts cannot replace
an authenticated, reachable TURN relay on networks that require one.

### Cloudflare Realtime TURN

1. In the Cloudflare dashboard, open Realtime / TURN and create a TURN key.
2. Save its key ID and the API token issued for that TURN key in Vercel environment
   variables (Production and Preview, if you use both):

   ```dotenv
   CLOUDFLARE_TURN_KEY_ID=your_turn_key_id
   CLOUDFLARE_TURN_API_TOKEN=your_turn_key_api_token
   ```

3. Redeploy. For local development, add the same variables to `.env.local` and
   restart the development server.

The authenticated `/api/sessions/ice` endpoint requests credentials from Cloudflare
with a 24-hour lifetime. The long-lived API token is never returned to browsers.
Cloudflare takes precedence over static/coturn configuration when either Cloudflare
variable is present. Incomplete configuration and provider failures return an
explicit error rather than silently falling back to the public relay.

Setup reference: https://developers.cloudflare.com/realtime/turn/generate-credentials/

### Static credentials or coturn

Set `TURN_URLS` to your provider's comma-separated TURN URLs and set
`TURN_USERNAME` / `TURN_CREDENTIAL` on the server. Include UDP and TCP URLs, plus
`turns:` on port 443 if your provider supports it. With coturn REST authentication,
use `TURN_SHARED_SECRET` instead of static credentials. The authenticated
`/api/sessions/ice` endpoint issues time-limited credentials in that mode.
Restart or redeploy after changing environment variables.

Configure Upstash Redis for deployments with multiple server instances; the local
memory fallback cannot coordinate sessions between instances.

Example server configuration (replace the host and credentials with your relay):

```dotenv
TURN_URLS=turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:443?transport=tcp
TURN_USERNAME=provider_username
TURN_CREDENTIAL=provider_password
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token
```

### Transfer performance and remaining work

- Sender reads bounded blocks and caps each message to the negotiated SCTP limit,
  including the chunk header. Backpressure waits for buffer capacity and fails
  explicitly if the channel closes or stalls.
- Receiver counts bytes as they arrive, throttles progress to 200 ms, and confirms
  each file before the sender starts the next one. It validates byte counts and
  chunk order. Direct transfers rely on WebRTC's authenticated transport integrity;
  an additional SHA-256 check runs only when a checksum was supplied.
- Receiving still buffers one complete file in memory. For large-file support,
  add a streaming disk sink where supported, with a bounded fallback on mobile.
- For faster connection setup at scale, replace HTTP signaling polling with an
  ordered WebSocket service or managed realtime transport. Keep bulk file bytes
  on WebRTC. Add resumable transfer offsets for recovery from interrupted transfers.
- Measure connection time, relay usage, completion rate, and throughput on actual
  Wi-Fi/cellular combinations. Compilation does not establish network reliability.

## Reliability checks before release

Use real devices and record the result of each case:

| Scenario | Expected result |
| --- | --- |
| Same Wi-Fi, separate Wi-Fi networks, Wi-Fi to cellular | Pair and deliver matching file bytes |
| UDP blocked; TCP/TLS relay available | Deliver through the configured relay |
| Cancel from either side while connecting, sending, or waiting for acknowledgement | Both sides stop; no late success or next file |
| Cancel during cloud upload, download, or decryption | Request aborted; no late download or completion |
| Several files, empty file, large file | Files remain separate and byte lengths match |
| Transfer running longer than ten minutes | Server session remains available for cancellation |
| Temporary network loss | Explicit recovery or failure; never a false completion |

Track completion rate, connection time (including p95), failure reason, connection
mode, throughput, and time from cancellation to peer acknowledgement. Set release
targets from these measurements. Resuming interrupted transfers and streaming
received files to disk remain future work.
