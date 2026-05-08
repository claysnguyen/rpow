import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import type { MineProgress } from './miner.js';
import { mine } from './miner.js';

export interface PoolMineOpts {
  /** Number of worker processes to spawn. 1 = single-thread (skips fork). */
  workers: number;
  /** Aggregated progress callback (~every 250ms). */
  onProgress?: (p: MineProgress) => void;
  /** When `aborted` flips true, all workers are told to stop and the promise resolves null. */
  abortSignal?: { aborted: boolean };
  /** Hashes per uninterrupted batch in each worker. */
  batchSize?: number;
}

/**
 * Sensible default for `--workers`: leave 2 cores for the OS, main thread, and
 * any other apps. On an M1 Pro (10c) this returns 8. On a 4-core machine it
 * returns 2. Always at least 1.
 */
export function defaultWorkers(): number {
  return Math.max(1, os.cpus().length - 2);
}

interface ProgressMsg { type: 'progress'; hashes: number; elapsedMs: number }
interface FoundMsg { type: 'found'; nonce: string; hashes: number }
interface AbortedMsg { type: 'aborted'; hashes: number }
type WorkerMsg = ProgressMsg | FoundMsg | AbortedMsg;

/**
 * Multi-core SHA-256 hashcash miner. Spawns N child Node processes (via
 * `child_process.fork`) — NOT worker threads — each walking a disjoint shard
 * of nonce space; resolves the first solution found. If `workers === 1`,
 * falls back to the in-thread `mine()` to avoid fork overhead and IPC on
 * tests / low-end hardware.
 *
 * Why fork and not Worker: see the comment block at the top of
 * `miner-worker.ts`. tldr: macOS deprioritizes worker_threads doing pure
 * compute, but happily schedules sibling Node processes onto P-cores.
 */
export async function minePool(prefixHex: string, difficultyBits: number, opts: PoolMineOpts): Promise<bigint | null> {
  const N = Math.max(1, opts.workers | 0);
  if (N === 1) {
    return mine(prefixHex, difficultyBits, {
      abortSignal: opts.abortSignal,
      onProgress: opts.onProgress,
      batchSize: opts.batchSize,
    });
  }

  const workerPath = fileURLToPath(new URL('./miner-worker.js', import.meta.url));
  const startedAt = performance.now();
  const perWorker = new Array<number>(N).fill(0);
  let lastEmit = 0;

  return new Promise<bigint | null>((resolve, reject) => {
    const children: ChildProcess[] = [];
    let settled = false;
    let abortPoll: NodeJS.Timeout | null = null;

    const cleanup = (): Promise<void> => {
      if (abortPoll) clearInterval(abortPoll);
      const tasks = children.map((c) => new Promise<void>((done) => {
        if (c.exitCode !== null || c.killed) return done();
        let exited = false;
        const onExit = (): void => { if (exited) return; exited = true; done(); };
        c.once('exit', onExit);
        try { c.send({ type: 'abort' }); } catch { /* IPC may already be torn down */ }
        // Belt-and-suspenders: if the child doesn't exit on the message within
        // 250ms (e.g. it died during fork), kill it hard.
        setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* already gone */ } }, 250);
      }));
      return Promise.all(tasks).then(() => { /* discard */ });
    };

    const finish = (result: bigint | null, err?: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup().finally(() => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(result);
      });
    };

    const emitProgress = (): void => {
      if (!opts.onProgress) return;
      const now = performance.now();
      if (now - lastEmit < 100) return;
      lastEmit = now;
      let total = 0;
      for (let k = 0; k < N; k++) total += perWorker[k]!;
      opts.onProgress({ hashes: BigInt(total), elapsedMs: now - startedAt });
    };

    if (opts.abortSignal) {
      abortPoll = setInterval(() => {
        if (settled) {
          if (abortPoll) clearInterval(abortPoll);
          return;
        }
        if (opts.abortSignal!.aborted) finish(null);
      }, 100);
    }

    for (let i = 0; i < N; i++) {
      const initData = {
        prefixHex,
        difficultyBits,
        startHi: i,
        hiStep: N,
        batchSize: opts.batchSize ?? 65536,
        reportEveryMs: 250,
      };
      const child = fork(workerPath, [JSON.stringify(initData)], {
        // Suppress the child's stdout/stderr so progress lines from the parent
        // aren't garbled by debug noise. stderr from a real crash will still
        // surface via the 'error' / 'exit' events.
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      children.push(child);

      child.on('message', (msg: WorkerMsg) => {
        if (msg.type === 'progress') {
          perWorker[i] = msg.hashes;
          emitProgress();
        } else if (msg.type === 'found') {
          perWorker[i] = msg.hashes;
          let nonce: bigint;
          try { nonce = BigInt(msg.nonce); } catch (e) { return finish(null, e); }
          finish(nonce);
        } else if (msg.type === 'aborted') {
          perWorker[i] = msg.hashes;
        }
      });
      child.on('error', (e) => finish(null, e));
      child.on('exit', (code, signal) => {
        // A clean exit (0 or SIGTERM/SIGKILL during cleanup) is fine. An
        // unexpected exit before settlement is fatal.
        if (settled) return;
        if (code === 0) return; // graceful self-exit after found/aborted
        finish(null, new Error(`miner-worker exited unexpectedly (code=${code} signal=${signal ?? 'none'})`));
      });
    }
  });
}
