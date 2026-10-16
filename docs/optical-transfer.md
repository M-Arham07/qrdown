# Optical transfer design

## Why recovery changed

The previous sender repeated the same numbered chunks. A receiver missing one
chunk had to wait for that exact chunk to return, even if it successfully read
hundreds of duplicates in between.

[TXQR](https://github.com/divan/txqr) and
[qrloop](https://github.com/gre/qrloop) use fountain coding to reduce that problem.
The [TXQR author's explanation](https://divan.dev/posts/fountaincodes/) describes
why frame recovery matters for animated QR links. These informed the design;
this repository's codec is an independent implementation, not copied code.

## WS3 stream

- Original files remain limited to 1,000,000 bytes before compression.
- Gzip is retained only when smaller; SHA-256 verifies the restored original.
- The initial pass sends each source chunk directly, so a clean scan has no
  fountain repair overhead. Subsequent packets contain fresh LT repair equations.
- The deterministic robust-soliton sampler uses c=0.1, delta=0.05 and a maximum
  degree of 64. Packet seeds reproduce the source indices on the receiver.
- Every eighth packet after the first pass is a source packet, providing a
  fallback when repair equations have not yet unlocked missing chunks.
- Headers repeat every 17 displayed frames, including the first. The receiver
  buffers up to 64 packets before a header, so it can join mid-stream.
- A WS3 frame ends with a colon and eight uppercase CRC-32 hex digits covering
  the preceding ASCII frame. Damaged frames are discarded before they affect
  recovery. CRC protects against accidental corruption; it is not authentication.
- The receiver keeps at most 3K outstanding equations and 8K+64 recent repair
  seeds. Iterative peeling avoids recursive stack growth.
- New receivers still accept WS1/WS2 streams within the 1 MB limit. WS3 senders
  require the updated receiver; reload both devices after an update.

## Camera and display

The sender retains a single automatic 20 FPS target, medium QR error correction,
constant module dimensions, and a small cache of upcoming QR matrices. It creates
repair frames on demand instead of precomputing a large animation.

After locating a QR, the receiver crops around it with a 20% margin and decodes
at up to 640 pixels on the longest side. Every eighth capture searches outside
that crop; a location expires after one second, allowing recovery after movement.
The full search uses up to 960 pixels. Only one scan can be in flight. Native QR
detection has a timed fallback and is retried after temporary misses rather than
being permanently disabled by repeated readings of the same displayed frame.

Text composition comes before file selection in both transfer modes. Text
receipts offer Copy and optional Download, without automatically saving a file.

## Validation

Run `pnpm test:qr` for deterministic protocol, recovery, and synthetic image checks:

- Empty and Unicode text, gzip, and binary files through the 1 MB limit.
- 50% random loss, reordered packets, duplicates, burst loss, and late joining.
- Worker integration including early packets and unrelated transfer IDs.
- Corruption rejection, final integrity verification, and legacy headers.
- Real qrcode encoding followed by jsQR decoding of synthetic pixel buffers.

The fixed 100,000-byte / 50%-loss comparison completed in 403 displayed frames
with repair packets versus 1,927 with the old repeating sequence (4.78x fewer
frames). This is a deterministic loss simulation, not a camera throughput result.
A separate 1 MB / 50%-loss case completed in 5,541 displayed frames.

Physical end-to-end throughput still needs measurement on actual phone/webcam
pairs. Exposure, focus, glare, screen size, and decoder latency can dominate; a
higher display FPS alone does not establish faster completed transfers.
