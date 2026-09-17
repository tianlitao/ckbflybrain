MASK = (1 << 64) - 1
RC = [0x0000000000000001,0x0000000000008082,0x800000000000808A,0x8000000080008000,
      0x000000000000808B,0x0000000080000001,0x8000000080008081,0x8000000000008009,
      0x000000000000008A,0x0000000000000088,0x0000000080008009,0x000000008000000A,
      0x000000008000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,
      0x8000000000008002,0x8000000000000080,0x000000000000800A,0x800000008000000A,
      0x8000000080008081,0x8000000000008080,0x0000000080000001,0x8000000080008008]
ROT = [[0,1,62,28,27],[36,44,6,55,20],[3,10,43,25,39],[41,45,15,21,8],[18,2,61,56,14]]

def rol(x, n):
    n %= 64
    return ((x << n) | (x >> (64 - n))) & MASK

def keccak_f(A):
    for rnd in range(24):
        C = [A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4] for x in range(5)]
        D = [C[(x-1) % 5] ^ rol(C[(x+1) % 5], 1) for x in range(5)]
        for x in range(5):
            for y in range(5):
                A[x][y] ^= D[x]
        B = [[0]*5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                B[y][(2*x + 3*y) % 5] = rol(A[x][y], ROT[y][x])
        for x in range(5):
            for y in range(5):
                A[x][y] = B[x][y] ^ ((~B[(x+1) % 5][y]) & B[(x+2) % 5][y]) & MASK
        A[0][0] ^= RC[rnd]
    return A

def keccak256(data: bytes) -> bytes:
    rate = 136
    data = bytearray(data) + b"\x01"
    while len(data) % rate != 0:
        data += b"\x00"
    data[-1] ^= 0x80
    A = [[0]*5 for _ in range(5)]
    for off in range(0, len(data), rate):
        block = data[off:off+rate]
        for i in range(rate // 8):
            lane = int.from_bytes(block[i*8:(i+1)*8], "little")
            A[i % 5][i // 5] ^= lane
        keccak_f(A)
    out = b""
    for i in range(4):
        out += A[i % 5][i // 5].to_bytes(8, "little")
    return out

def selector(sig: str) -> str:
    return "0x" + keccak256(sig.encode()).hex()[:8]

if __name__ == "__main__":
    import sys
    # sanity check
    assert keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    print("keccak self-test OK")
    for s in sys.argv[1:]:
        print(selector(s), s)
