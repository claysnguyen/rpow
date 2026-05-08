import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { trailingZeroBits } from '@rpow/shared';
import { makeDifficultyChecker, mine } from '../src/miner.js';
import { minePool } from '../src/miner-pool.js';

function verify(prefixHex: string, nonce: bigint, bits: number): boolean {
  const prefix = Buffer.from(prefixHex, 'hex');
  const buf = Buffer.alloc(prefix.length + 8);
  prefix.copy(buf, 0);
  let x = nonce;
  for (let j = 0; j < 8; j++) { buf[prefix.length + j] = Number(x & 0xffn); x >>= 8n; }
  return trailingZeroBits(createHash('sha256').update(buf).digest()) >= bits;
}

describe('mine', () => {
  it('returns a nonce satisfying low difficulty', async () => {
    const nonce = await mine('deadbeef', 8);
    expect(nonce).not.toBeNull();
    expect(verify('deadbeef', nonce!, 8)).toBe(true);
  });

  it('honors abortSignal between batches', async () => {
    const abort = { aborted: false };
    // Use absurdly high difficulty so it won't find a solution; abort after a tick.
    const promise = mine('cafebabe', 64, { abortSignal: abort, batchSize: 256 });
    setTimeout(() => { abort.aborted = true; }, 50);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('reports progress periodically', async () => {
    const events: Array<{ hashes: bigint; elapsedMs: number }> = [];
    const abort = { aborted: false };
    const promise = mine('cafebabe', 64, {
      abortSignal: abort,
      batchSize: 1024,
      onProgress: (p) => events.push(p),
    });
    setTimeout(() => { abort.aborted = true; }, 600);
    await promise;
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(Number(events[0]!.hashes)).toBeGreaterThan(0);
  });
});

describe('makeDifficultyChecker', () => {
  // Reference implementation: trailing-zero bits over the SHA-256 digest.
  const reference = (h: Buffer, bits: number): boolean => trailingZeroBits(h) >= bits;

  it('matches trailingZeroBits for a range of difficulties', () => {
    // Sample a handful of known digests across the byte boundaries.
    const digests = [
      Buffer.alloc(32, 0),                                // all zeros — passes any bits
      Buffer.from('00'.repeat(31) + '01', 'hex'),         // 0 trailing zero bits
      Buffer.from('00'.repeat(31) + '02', 'hex'),         // 1 trailing zero bit
      Buffer.from('00'.repeat(31) + '80', 'hex'),         // 7 trailing zero bits
      Buffer.from('00'.repeat(30) + 'ff' + '00', 'hex'),  // 8 trailing zero bits
      Buffer.from('00'.repeat(30) + '01' + '00', 'hex'),  // 8 trailing zero bits
      Buffer.from('00'.repeat(30) + '00' + '00', 'hex'),  // 16+ trailing zero bits
    ];
    for (const d of digests) {
      const ref = trailingZeroBits(d);
      for (let bits = 0; bits <= 24; bits++) {
        const fast = makeDifficultyChecker(bits)(d);
        expect(fast).toBe(reference(d, bits));
        if (bits > ref) expect(fast).toBe(false);
      }
    }
  });
});

describe('minePool', () => {
  // The pool's multi-worker path requires the compiled `dist/miner-worker.js`,
  // because `worker_threads` cannot consume our TypeScript source directly.
  // Tests therefore exercise the in-thread fallback (workers=1) which uses the
  // exact same hot loop. Multi-worker behaviour is verified manually via
  // `npm run build && rpow bench --workers N`.

  it('finds a valid nonce with a single worker (in-thread fallback)', async () => {
    const nonce = await minePool('deadbeef', 8, { workers: 1 });
    expect(nonce).not.toBeNull();
    expect(verify('deadbeef', nonce!, 8)).toBe(true);
  });

  it('honors abortSignal in single-worker mode', async () => {
    const abort = { aborted: false };
    const promise = minePool('cafebabe', 64, { workers: 1, abortSignal: abort, batchSize: 256 });
    setTimeout(() => { abort.aborted = true; }, 100);
    const result = await promise;
    expect(result).toBeNull();
  });
});
