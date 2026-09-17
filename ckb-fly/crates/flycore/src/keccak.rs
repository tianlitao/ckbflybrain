//! Keccak-256 (original Keccak padding `0x01`), the hash the BSC contract uses
//! as its noise source: `keccak256(abi.encodePacked(uint64 step))`.
//!
//! Kept bit-exact with `FlyBrain.sol` so the port can be validated against the
//! mainnet differential test. See `docs/noise.md` for the cheaper alternative
//! (CKB's native blake2b syscall) and the re-calibration it requires.

const RATE: usize = 136; // 1088 bits
const RC: [u64; 24] = [
    0x0000_0000_0000_0001,
    0x0000_0000_0000_8082,
    0x8000_0000_0000_808a,
    0x8000_0000_8000_8000,
    0x0000_0000_0000_808b,
    0x0000_0000_8000_0001,
    0x8000_0000_8000_8081,
    0x8000_0000_0000_8009,
    0x0000_0000_0000_008a,
    0x0000_0000_0000_0088,
    0x0000_0000_8000_8009,
    0x0000_0000_8000_000a,
    0x0000_0000_8000_808b,
    0x8000_0000_0000_008b,
    0x8000_0000_0000_8089,
    0x8000_0000_0000_8003,
    0x8000_0000_0000_8002,
    0x8000_0000_0000_0080,
    0x0000_0000_0000_800a,
    0x8000_0000_8000_000a,
    0x8000_0000_8000_8081,
    0x8000_0000_0000_8080,
    0x0000_0000_8000_0001,
    0x8000_0000_8000_8008,
];

/// Rotation offsets, indexed by lane `x + 5*y`.
const RHO: [u32; 25] = [
    0, 1, 62, 28, 27, //
    36, 44, 6, 55, 20, //
    3, 10, 43, 25, 39, //
    41, 45, 15, 21, 8, //
    18, 2, 61, 56, 14, //
];

fn keccak_f(a: &mut [u64; 25]) {
    for &rc in RC.iter() {
        // theta
        let mut c = [0u64; 5];
        for x in 0..5 {
            c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
        }
        let mut d = [0u64; 5];
        for x in 0..5 {
            d[x] = c[(x + 4) % 5] ^ c[(x + 1) % 5].rotate_left(1);
        }
        for y in 0..5 {
            for x in 0..5 {
                a[x + 5 * y] ^= d[x];
            }
        }
        // rho + pi: B[y][2x+3y] = rot(A[x][y], RHO[x+5y])
        let mut b = [0u64; 25];
        for y in 0..5 {
            for x in 0..5 {
                b[y + 5 * ((2 * x + 3 * y) % 5)] = a[x + 5 * y].rotate_left(RHO[x + 5 * y]);
            }
        }
        // chi
        for y in 0..5 {
            for x in 0..5 {
                a[x + 5 * y] = b[x + 5 * y] ^ ((!b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y]);
            }
        }
        // iota
        a[0] ^= rc;
    }
}

fn absorb(state: &mut [u64; 25], block: &[u8]) {
    for i in 0..RATE / 8 {
        let mut w = [0u8; 8];
        w.copy_from_slice(&block[i * 8..i * 8 + 8]);
        state[i] ^= u64::from_le_bytes(w);
    }
}

/// Keccak-256 of `data`.
///
/// Uses the original Keccak padding (`0x01`), not SHA-3's (`0x06`), because that is what
/// the EVM's `KECCAK256` opcode implements and therefore what `FlyBrain.sol`'s noise
/// depends on.
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut state = [0u64; 25];

    // Absorb whole blocks; the trailing partial block gets padded below.
    let mut off = 0;
    while data.len() - off >= RATE {
        absorb(&mut state, &data[off..off + RATE]);
        keccak_f(&mut state);
        off += RATE;
    }

    // Padding: 0x01, zero fill, 0x80 in the last byte of the block.
    let rem = &data[off..];
    let mut block = [0u8; RATE];
    block[..rem.len()].copy_from_slice(rem);
    block[rem.len()] = 0x01;
    block[RATE - 1] |= 0x80;
    absorb(&mut state, &block);
    keccak_f(&mut state);

    // Squeeze the first 256 bits, little-endian per lane.
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[i * 8..i * 8 + 8].copy_from_slice(&state[i].to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::keccak256;

    fn hex(b: &[u8]) -> std::string::String {
        b.iter().map(|x| std::format!("{x:02x}")).collect()
    }

    #[test]
    fn empty() {
        assert_eq!(
            hex(&keccak256(b"")),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn known_vectors() {
        // keccak256("abc")
        assert_eq!(
            hex(&keccak256(b"abc")),
            "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
        );
        // keccak256(abi.encodePacked(uint64(0))) = keccak256 of 8 zero bytes.
        // This is the step-0 noise seed FlyBrain.sol derives for every organism.
        assert_eq!(
            hex(&keccak256(&0u64.to_be_bytes())),
            "011b4d03dd8c01f1049143cf9c4c817e4b167f1d1b83e5c6f0f10d89ba1e7bce"
        );
        // keccak256(abi.encodePacked(uint64(1))) — the step-1 seed.
        assert_eq!(
            hex(&keccak256(&1u64.to_be_bytes())),
            "6c31fc15422ebad28aaf9089c306702f67540b53c7eea8b7d2941044b027100f"
        );
    }

    #[test]
    fn distinguishes_packed_from_padded() {
        // The contract uses `abi.encodePacked(uint64)`, i.e. 8 bytes — not the 32-byte
        // ABI-padded form. Confusing the two is the easiest way to silently break
        // reproducibility, so pin both values.
        assert_eq!(
            hex(&keccak256(&[0u8; 32])),
            "290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563"
        );
        assert_ne!(keccak256(&[0u8; 8]), keccak256(&[0u8; 32]));
    }
}
