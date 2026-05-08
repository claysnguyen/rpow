import { createHash } from 'node:crypto';
import { loadNativeMiner } from './miner-native.js';

export interface MineProgress {
  hashes: bigint;
  elapsedMs: number;
}

export interface MineOpts {
  /** Called periodically (~every 250ms) with progress info. */
  onProgress?: (p: MineProgress) => void;
  /** Hashes per uninterrupted batch. Larger = faster, smaller = more responsive to abort. */
  batchSize?: number;
  /** When set true, the miner returns null at the next yield point. */
  abortSignal?: { aborted: boolean };
  /** Sharding: starting hi32 component of the nonce. Workers use this to avoid collisions. */
  startHi?: number;
  /** Sharding: stride for hi32 increments when lo32 wraps. Workers in a pool of N pass N here. */
  hiStep?: number;
}

/**
 * Build a fast trailing-zero-bits checker specialized for one difficulty.
 * SHA-256 digests are 32 bytes. We check from byte 31 backwards. Most
 * candidates fail at byte 31, so the first comparison short-circuits ~99.6%
 * of the time, and we avoid both the function-call overhead and the loop
 * inside `trailingZeroBits`.
 */
export function makeDifficultyChecker(bits: number): (h: Buffer) => boolean {
  if (bits <= 0) return () => true;
  const fullBytes = bits >>> 3;
  const remBits = bits & 7;
  const remMask = (1 << remBits) - 1;
  const lastFullIdx = 31 - fullBytes;
  return (h: Buffer): boolean => {
    for (let i = 31; i > lastFullIdx; i--) {
      if (h[i] !== 0) return false;
    }
    if (remBits === 0) return true;
    return (h[lastFullIdx]! & remMask) === 0;
  };
}

/**
 * Single-threaded SHA-256 hashcash miner. Yields between batches via setImmediate
 * so SIGINT (and the abortSignal flag) can interrupt without waiting forever.
 *
 * Returns the discovered nonce as a bigint, or null if aborted.
 *
 * Hot loop optimizations vs the original implementation:
 *   - Number-based nonce (split into two u32s) instead of BigInt — eliminates
 *     8 BigInt shift/and ops per iteration.
 *   - `Buffer.writeUInt32LE` x2 instead of an 8-iteration shift loop.
 *   - Specialized inline checker per difficulty avoids the generic
 *     `trailingZeroBits` function call and its loop.
 */
export async function mine(prefixHex: string, difficultyBits: number, opts: MineOpts = {}): Promise<bigint | null> {
  if (prefixHex.length % 2 !== 0) throw new Error('odd-length prefix hex');
  const prefix = Buffer.from(prefixHex, 'hex');
  const native = loadNativeMiner();
  const batch = opts.batchSize ?? 65536;
  const hiStep = (opts.hiStep ?? 1) >>> 0;
  let lo = 0;
  let hi = (opts.startHi ?? 0) >>> 0;
  const startedAt = performance.now();
  let lastReport = startedAt;
  let totalHashes = 0;

  if (native) {
    // Native path: autotune chunk size conservatively to reduce JS<->native
    // overhead while keeping abort/SIGINT responsiveness. We target short
    // native calls (~4-8ms) and clamp aggressively so behavior remains stable.
    let nativeBatch = Math.max(1, batch * 4);
    const minNativeBatch = Math.max(1024, batch);
    const maxNativeBatch = Math.max(minNativeBatch, batch * 64);
    while (!(opts.abortSignal?.aborted)) {
      const callStartedAt = performance.now();
      const r = native.hashSearch(prefix, difficultyBits, hi, hiStep, lo, nativeBatch);
      const callMs = performance.now() - callStartedAt;
      totalHashes += r.hashes;
      if (r.found) {
        return (BigInt(r.nonceHi >>> 0) << 32n) | BigInt(r.nonceLo >>> 0);
      }
      hi = r.nextHi >>> 0;
      lo = r.nextLo >>> 0;
      // Keep each native invocation short to avoid hurting control-plane
      // responsiveness (Ctrl-C/abort/progress updates).
      if (callMs < 6 && r.hashes === nativeBatch && nativeBatch < maxNativeBatch) {
        nativeBatch = Math.min(maxNativeBatch, nativeBatch << 1);
      } else if (callMs > 16 && nativeBatch > minNativeBatch) {
        nativeBatch = Math.max(minNativeBatch, nativeBatch >>> 1);
      }
      const now = performance.now();
      if (opts.onProgress && now - lastReport > 250) {
        opts.onProgress({ hashes: BigInt(totalHashes), elapsedMs: now - startedAt });
        lastReport = now;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return null;
  }

  // JS fallback path (no native binary available for this platform).
  const buf = Buffer.alloc(prefix.length + 8);
  prefix.copy(buf, 0);
  const offset = prefix.length;
  const checker = makeDifficultyChecker(difficultyBits);

  while (!(opts.abortSignal?.aborted)) {
    for (let i = 0; i < batch; i++) {
      buf.writeUInt32LE(lo, offset);
      buf.writeUInt32LE(hi, offset + 4);
      const h = createHash('sha256').update(buf).digest();
      if (checker(h)) {
        return (BigInt(hi) << 32n) | BigInt(lo);
      }
      lo = (lo + 1) >>> 0;
      if (lo === 0) hi = (hi + hiStep) >>> 0;
    }
    totalHashes += batch;
    const now = performance.now();
    if (opts.onProgress && now - lastReport > 250) {
      opts.onProgress({ hashes: BigInt(totalHashes), elapsedMs: now - startedAt });
      lastReport = now;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return null;
}
