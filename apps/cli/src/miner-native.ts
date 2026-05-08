/**
 * Optional Rust-native SHA-256 hashcash search loop.
 *
 * Loaded at runtime; if the platform-specific `.node` binary is missing
 * (other arch, not built yet, etc.) we return null and the caller falls
 * back to the pure-JS implementation in `miner.ts`. So the CLI runs
 * everywhere, and Apple Silicon / x86_64 SHA-NI users get the speedup
 * for free.
 *
 * Build the binary with:
 *   cd apps/cli/native && RUSTFLAGS="-C target-cpu=native" cargo build --release
 *   cp target/release/librpow_miner_native.dylib rpow_miner_native.<platform>-<arch>.node
 *
 * Speedup observed on M1 Pro: ~30x per core vs Node `createHash` (1.1 MH/s
 * -> 33 MH/s) thanks to ARMv8 SHA crypto extension and zero per-iteration
 * FFI/alloc overhead.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

export interface NativeSearchResult {
  found: boolean;
  nonceHi: number;
  nonceLo: number;
  hashes: number;
  nextHi: number;
  nextLo: number;
}

export interface NativeBinding {
  hashSearch(
    prefix: Buffer,
    bits: number,
    startHi: number,
    hiStep: number,
    startLo: number,
    maxIter: number,
  ): NativeSearchResult;
}

let cached: NativeBinding | null | undefined;

function platformTag(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * Returns the native binding if available, else null.
 * Caches the result so we only attempt loading once per process.
 */
export function loadNativeMiner(): NativeBinding | null {
  if (cached !== undefined) return cached;

  // dist/miner-native.js -> dist/ -> ../native/<file>
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Compiled position: apps/cli/dist/ -> ../native/
    join(here, '..', 'native', `rpow_miner_native.${platformTag()}.node`),
    // Source position (ts-node / vitest): apps/cli/src/ -> ../native/
    join(here, '..', 'native', `rpow_miner_native.${platformTag()}.node`),
  ];

  const req = createRequire(import.meta.url);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const mod = req(p) as NativeBinding;
      if (typeof mod.hashSearch === 'function') {
        cached = mod;
        return cached;
      }
    } catch {
      // continue trying
    }
  }
  cached = null;
  return cached;
}

export function nativeAvailable(): boolean {
  return loadNativeMiner() !== null;
}
