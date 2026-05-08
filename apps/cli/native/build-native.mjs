#!/usr/bin/env node
/**
 * Cross-platform build script for the Rust native miner.
 *
 * Runs `cargo build --release` with native CPU optimizations, then copies
 * the resulting platform-specific shared library into this directory with
 * the canonical `rpow_miner_native.<platform>-<arch>.node` name. The CLI
 * loader (apps/cli/src/miner-native.ts) picks it up automatically.
 *
 * Skips silently if `cargo` is not installed — the JS fallback handles that
 * case at runtime, so there is no hard requirement to have Rust available.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const platform = process.platform;
const arch = process.arch;
const dest = join(here, `rpow_miner_native.${platform}-${arch}.node`);

// Windows native build is intentionally not supported: most x86_64 Windows
// hardware lacks SHA-NI (or has it disabled by older OS configs), so the
// speedup over JS isn't worth the cross-compile / antivirus / signing
// hassle. Windows users get the JS fallback (or use WSL/Linux for native).
if (platform === 'win32') {
  console.log('[build-native] Windows is not a supported native target — CLI will use the JS fallback.');
  console.log('[build-native] For native speed on Windows, install WSL2 + Ubuntu and run there.');
  process.exit(0);
}

const cargoCheck = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
if (cargoCheck.status !== 0) {
  console.log('[build-native] cargo not found — skipping. CLI will use the JS fallback.');
  console.log('[build-native] install Rust from https://rustup.rs to enable the ~30x native miner.');
  process.exit(0);
}

console.log(`[build-native] building for ${platform}-${arch}...`);
const env = { ...process.env, RUSTFLAGS: process.env.RUSTFLAGS ?? '-C target-cpu=native' };
const build = spawnSync('cargo', ['build', '--release'], { cwd: here, stdio: 'inherit', env });
if (build.status !== 0) {
  console.error(`[build-native] cargo build failed (exit ${build.status}). Falling back to JS at runtime.`);
  process.exit(0);
}

const dylibName = (() => {
  switch (platform) {
    case 'darwin': return 'librpow_miner_native.dylib';
    case 'linux':  return 'librpow_miner_native.so';
    default:       return null;
  }
})();
if (!dylibName) {
  console.error(`[build-native] unsupported platform: ${platform}. Skipping copy.`);
  process.exit(0);
}

const src = join(here, 'target', 'release', dylibName);
if (!existsSync(src)) {
  console.error(`[build-native] expected ${src} but it's missing. Build may have failed silently.`);
  process.exit(0);
}

copyFileSync(src, dest);
console.log(`[build-native] OK: ${dest}`);
