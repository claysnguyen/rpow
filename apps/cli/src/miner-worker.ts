/**
 * Worker entry for the multi-process miner. Spawned as a child Node process
 * (via `child_process.fork`) rather than a `worker_thread`. We learned the
 * hard way that on macOS (M-series specifically) compute-bound work in worker
 * threads gets aggressively co-scheduled onto efficiency cores or otherwise
 * deprioritized, costing ~60% of available throughput. Forking a real process
 * per shard gives each its own QoS queue and lets the OS spread them across
 * P-cores, recovering most of that gap.
 *
 * Sharding scheme: nonce is split into two unsigned 32-bit halves (lo, hi).
 * Worker `i` of `N` starts at (lo=0, hi=i) and on lo wrap-around increments
 * hi by N. With N <= ~32 in practice and lo space = 2^32, no two workers
 * ever collide and a single worker covers ~4.29e9 distinct nonces before
 * needing to bump hi.
 *
 * IPC: init data is passed via argv (one JSON string), runtime control
 * (`abort`) and progress/found events flow through `process.send` /
 * `process.on('message')`. The hot loop yields once per batch via
 * `setImmediate` so the abort message is processed promptly.
 */
import { createHash } from 'node:crypto';
import { makeDifficultyChecker } from './miner.js';

interface InitData {
  prefixHex: string;
  difficultyBits: number;
  startHi: number;
  hiStep: number;
  batchSize: number;
  reportEveryMs: number;
}

if (!process.send) throw new Error('miner-worker started without IPC channel');
const send = process.send.bind(process);

const raw = process.argv[2];
if (!raw) throw new Error('miner-worker: missing init data in argv[2]');
const data = JSON.parse(raw) as InitData;

const prefix = Buffer.from(data.prefixHex, 'hex');
const buf = Buffer.alloc(prefix.length + 8);
prefix.copy(buf, 0);
const offset = prefix.length;
const checker = makeDifficultyChecker(data.difficultyBits);

let lo = 0;
let hi = data.startHi >>> 0;
const hiStep = data.hiStep >>> 0;
const batch = data.batchSize;
const reportEveryMs = data.reportEveryMs;

let aborted = false;
let totalHashes = 0;

const startedAt = performance.now();
let lastReport = startedAt;

process.on('message', (msg: { type?: string }) => {
  if (msg && msg.type === 'abort') aborted = true;
});

// If parent disappears we should bail out, otherwise we'd keep hashing forever
// in the background after the user Ctrl-C'd the parent.
process.on('disconnect', () => { aborted = true; });

function step(): void {
  if (aborted) {
    send({ type: 'aborted', hashes: totalHashes });
    process.exit(0);
  }
  for (let i = 0; i < batch; i++) {
    buf.writeUInt32LE(lo, offset);
    buf.writeUInt32LE(hi, offset + 4);
    const h = createHash('sha256').update(buf).digest();
    if (checker(h)) {
      totalHashes += i + 1;
      send({
        type: 'found',
        nonce: (((BigInt(hi) << 32n) | BigInt(lo))).toString(),
        hashes: totalHashes,
      });
      // Stay alive briefly so the message flushes before exit.
      setTimeout(() => process.exit(0), 50);
      return;
    }
    lo = (lo + 1) >>> 0;
    if (lo === 0) hi = (hi + hiStep) >>> 0;
  }
  totalHashes += batch;
  const now = performance.now();
  if (now - lastReport >= reportEveryMs) {
    send({ type: 'progress', hashes: totalHashes, elapsedMs: now - startedAt });
    lastReport = now;
  }
  setImmediate(step);
}

step();
