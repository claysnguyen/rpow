//! Native SHA-256 hashcash search loop.
//!
//! Hot loop runs entirely in Rust to avoid per-iteration JS↔C FFI overhead.
//! On aarch64 (Apple Silicon, modern ARM) the `sha2` crate uses ARMv8 SHA
//! crypto extensions for ~25 ns/block compression. On x86_64 with SHA-NI
//! the same applies.
//!
//! API: `hash_search(prefix, bits, start_hi, hi_step, max_iter)` — searches
//! up to `max_iter` nonces, returns `Some(nonce)` if a match was found or
//! `None` otherwise. The caller (Node side) calls this in a loop, batching
//! work and yielding to the event loop between calls so SIGINT can land.

#![deny(clippy::all)]

use napi::bindgen_prelude::{Buffer, Result};
use napi_derive::napi;
use sha2::{Digest, Sha256};

#[napi(object)]
pub struct SearchResult {
    /// `true` if a matching nonce was found within `max_iter`.
    pub found: bool,
    /// Found nonce (as bigint via two u32 halves: hi << 32 | lo).
    /// Only meaningful when `found == true`.
    pub nonce_hi: u32,
    pub nonce_lo: u32,
    /// Number of hashes computed in this call (always <= max_iter).
    pub hashes: u32,
    /// Last nonce halves probed (so the caller can resume where we stopped
    /// when found == false). Useful for chunked progress reporting.
    pub next_hi: u32,
    pub next_lo: u32,
}

/// Inline trailing-zero-bit checker matching `apps/cli/src/miner.ts`.
/// Returns true iff the SHA-256 digest has at least `bits` trailing zero bits.
#[inline(always)]
fn passes(digest: &[u8; 32], last_full_idx: usize, rem_mask: u8, rem_bits: u32) -> bool {
    // Check the last `full_bytes` bytes (positions 31, 30, ...) all zero.
    let mut i = 31usize;
    while i > last_full_idx {
        if digest[i] != 0 {
            return false;
        }
        i -= 1;
    }
    if rem_bits == 0 {
        return true;
    }
    (digest[last_full_idx] & rem_mask) == 0
}

#[napi]
pub fn hash_search(
    prefix: Buffer,
    bits: u32,
    start_hi: u32,
    hi_step: u32,
    start_lo: u32,
    max_iter: u32,
) -> Result<SearchResult> {
    let prefix_bytes: &[u8] = prefix.as_ref();

    // Precompute checker bookkeeping once.
    let bits_usize = bits as usize;
    let full_bytes = bits_usize / 8;
    let rem_bits = (bits_usize & 7) as u32;
    let rem_mask: u8 = if rem_bits == 0 { 0 } else { ((1u32 << rem_bits) - 1) as u8 };
    let last_full_idx = 31usize.saturating_sub(full_bytes);

    // Prefix never changes during this search call; pre-hash it once and clone
    // that state for each nonce candidate.
    let mut prefix_hasher = Sha256::new();
    prefix_hasher.update(prefix_bytes);
    let mut nonce_bytes = [0u8; 8];

    let mut hi: u32 = start_hi;
    let mut lo: u32 = start_lo;
    let hi_step = hi_step.max(1);

    let mut hashes: u32 = 0;

    while hashes < max_iter {
        // Write nonce (little-endian) into stack-allocated bytes.
        //
        // SAFETY:
        // - `nonce_bytes` is 8 bytes, so two u32 stores are always in bounds.
        // - `write_unaligned` handles alignment safely.
        unsafe {
            let p = nonce_bytes.as_mut_ptr() as *mut u32;
            p.write_unaligned(lo.to_le());
            p.add(1).write_unaligned(hi.to_le());
        }

        // SHA-256 of the full buffer. RustCrypto's sha2 uses the asm path
        // (ARMv8 SHA crypto extensions on Apple Silicon, SHA-NI on x86_64
        // when supported) for the compression function.
        let mut hasher = prefix_hasher.clone();
        hasher.update(&nonce_bytes);
        let digest_arr: [u8; 32] = hasher.finalize().into();

        hashes += 1;

        if passes(&digest_arr, last_full_idx, rem_mask, rem_bits) {
            return Ok(SearchResult {
                found: true,
                nonce_hi: hi,
                nonce_lo: lo,
                hashes,
                next_hi: hi,
                next_lo: lo,
            });
        }

        // Advance nonce: lo wraps every 2^32, then hi += hi_step.
        let (next_lo, lo_carry) = lo.overflowing_add(1);
        lo = next_lo;
        if lo_carry {
            hi = hi.wrapping_add(hi_step);
        }
    }

    Ok(SearchResult {
        found: false,
        nonce_hi: 0,
        nonce_lo: 0,
        hashes,
        next_hi: hi,
        next_lo: lo,
    })
}
