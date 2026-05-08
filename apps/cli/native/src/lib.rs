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
use sha2::digest::{generic_array::GenericArray, typenum::U64};
use sha2::{compress256, Digest, Sha256};

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
fn passes(
    digest: &[u8],
    fast64: bool,
    fast_mask: u64,
    last_full_idx: usize,
    rem_mask: u8,
    rem_bits: u32,
) -> bool {
    if fast64 {
        return passes_fast64(digest, fast_mask);
    }
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

#[inline(always)]
fn passes_fast64(digest: &[u8], fast_mask: u64) -> bool {
    // SAFETY:
    // - `digest` has 32 bytes, reading 8 bytes at offset 24 is in bounds.
    // - `read_unaligned` is valid regardless of alignment.
    let tail = u64::from_le(unsafe {
        (digest.as_ptr().add(24) as *const u64).read_unaligned()
    });
    (tail & fast_mask) == 0
}

#[inline(always)]
fn passes_fast64_state(state: &[u32; 8], fast_mask: u64) -> bool {
    // SHA-256 digest bytes are big-endian words h0..h7. Tail bytes are h6||h7.
    // Build the 64-bit big-endian word then byte-swap to match our LE bit test.
    let tail = (((state[6] as u64) << 32) | (state[7] as u64)).swap_bytes();
    (tail & fast_mask) == 0
}

#[inline(always)]
fn write_nonce_u64_le(dst: &mut [u8], offset: usize, hi: u32, lo: u32) {
    let nonce = ((hi as u64) << 32) | (lo as u64);
    // SAFETY:
    // - caller ensures [offset..offset+8] is in-bounds.
    // - write_unaligned handles alignment safely.
    unsafe {
        (dst.as_mut_ptr().add(offset) as *mut u64).write_unaligned(nonce.to_le());
    }
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
    let prefix_len = prefix_bytes.len();

    // Precompute checker bookkeeping once.
    let bits_usize = bits as usize;
    let full_bytes = bits_usize / 8;
    let rem_bits = (bits_usize & 7) as u32;
    let rem_mask: u8 = if rem_bits == 0 { 0 } else { ((1u32 << rem_bits) - 1) as u8 };
    let last_full_idx = 31usize.saturating_sub(full_bytes);
    let fast64 = bits <= 64;
    let fast_mask: u64 = if bits == 0 {
        0
    } else if bits >= 64 {
        u64::MAX
    } else {
        (1u64 << bits) - 1
    };

    // Prefix never changes during this search call; pre-hash it once and clone
    // that state for each nonce candidate.
    let mut prefix_hasher = Sha256::new();
    prefix_hasher.update(prefix_bytes);
    let mut nonce_bytes = [0u8; 8];

    let mut hi: u32 = start_hi;
    let mut lo: u32 = start_lo;
    let hi_step = hi_step.max(1);

    let mut hashes: u32 = 0;

    // Deep fast-path: one-block SHA-256 via raw compression API.
    // Applies when total message fits in one block and difficulty check uses
    // only the last 64 digest bits.
    if fast64 && prefix_len + 8 <= 55 {
        let msg_len = prefix_len + 8;
        let mut block = [0u8; 64];
        block[..prefix_len].copy_from_slice(prefix_bytes);
        block[msg_len] = 0x80;
        let bit_len = (msg_len as u64) * 8;
        block[56..64].copy_from_slice(&bit_len.to_be_bytes());
        let nonce_offset = prefix_len;
        // SAFETY: GenericArray<u8, U64> and [u8; 64] share layout.
        let blocks: &mut [GenericArray<u8, U64>; 1] = unsafe {
            &mut *(&mut block as *mut [u8; 64] as *mut [GenericArray<u8, U64>; 1])
        };

        while hashes < max_iter {
            write_nonce_u64_le(&mut block, nonce_offset, hi, lo);

            // SHA-256 IV
            let mut state: [u32; 8] = [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
            ];

            compress256(&mut state, blocks.as_slice());

            hashes += 1;
            if passes_fast64_state(&state, fast_mask) {
                return Ok(SearchResult {
                    found: true,
                    nonce_hi: hi,
                    nonce_lo: lo,
                    hashes,
                    next_hi: hi,
                    next_lo: lo,
                });
            }

            let (next_lo, lo_carry) = lo.overflowing_add(1);
            lo = next_lo;
            if lo_carry {
                hi = hi.wrapping_add(hi_step);
            }
        }

        return Ok(SearchResult {
            found: false,
            nonce_hi: 0,
            nonce_lo: 0,
            hashes,
            next_hi: hi,
            next_lo: lo,
        });
    }

    // Deep fast-path (2 blocks): same compress-level approach for longer inputs
    // that still fit in 2 SHA-256 blocks.
    if fast64 && prefix_len + 8 <= 119 {
        let msg_len = prefix_len + 8;
        let mut blocks_buf = [0u8; 128];
        blocks_buf[..prefix_len].copy_from_slice(prefix_bytes);
        blocks_buf[msg_len] = 0x80;
        let bit_len = (msg_len as u64) * 8;
        blocks_buf[120..128].copy_from_slice(&bit_len.to_be_bytes());
        let nonce_offset = prefix_len;
        // SAFETY: GenericArray<u8, U64> and [u8; 64] share layout.
        let blocks: &mut [GenericArray<u8, U64>; 2] = unsafe {
            &mut *(&mut blocks_buf as *mut [u8; 128] as *mut [GenericArray<u8, U64>; 2])
        };

        while hashes < max_iter {
            write_nonce_u64_le(&mut blocks_buf, nonce_offset, hi, lo);

            // SHA-256 IV
            let mut state: [u32; 8] = [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
            ];

            compress256(&mut state, blocks.as_slice());

            hashes += 1;
            if passes_fast64_state(&state, fast_mask) {
                return Ok(SearchResult {
                    found: true,
                    nonce_hi: hi,
                    nonce_lo: lo,
                    hashes,
                    next_hi: hi,
                    next_lo: lo,
                });
            }

            let (next_lo, lo_carry) = lo.overflowing_add(1);
            lo = next_lo;
            if lo_carry {
                hi = hi.wrapping_add(hi_step);
            }
        }

        return Ok(SearchResult {
            found: false,
            nonce_hi: 0,
            nonce_lo: 0,
            hashes,
            next_hi: hi,
            next_lo: lo,
        });
    }

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
        let digest = hasher.finalize();

        hashes += 1;

        if passes(digest.as_slice(), fast64, fast_mask, last_full_idx, rem_mask, rem_bits) {
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
