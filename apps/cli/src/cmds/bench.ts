import os from 'node:os';
import { defaultWorkers, defaultWorkersNative, minePool } from '../miner-pool.js';
import { nativeAvailable } from '../miner-native.js';
import { c, die, fmtElapsed, fmtRate, progressDone, progressLine } from '../ui.js';

interface BenchFlags {
  workers: number;
  seconds: number;
  bits: number;
}

function parseFlags(args: string[]): BenchFlags {
  let workers = nativeAvailable() ? defaultWorkersNative() : defaultWorkers();
  let seconds = 10;
  let bits = 64;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--workers' || a === '-w') {
      const v = args[++i];
      if (!v || !/^\d+$/.test(v)) die('--workers requires a positive integer');
      workers = parseInt(v, 10);
      if (workers < 1) die('--workers must be >= 1');
      continue;
    }
    if (a === '--seconds' || a === '-s') {
      const v = args[++i];
      if (!v || !/^\d+$/.test(v)) die('--seconds requires a positive integer');
      seconds = parseInt(v, 10);
      if (seconds < 1) die('--seconds must be >= 1');
      continue;
    }
    if (a === '--bits' || a === '-b') {
      const v = args[++i];
      if (!v || !/^\d+$/.test(v)) die('--bits requires a non-negative integer');
      bits = parseInt(v, 10);
      continue;
    }
    die(`unknown flag: ${a}`);
  }
  return { workers, seconds, bits };
}

/**
 * Offline benchmark: spin the miner against a local fake challenge for `--seconds`
 * seconds and print the achieved hashrate. Does not contact the API.
 *
 * Default difficulty is 64 bits which is astronomically unlikely to produce a hit
 * within the bench window, so we always exhaust the time budget and get a clean
 * rate measurement. Lower it (e.g. `--bits 22`) only if you want the bench to
 * stop early on a real hit.
 */
export async function benchCmd(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const cpu = (() => {
    try { return os.cpus()[0]?.model ?? 'unknown CPU'; } catch { return 'unknown CPU'; }
  })();
  const backend = nativeAvailable() ? c.green('native (Rust + HW SHA)') : c.dim('js (Node createHash)');
  console.log(c.bold('+ rpow bench'));
  console.log(`  cpu      : ${cpu}  (${os.cpus().length} logical cores)`);
  console.log(`  backend  : ${backend}`);
  console.log(`  workers  : ${flags.workers}  ${flags.workers === 1 ? '(single-thread)' : '(multi-core)'}`);
  console.log(`  seconds  : ${flags.seconds}`);
  console.log(`  bits     : ${flags.bits} ${flags.bits >= 40 ? c.dim('(unhittable in window — pure rate test)') : c.dim('(may complete early on a real hit)')}`);
  console.log();

  const abort = { aborted: false };
  const stopper = setTimeout(() => { abort.aborted = true; }, flags.seconds * 1000);
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    abort.aborted = true;
    progressDone();
    console.log(c.yellow('  ^C  stopping bench early...'));
  });

  // Random-ish but deterministic-per-run prefix; doesn't matter for benchmarking.
  const prefixHex = Buffer.from(`bench-${Date.now()}`).toString('hex').padEnd(32, '0').slice(0, 32);

  let lastHashes = 0n;
  let lastElapsed = 0;
  const t0 = performance.now();
  const result = await minePool(prefixHex, flags.bits, {
    workers: flags.workers,
    abortSignal: abort,
    onProgress: ({ hashes, elapsedMs }) => {
      lastHashes = hashes;
      lastElapsed = elapsedMs;
      progressLine(
        `  ${c.dim('hashing')}  hashes=${Number(hashes).toLocaleString()}` +
        `  rate=${fmtRate(hashes, elapsedMs)}` +
        `  elapsed=${fmtElapsed(elapsedMs)}`,
      );
    },
  });
  clearTimeout(stopper);
  progressDone();

  // If the bench finished without any progress message firing, fall back to wall-clock.
  if (lastElapsed === 0) lastElapsed = performance.now() - t0;

  console.log();
  console.log(c.bold('+ result'));
  console.log(`  hashes   : ${Number(lastHashes).toLocaleString()}`);
  console.log(`  elapsed  : ${fmtElapsed(lastElapsed)}`);
  console.log(`  rate     : ${c.green(fmtRate(lastHashes, lastElapsed))}`);
  if (result !== null) console.log(c.dim(`  (a real solution was found at nonce=${result.toString()} — try a higher --bits for a pure rate test)`));
}
