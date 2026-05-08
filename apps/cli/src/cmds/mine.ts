import { ApiClient, isApiError, type ApiError } from '../api.js';
import { defaultWorkers, defaultWorkersNative, minePool } from '../miner-pool.js';
import { nativeAvailable } from '../miner-native.js';
import { c, die, fmtElapsed, fmtRate, progressDone, progressLine } from '../ui.js';

interface MineFlags {
  count: number | null; // null = forever
  workers: number;
}

function parseFlags(args: string[]): MineFlags {
  let count: number | null = 1;
  let forever = false;
  let workers = nativeAvailable() ? defaultWorkersNative() : defaultWorkers();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--forever' || a === '-f') { forever = true; continue; }
    if (a === '--count' || a === '-n') {
      const v = args[++i];
      if (!v || !/^\d+$/.test(v)) die('--count requires a positive integer');
      count = parseInt(v, 10);
      continue;
    }
    if (a === '--workers' || a === '-w') {
      const v = args[++i];
      if (!v || !/^\d+$/.test(v)) die('--workers requires a positive integer');
      workers = parseInt(v, 10);
      if (workers < 1) die('--workers must be >= 1');
      continue;
    }
    die(`unknown flag: ${a}`);
  }
  if (forever) count = null;
  return { count, workers };
}

// Aggressive retry: prioritize mining uptime over being polite to the server.
// Schedule (with ±30% jitter): 1s, 2s, 2s, 2s, ... so worst-case recovery latency
// after an outage is ~2-3s. Trade-off: ~30 req/min on /challenge during outages.
const MAX_BACKOFF_MS = 2_000;
const BASE_BACKOFF_MS = 1_000;

interface AbortSignal { aborted: boolean }

async function abortableSleep(ms: number, abort: AbortSignal): Promise<void> {
  const startedAt = Date.now();
  while (!abort.aborted && Date.now() - startedAt < ms) {
    const remaining = ms - (Date.now() - startedAt);
    await new Promise<void>((r) => setTimeout(r, Math.min(200, remaining)));
  }
}

function backoffFor(attempt: number, e: unknown): number {
  // RATE_LIMITED: trust the server's retry_after fully — undercutting it gets us
  // banned. Only apply a small floor (250ms) to avoid a 0-second tight loop.
  if (isApiError(e) && e.error === 'RATE_LIMITED' && typeof e.retry_after === 'number') {
    return Math.max(250, e.retry_after * 1000);
  }
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.min(attempt - 1, 5)));
  // ±30% jitter so multiple clients on the same machine don't sync their probes.
  return Math.floor(base * (0.7 + Math.random() * 0.6));
}

function describe(e: unknown): string {
  if (isApiError(e)) return `${e.error}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Run `fn` and retry on transient errors (network, 5xx, RATE_LIMITED) with
 * exponential backoff. Aborts cleanly if `abort.aborted` becomes true. Returns
 * null on abort. Throws fatal errors as-is.
 */
async function callWithRetry<T>(
  label: string,
  abort: AbortSignal,
  isFatal: (e: unknown) => boolean,
  fn: () => Promise<T>,
): Promise<T | null> {
  let attempt = 0;
  while (!abort.aborted) {
    try {
      return await fn();
    } catch (e) {
      if (isFatal(e)) throw e;
      attempt++;
      const delay = backoffFor(attempt, e);
      // Throttle: log attempts 1-3 in full, then once every 10 retries to keep
      // the console readable during multi-minute outages.
      if (attempt <= 3 || attempt % 10 === 0) {
        const sec = (delay / 1000).toFixed(delay < 1000 ? 2 : 1);
        console.log(c.yellow(`  ${label} transient: ${describe(e)} — retry in ${sec}s (#${attempt})`));
      }
      await abortableSleep(delay, abort);
    }
  }
  return null;
}

const FATAL_API_ERRORS = new Set([
  'SUPPLY_EXHAUSTED',     // 21M cap reached
  'INVALID_SOLUTION',     // shouldn't happen but bail out
  'UNAUTHORIZED',
]);

function isFatalForChallenge(e: unknown): boolean {
  if (!isApiError(e)) return false;
  if (FATAL_API_ERRORS.has(e.error)) return true;
  if (e.status === 401) return true;
  return false;
}

function isFatalForMint(e: unknown): boolean {
  if (!isApiError(e)) return false;
  if (FATAL_API_ERRORS.has(e.error)) return true;
  if (e.status === 401) return true;
  // CHALLENGE_EXPIRED / CHALLENGE_ALREADY_CLAIMED are signals, not crashes:
  // we want to handle them in the loop, not via the retry layer. Mark as fatal
  // here so the retry wrapper rethrows; the loop catches them explicitly.
  if (e.error === 'CHALLENGE_EXPIRED') return true;
  if (e.error === 'CHALLENGE_ALREADY_CLAIMED') return true;
  return false;
}

export async function mineCmd(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const api = await ApiClient.create();
  if (!api.sessionToken) die('not signed in. run: rpow login <email>');

  const abort: AbortSignal = { aborted: false };
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    abort.aborted = true;
    progressDone();
    console.log(c.yellow('  ^C  finishing current attempt cleanly... press again to force-quit'));
  });

  let mined = 0;
  const target = flags.count;
  const backend = nativeAvailable() ? 'native' : 'js';
  console.log(c.dim(`[ workers=${flags.workers} backend=${backend} ${flags.workers === 1 ? '(single-thread)' : '(multi-core)'} ]`));

  while ((target === null || mined < target) && !abort.aborted) {
    // 1. Get a challenge (with transient retry).
    let ch;
    try {
      ch = await callWithRetry('challenge', abort, isFatalForChallenge, () => api.challenge());
    } catch (e) {
      if (isApiError(e)) {
        if (e.error === 'SUPPLY_EXHAUSTED') { console.log(c.red('+ SUPPLY EXHAUSTED — 21M cap reached')); return; }
        if (e.status === 401) die('session expired. run: rpow login <email>');
        die(`${e.error}: ${e.message}`);
      }
      throw e;
    }
    if (!ch) break; // aborted during retry sleep
    console.log(c.dim(`[ challenge ${ch.challenge_id.slice(0, 8)}... target ${ch.difficulty_bits} bits ]`));

    // 2. Mine.
    const nonce = await minePool(ch.nonce_prefix, ch.difficulty_bits, {
      workers: flags.workers,
      abortSignal: abort,
      onProgress: ({ hashes, elapsedMs }) => {
        progressLine(
          `  ${c.dim('mining')}  hashes=${Number(hashes).toLocaleString()}` +
          `  rate=${fmtRate(hashes, elapsedMs)}` +
          `  elapsed=${fmtElapsed(elapsedMs)}`,
        );
      },
    });
    progressDone();

    if (nonce === null) {
      console.log(c.yellow(`+ aborted after ${mined} mints`));
      return;
    }

    // 3. Submit.
    let mintAttempt = 0;
    try {
      const r = await callWithRetry('mint', abort, isFatalForMint, async () => {
        mintAttempt++;
        try {
          return await api.mint({ challenge_id: ch.challenge_id, solution_nonce: nonce.toString() });
        } catch (e) {
          // If a prior submit succeeded server-side but the response was lost
          // (network blip), the retry surfaces CHALLENGE_ALREADY_CLAIMED. Treat
          // that as success — the token IS in our wallet.
          if (mintAttempt > 1 && isApiError(e) && (e as ApiError).error === 'CHALLENGE_ALREADY_CLAIMED') {
            return { token: { id: '(claimed earlier, response lost)', value: 1, issued_at: new Date().toISOString() } };
          }
          throw e;
        }
      });
      if (!r) break; // aborted
      mined++;
      console.log(c.green('+ MINTED ') + ` token=${r.token.id}  ${c.dim(`(#${mined}${target ? '/' + target : ''})`)}`);
    } catch (e) {
      if (isApiError(e)) {
        if (e.error === 'SUPPLY_EXHAUSTED') { console.log(c.red('+ SUPPLY EXHAUSTED — 21M cap reached')); return; }
        if (e.status === 401) die('session expired. run: rpow login <email>');
        if (e.error === 'CHALLENGE_EXPIRED') {
          console.log(c.yellow('  challenge expired before submission, requesting a fresh one'));
          continue;
        }
        if (e.error === 'CHALLENGE_ALREADY_CLAIMED') {
          // Very rare race or we already counted it — skip silently rather than die.
          console.log(c.dim('  challenge already claimed (race), skipping'));
          continue;
        }
        if (e.error === 'INVALID_SOLUTION') {
          // Server rejected our hash — should never happen with our miner. Log and bail.
          die(`INVALID_SOLUTION: server rejected the hash. report this with challenge=${ch.challenge_id}`);
        }
        die(`${e.error}: ${e.message}`);
      }
      throw e;
    }
  }
  console.log(c.dim(`done. minted ${mined} token(s).`));
}
