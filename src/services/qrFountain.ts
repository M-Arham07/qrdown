// Independent systematic LT codec. A repair packet combines deterministic source
// blocks; peeling one recovered block can unlock several other missing blocks.
// Wire parameters are fixed: robust soliton c=0.1, delta=0.05, degree capped at 64.
export function fountainDistribution(count: number): number[] {
  const maximum = Math.min(count, 64);
  const ripple = 0.1 * Math.log(count / 0.05) * Math.sqrt(count);
  const pivot = Math.max(1, Math.min(count, Math.floor(count / ripple)));
  const cdf: number[] = [];
  let sum = 0;
  for (let degree = 1; degree <= maximum; degree++) {
    const rho = degree === 1 ? 1 / count : 1 / (degree * (degree - 1));
    const tau = degree < pivot ? ripple / (degree * count)
      : degree === pivot ? ripple * Math.log(ripple / 0.05) / count : 0;
    sum += rho + tau;
    cdf.push(sum);
  }
  return cdf.map(value => value / sum);
}

export function fountainIndices(seed: number, count: number, cdf: number[]): number[] {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const sample = random();
  const degree = Math.min(count, Math.max(1, cdf.findIndex(value => value >= sample) + 1));
  const indices = new Set<number>();
  while (indices.size < degree) indices.add(Math.floor(random() * count));
  return [...indices];
}

function xor(target: Uint8Array, source: Uint8Array) {
  for (let i = 0; i < source.length; i++) target[i] ^= source[i];
}

export function encodeRepair(blocks: Uint8Array[], blockSize: number, seed: number, cdf: number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(blockSize);
  for (const index of fountainIndices(seed, blocks.length, cdf)) xor(bytes, blocks[index]);
  return bytes;
}

type Equation = { indices: Set<number>; bytes: Uint8Array<ArrayBuffer> };

export class FountainDecoder {
  private readonly blocks = new Map<number, Uint8Array<ArrayBuffer>>();
  private readonly equations = new Map<number, Equation>();
  private readonly neighbours: Set<number>[];
  private readonly seen = new Set<number>();
  private readonly cdf: number[];
  private nextEquation = 0;

  constructor(private readonly count: number, private readonly blockSize: number,
    private readonly recovered: (index: number, bytes: Uint8Array<ArrayBuffer>) => void) {
    if (!Number.isInteger(count) || count < 1 || count > 4000 || blockSize < 1 || blockSize > 1024) throw new Error("Invalid repair parameters");
    this.neighbours = Array.from({ length: count }, () => new Set<number>());
    this.cdf = fountainDistribution(count);
  }

  addSystematic(index: number, bytes: Uint8Array) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count || bytes.length > this.blockSize || this.blocks.has(index)) return;
    const padded = new Uint8Array(this.blockSize);
    padded.set(bytes);
    this.solve(index, padded);
  }

  addRepair(seed: number, payload: Uint8Array) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || payload.length !== this.blockSize || this.seen.has(seed)) return;
    // Bound duplicate history and outstanding equations on arbitrarily long scans.
    if (this.seen.size >= this.count * 8 + 64) this.seen.delete(this.seen.values().next().value!);
    this.seen.add(seed);
    const bytes = new Uint8Array(payload);
    const indices = new Set<number>();
    for (const index of fountainIndices(seed, this.count, this.cdf)) {
      const known = this.blocks.get(index);
      if (known) xor(bytes, known);
      else indices.add(index);
    }
    if (indices.size === 0) return;
    if (indices.size === 1) { this.solve(indices.values().next().value!, bytes); return; }
    if (this.equations.size >= this.count * 3) this.remove(this.equations.keys().next().value!);
    const id = this.nextEquation++;
    this.equations.set(id, { indices, bytes });
    for (const index of indices) this.neighbours[index].add(id);
  }

  private remove(id: number) {
    const equation = this.equations.get(id);
    if (!equation) return;
    for (const index of equation.indices) this.neighbours[index].delete(id);
    this.equations.delete(id);
  }

  private solve(index: number, bytes: Uint8Array<ArrayBuffer>) {
    // Iterative queue avoids stack overflow when one frame unlocks the entire file.
    const queue = [{ index, bytes }];
    for (let head = 0; head < queue.length; head++) {
      const item = queue[head];
      if (this.blocks.has(item.index)) continue;
      this.blocks.set(item.index, item.bytes);
      this.recovered(item.index, item.bytes);
      for (const id of this.neighbours[item.index]) {
        const equation = this.equations.get(id)!;
        equation.indices.delete(item.index);
        xor(equation.bytes, item.bytes);
        if (equation.indices.size === 1) {
          queue.push({ index: equation.indices.values().next().value!, bytes: equation.bytes });
          this.remove(id);
        } else if (equation.indices.size === 0) this.remove(id);
      }
      this.neighbours[item.index].clear();
    }
  }
}
