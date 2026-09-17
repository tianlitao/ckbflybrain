import sys, os, json, struct, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'repo', 'sim'))
from Crypto.Hash import keccak
def kec(b):
    k = keccak.new(digest_bits=256); k.update(b); return k.hexdigest()

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'repo')
raw = open(os.path.join(REPO, 'contracts/data/circuit.hex')).read().strip()
print('circuit.hex prefix:', raw[:10], 'hexchars:', len(raw))
table = bytes.fromhex(raw[2:])
print('table bytes:', len(table))
print('keccak256(table) =', kec(table))
print('README/on-chain  = 0xffbe0e7f28e1f0dd2cfaa01d1d221c502bf41c1fd519ebfe8d9b8203e7cedfc2')
print('MATCH:', kec(table) == 'ffbe0e7f28e1f0dd2cfaa01d1d221c502bf41c1fd519ebfe8d9b8203e7cedfc2')

# decode table
N = table[1]; S = struct.unpack('>H', table[2:4])[0]
print('version', table[0], 'N', N, 'S', S)
o = 4
types = list(table[o:o+N]); o += N
wedge = list(table[o:o+N]); o += N
side  = list(table[o:o+N]); o += N
offs  = [struct.unpack('>H', table[o+2*i:o+2*i+2])[0] for i in range(N+1)]; o += 2*(N+1)
syn   = [(table[o+2*j], table[o+2*j+1]) for j in range(S)]; o += 2*S
root  = [struct.unpack('>Q', table[o+8*i:o+8*i+8])[0] for i in range(N)]
names = ['EPG','EPGt','PEG','PEN_a','PEN_b','Delta7']
from collections import Counter
print('cell types:', {names[t]: c for t, c in sorted(Counter(types).items())})
print('total synapse weight (sum of w):', sum(w for _, w in syn))
print('total out-degree:', S)
print('neurons with wedge:', sum(1 for w in wedge if w != 255), '/', N)
print('sides left/right:', side.count(0), side.count(1))
print('sample rootIds:', root[:3])
print('all rootIds nonzero:', all(r > 0 for r in root))
