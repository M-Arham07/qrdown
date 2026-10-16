import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile only these local TS modules for Node; production uses Next's bundler.
const load = createRequire(import.meta.url);
load.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};
const { createOpticalFrames, parseOpticalFrame, assembleOpticalFile, QR_STREAM } = load('../src/services/qrProtocol.ts');
const { FountainDecoder } = load('../src/services/qrFountain.ts');
const QRCode = load('qrcode');
const jsQR = load('jsqr');

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function payload(size, seed = 817) {
  const next = random(seed);
  return Uint8Array.from({ length: size }, () => Math.floor(next() * 256));
}
async function recover(prepared, { drop = 0, start = 0, seed = 1, burst = false } = {}) {
  const info = prepared.fileInfo;
  const chunks = new Map();
  const decoder = new FountainDecoder(info.totalChunks, info.chunkSize, (index, data) => {
    assert(!chunks.has(index), 'a block is reported exactly once');
    chunks.set(index, data.slice(0, Math.min(info.chunkSize, info.transferSize - index * info.chunkSize)));
  });
  const next = random(seed);
  const budget = start + info.totalChunks * 14 + 400;
  let pending = [];
  let displayed = 0;
  for (let index = start; index < budget && chunks.size < info.totalChunks; index++) {
    displayed++;
    if (next() < drop || (burst && index % 89 < 22)) continue;
    const frame = parseOpticalFrame(prepared.frameAt(index));
    assert(frame);
    if (frame.type === 'HEADER') continue;
    pending.push(frame);
    if (pending.length < 7 && info.totalChunks > 1) continue;
    // Reverse batches and deliver duplicates to exercise reordering and deduplication.
    for (const packet of pending.reverse()) {
      for (let duplicate = 0; duplicate < 2; duplicate++) {
        if (packet.type === 'CHUNK') decoder.addSystematic(packet.index, packet.bytes);
        else decoder.addRepair(packet.seed, packet.bytes);
      }
    }
    pending = [];
  }
  assert.equal(chunks.size, info.totalChunks, 'all chunks recovered within bounded simulation');
  return { blob: await assembleOpticalFile(info, chunks), displayed, chunks };
}

test('empty, small, Unicode, and compressed text survive complete protocol round trip', async () => {
  for (const value of ['', 'Hi 👋 مرحبا', 'compress me\n'.repeat(8000)]) {
    const file = new File([value], 'message.txt', { type: 'text/plain' });
    const prepared = await createOpticalFrames(file);
    const { blob } = await recover(prepared);
    assert.equal(await blob.text(), value);
    if (value.length > 1000) assert.equal(prepared.fileInfo.compression, 'gzip');
  }
});

test('recovers up to the 1 MB limit under 50% loss, duplicates, and reordering', async t => {
  for (const size of [641, 40_001, 1_000_000]) {
    const bytes = payload(size);
    const prepared = await createOpticalFrames(new File([bytes], 'random.bin'));
    const { blob, displayed } = await recover(prepared, { drop: 0.5, seed: size });
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    t.diagnostic(`${size} bytes: ${prepared.fileInfo.totalChunks} source blocks, ${displayed} displayed frames at 50% simulated loss`);
  }
});

test('late join and burst loss recover without seeing the initial systematic pass', async () => {
  const bytes = payload(80_003);
  const prepared = await createOpticalFrames(new File([bytes], 'late.bin'));
  const { blob } = await recover(prepared, { start: prepared.fileInfo.totalChunks * 2, drop: 0.25, burst: true, seed: 91 });
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test('repair packets beat unchanged looping under the same deterministic 50% loss', async t => {
  const prepared = await createOpticalFrames(new File([payload(100_000)], 'benchmark.bin'));
  const { displayed } = await recover(prepared, { drop: 0.5, seed: 77 });
  const count = prepared.fileInfo.totalChunks;
  const next = random(77);
  const seen = new Set();
  let oldFrames = 0;
  for (; seen.size < count && oldFrames < count * 30; oldFrames++) {
    if (next() < 0.5 || oldFrames % 17 === 0) continue;
    const packet = oldFrames - Math.floor(oldFrames / 17) - 1;
    seen.add(packet % count);
  }
  assert(displayed < oldFrames, `${displayed} repair frames vs ${oldFrames} looping frames`);
  t.diagnostic(`Deterministic frame-loss simulation: repair=${displayed}, previous looping=${oldFrames}, ${(oldFrames / displayed).toFixed(2)}x fewer displayed frames to completion`);
});

test('enforces size and packet limits and detects corrupted reconstructed bytes', async () => {
  await assert.rejects(createOpticalFrames(new File([new Uint8Array(QR_STREAM.maxFileBytes + 1)], 'oversize.bin')), /1 MB/);
  const prepared = await createOpticalFrames(new File([payload(1000)], 'integrity.bin'));
  const { chunks } = await recover(prepared);
  chunks.get(0)[0] ^= 1;
  await assert.rejects(assembleOpticalFile(prepared.fileInfo, chunks), /verification failed/);
  assert.equal(parseOpticalFrame('WS3:R:ABCDEF123456:ZZZZZZZ:00'), null);
  assert.equal(parseOpticalFrame('x'.repeat(5001)), null);
  const packet = prepared.frameAt(1);
  assert.equal(parseOpticalFrame(packet.slice(0, -1) + (packet.endsWith('0') ? '1' : '0')), null, 'damaged packets are discarded before fountain decoding');
  const legacy = parseOpticalFrame(prepared.frameAt(0).slice(0, -9).replace('WS3:', 'WS2:'));
  assert.equal(legacy.type, 'HEADER');
  assert.equal(legacy.info.fountain, false);
});

test('header, data, and repair frames survive actual QR encode/decode on a fixed grid', async () => {
  const prepared = await createOpticalFrames(new File([payload(5000)], 'qr.bin'));
  const version = QRCode.create([{ data: prepared.largestFrame, mode: 'alphanumeric' }], { errorCorrectionLevel: 'M' }).version;
  for (const index of [0, 1, 9, 30]) {
    const text = prepared.frameAt(index);
    const qr = QRCode.create([{ data: text, mode: 'alphanumeric' }], { errorCorrectionLevel: 'M', version });
    const size = (qr.modules.size + 8) * 5;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) {
      if (!qr.modules.data[y * qr.modules.size + x]) continue;
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) {
        const offset = (((y + 4) * 5 + dy) * size + (x + 4) * 5 + dx) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
    assert.equal(jsQR(pixels, size, size, { inversionAttempts: 'dontInvert' })?.data, text);
  }
});

test('scanner worker joins mid-stream, ignores other transfers, and verifies completion', async () => {
  const bytes = payload(20_005);
  const stream = await createOpticalFrames(new File([bytes], 'worker.bin'));
  const other = await createOpticalFrames(new File([payload(1200, 2)], 'other.bin'));
  const messages = [];
  const previousSelf = globalThis.self;
  globalThis.self = { postMessage: message => messages.push(message) };
  try {
    const workerPath = load.resolve('../src/workers/qrScanner.worker.ts');
    delete load.cache[workerPath];
    load(workerPath);
    const send = text => globalThis.self.onmessage({ data: { type: 'text', text } });
    // Source packets arrive before any header, just as with a camera joining mid-stream.
    for (let index = 1; index <= 5; index++) await send(stream.frameAt(index));
    await send(stream.frameAt(0));
    await send(other.frameAt(0));
    await send(other.frameAt(1));
    const next = random(92);
    for (let index = 20; index < 1200 && !messages.some(message => message.type === 'complete'); index++) {
      if (next() < 0.45) continue;
      await send(stream.frameAt(index));
      await send(stream.frameAt(index));
    }
    assert(!messages.some(message => message.type === 'error'));
    const completion = messages.find(message => message.type === 'complete');
    assert(completion, 'worker completes from source and repair packets');
    assert.equal(completion.info.name, 'worker.bin');
    assert.deepEqual(new Uint8Array(await completion.blob.arrayBuffer()), bytes);
    const progress = messages.filter(message => message.type === 'progress');
    assert(progress.every((message, index) => index === 0 || message.bytes >= progress[index - 1].bytes));
    assert(progress.at(-1).verifying);
    assert.equal(progress.at(-1).bytes, stream.fileInfo.transferSize);
  } finally { globalThis.self = previousSelf; }
});
