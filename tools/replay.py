import sys, os, json
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'repo')
sys.path.insert(0, os.path.join(REPO, 'sim'))
import flysim as F

params = json.load(open(os.path.join(REPO, 'contracts/data/params_v1_deployed.json')))
params['persistInput'] = False   # v1 dropped pending input
c = F.Circuit.load(os.path.join(REPO, 'contracts/data/circuit.hex'))
b = F.FlyBrain(c, params, energy=1_000_000)
print('genesis: N=%d S=%d' % (c.N, c.S))

r = b.tick(64)
print('tick(64)                 -> spikes total', b.totalSpikes, '(expect 0)')
b.energy += 10_000          # feed(10_000 ether) @ 1 ether/step
b.stimulate(F.CH_CUE, 4, 4)
r = b.tick(32)
print('stimulate(CUE,4,4)+tick  -> total', b.totalSpikes, '(expect 279)',
      'headX', b.headX, '(expect -2446)', 'headY', b.headY, '(expect 11821)',
      'pos', (b.posX, b.posY), '(expect -103, 501)')
b.tick(32)
print('tick(32)                 -> total', b.totalSpikes, '(expect 533)',
      'headX', b.headX, '(expect -835)', 'headY', b.headY, '(expect 11896)',
      'pos', (b.posX, b.posY), '(expect -138, 1011)')
b.tick(32)
print('tick(32)                 -> total', b.totalSpikes, '(expect 533)')
b.stimulate(F.CH_SHOCK, 0, 4)
b.tick(32)
print('stimulate(SHOCK)+tick    -> total', b.totalSpikes, '(expect 816)')
print('energy                   ->', b.energy, '(expect 1009808)')
