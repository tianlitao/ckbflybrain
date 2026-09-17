// public/i18n.source.js
var EN = {
  "doc.title": "CKB Fly \u2014 a fruit fly on Nervos CKB",
  "lang.name": "English",
  "lang.other": "\u4E2D\u6587",
  "app.name": "CKB Fly",
  // Every caption that runs to more than one sentence opens with a `<strong>` lead: the sentence
  // that says what the panel *is*. Rendered through `data-i18n-html` rather than `data-i18n`
  // because of it — see the note in `i18n-dom.source.js`. The point is that a reader can find out
  // whether they need to read the paragraph without reading it.
  "app.standfirst": "<strong>A Drosophila head-direction ring attractor \u2014 155 neurons, 6,522 connections \u2014 running as an organism on Nervos CKB.</strong> The fly is a cell: every tick consumes it and creates its successor, and the type script refuses anything that is not the exact result of the action the witness declares.",
  "world.heading": "The world",
  "world.countOne": "1 organism on this chain",
  "world.count": "{n} organisms on this chain",
  "world.caption": "<strong>Every organism on this chain, found by asking for cells that wear the flybrain code.</strong> Each fly has a different type script, so there is no single script to look up. The eight-byte instance in the args is what makes two flies with the same genome two organisms \u2014 without it this list would have one row. Click a row to watch that one.",
  "ring.heading": "The ring",
  "ring.headingAtStep": "The ring at step {step}",
  "ring.caption": "<strong>The outer ring is the sixteen wedges of the ellipsoid body, numbered 0\u201315; the cells inside it are \u03947, which have no wedge.</strong> One dot is one neuron: its colour is its membrane potential \u2014 warm is depolarised or just fired, cool is hyperpolarised, grey is at rest \u2014 and its size follows how far from rest it is. The orange arcs outside are that wedge's heading memory, the filled sector is the wedge the fly is pointing at now, and the arrow in the middle is the ring's population vector, which is the direction the fly walks along.",
  "ring.innerRing": "\u03947 \xB7 {n} cells, no wedge",
  "ring.noHeading": "no heading \u2014 the bump is collapsed",
  "ring.unpin": "return to live",
  "life.heading": "Life",
  "life.step": "step",
  "life.energy": "energy",
  "life.stepsOfLife": "{n} steps of life",
  "life.alive": "alive",
  "life.yes": "yes",
  "life.dead": "no \u2014 only resurrect is meaningful",
  "life.generation": "generation",
  "life.spikes": "spikes",
  "life.spikesThisLife": "{total} (this life: {life})",
  "life.bornBlock": "born block",
  "life.stimulus": "stimulus",
  // Not `life.heading`: that is the panel's own title. The two were one key on the first draft,
  // and the second definition silently won — the panel was headed "heading" in English and
  // "朝向" in Chinese, which looked like a styling oddity rather than a lost string.
  "life.orientation": "heading",
  "backing.heading": "Backing",
  "backing.caption": "<strong>The fly has no token.</strong> Its capacity <em>is</em> its body and its remaining life, and the two sides of this ledger have to be equal \u2014 the type script compares them.",
  "backing.perStep": "backing / step",
  "backing.shannons": "{n} shannons",
  "backing.body": "body",
  "backing.life": "life",
  "backing.required": "required",
  "backing.held": "held",
  "backing.notLiveCell": "\u2014 (not the live cell)",
  "chronicle.heading": "Chronicle",
  "chronicle.caption": "<strong>A second type script, <code>flyworld</code>, keeps this record \u2014 in the same transaction as the transition it describes.</strong> It is not told what the fly did: it is required to look at the fly, which must be present, and to record exactly what it finds. Nothing here was supplied by whoever sent the transaction, and the cell's own capacity never changes, so it cannot be used to hide value either.",
  "chronicle.record": "record",
  "chronicle.none": "none \u2014 this fly was deployed before the chronicle existed",
  "chronicle.life": "life",
  "chronicle.alive": "alive",
  "chronicle.dead": "dead \u2014 only resurrect is meaningful",
  "chronicle.generation": "generation",
  "chronicle.bornAtStep": "born at step",
  "chronicle.diedAtStep": "died at step",
  "chronicle.lastSighting": "last sighting",
  "chronicle.lastSightingValue": "step {step}, energy {energy}",
  "chronicle.sightings": "sightings",
  "chronicle.fed": "fed",
  "chronicle.released": "released",
  "chronicle.net": "net",
  "chronicle.stateHash": "state hash",
  "walk.heading": "Walk",
  "walk.caption": "Where the fly has been, in 1/256th of a cell.",
  "walk.captionAt": "At ({x}, {y}) in 1/256th of a cell. {n} earlier positions are on the path.",
  "identity.typeScript": "type script",
  "identity.params": "params",
  "identity.economics": "economics",
  "identity.connectome": "connectome",
  "identity.neurons": "neurons",
  "identity.neuronsValue": "{n} \xB7 {wedges} wedges",
  "identity.chain": "chain",
  "roster.step": "step {n}",
  "roster.life": "{state} \xB7 gen {generation}",
  "roster.alive": "alive",
  "roster.dead": "dead",
  "roster.spikes": "{n} sp",
  "roster.sightings": "{n} sightings",
  "roster.noChronicle": "no chronicle",
  "roster.key": "yours",
  "roster.keyTitle": "your wallet can advance this organism",
  "stimulus.none": "none",
  "stimulus.cue": "cue",
  "stimulus.turnLeft": "turn left",
  "stimulus.turnRight": "turn right",
  "stimulus.shock": "shock",
  "stimulus.active": "{name}, strength {strength}, until step {until}",
  "action.genesis": "genesis",
  "action.genesisDetail": "no fly consumed \u2014 a new organism",
  "action.tick": "tick",
  "action.tickDetail": "{n} steps",
  "action.stimulate": "stimulate",
  "action.stimulateDetail": "{name}, param {param}, strength {strength}, {n} steps",
  "action.feed": "feed",
  "action.feedDetail": "{n} steps of life bought",
  "action.resurrect": "resurrect",
  "action.resurrectDetail": "{n} steps, born block {block}",
  "timeline.heading": "Life so far",
  "timeline.caption": "<strong>CKB has no event log, and this is not one.</strong> It is the fly's chain of state cells, walked backwards from the current one, with each action read out of the witness the type script validated. Nothing here was emitted, and nothing here can be edited.",
  "timeline.block": "block {n}",
  "timeline.step": "step {n}",
  "wallet.heading": "Wallet",
  "wallet.address": "address",
  "wallet.none": "\u2014",
  "wallet.wallet": "wallet",
  "wallet.connectOpen": "Connect a wallet",
  "wallet.disconnect": "disconnect",
  "wallet.connected": "connected {address}\u2026",
  "wallet.noteConnected": "<strong>Clicks in the Drive panel are signed by this wallet and paid for from its balance.</strong> The transaction is built here, in this tab: the successor state is computed by <code>flywasm</code>, which is the validator's own simulation compiled for the browser. There is no server behind this page, and no key in it but yours.",
  "wallet.noteOffered": "<strong>Open the wallet list from the button at the top right.</strong> That is CCC's own connector, so it offers every wallet CCC supports \u2014 one that is not installed will say so when you pick it. Once connected it pays for and signs a state transition; this page never sees the key.",
  "drive.heading": "Drive",
  "drive.tick": "tick {n}",
  "drive.feed": "feed {n}",
  "drive.cue": "cue, wedge {wedge}",
  "drive.shock": "shock",
  "drive.turnLeft": "turn left",
  "drive.turnRight": "turn right",
  "drive.resurrect": "resurrect",
  "drive.subTurn": "spends {n} steps",
  "drive.subResurrect": "buys {n} steps of life",
  "drive.noteDead": "<strong>The fly is dead, and only resurrection is possible.</strong> Its life ran to zero, so every other move here is refused before it is built \u2014 the type script will not run a dead organism. Resurrecting starts a new life and increments its generation.",
  // The second line of each card: what the click costs the fly. `tick 64` and `tick 32` are one
  // digit apart and differ by twice the life, and the only place that difference can be said is
  // under the label. `{ckb}` on the feed card is computed from `economics.backingPerStep` rather
  // than written in, so the two numbers cannot drift apart.
  "drive.lifeLeft": "{n} steps of life left",
  "drive.subTick": "spends {n} steps of life",
  "drive.subFeed": "adds {n} steps of life \xB7 +{ckb} CKB",
  "drive.subCue": "holds a landmark \xB7 spends {n} steps",
  "drive.subShock": "an aversive pulse \xB7 spends {n} steps",
  // Two sentences explain why these buttons work, and both carry markup because they open with a
  // bold lead like every caption on the page. `drive.disabled` is the exception and is named for a
  // reason: it interpolates the refusal the click will be met with, and a computed string goes in
  // as *text*, never as markup.
  "drive.noteWallet": "<strong>Enabled: your wallet signs and pays.</strong> The transaction is built here, in this tab \u2014 the successor state is computed by <code>flywasm</code>, the validator's own simulation compiled for the browser \u2014 and your wallet only pays the fee and signs.",
  "drive.noteConnect": "<strong>Disabled: nothing on this page can sign.</strong> There is no server behind it and no key of its own \u2014 connect a wallet (top right) and these buttons light up if it is the right key for this organism.",
  "drive.disabled": "Disabled: {reason}",
  "drive.asking": "asking your wallet to sign {kind}\u2026",
  "drive.sent": "sent {tx} \u2014 signed and paid by your wallet; the next poll shows what the chain made of it",
  "status.connecting": "connecting\u2026",
  "status.read": "{n} transitions read from the chain \xB7 updated {time}",
  "status.nodeError": "the node reported: {error}",
  "status.watching": "watching {instance} ({hash}\u2026)",
  "status.cannotLoad": "cannot load {tx}",
  // ---------------------------------------------------------------- the other pages
  //
  // Two pages that are nothing but prose, and they carry their text here for the same reason
  // everything else does: one dictionary, checked against its twin by `test/i18n.test.js`. A
  // second page with its own strings written into its own HTML is a page that silently stops
  // being translated the first time somebody edits one of them.
  "nav.home": "the fly",
  "nav.about": "what this is",
  "nav.guide": "how to read it",
  "doc.titleAbout": "CKB Fly \u2014 what this is",
  "doc.titleGuide": "CKB Fly \u2014 how to read the page",
  "about.title": "What this is",
  "about.lead": "<strong>One fruit fly's head-direction circuit, running as an organism on Nervos CKB \u2014 155 neurons, 6,522 connections and 45,961 synapses, taken from the FlyWire release 783 connectome.</strong> It is not a simulation of a fly wearing a wallet, and it is not a token: the fly is a cell on a chain, and everything it does is recomputed by the chain.",
  "about.why.heading": "Why a ring attractor",
  "about.why.body": "The fly keeps its heading with a ring of neurons in the ellipsoid body. A bump of activity sits somewhere on that ring, and where the bump is *is* which way the fly is facing: a landmark pulls it one way, a turn pushes it the other, and the population vector of the ring \u2014 the arrow in the middle of the drawing \u2014 is the direction the fly then walks in. It is one of the few circuits in any brain whose output is a single number with a physical meaning, which is why this is the circuit that went on chain.",
  "about.exact.heading": "The port is bit-exact, and that is the point",
  "about.exact.body": "This runs the same circuit as <code>MidTermDev/immortal-fruit-fly</code>, which runs it in Solidity on BNB Smart Chain. The port does not approximate it: given the same actions it produces the same 155 membrane potentials, the same engram values, the same pending-input accumulators and the same 16 heading bins. That is checked against a fixture generated by driving the <em>upstream</em> code through the real action sequence the BSC contract executed on mainnet, and then replayed again inside CKB-VM, so the compiled contract the validators run is checked too. A port that merely looked right would be a different animal wearing the same name.",
  "about.cell.heading": "Why CKB, and why there is no token",
  "about.cell.body": "On the EVM the fly's state lives in storage slots, and every step pays for every slot it rewrites. Here the whole state is one cell of 1,213 bytes: a step consumes it and creates its successor, and the script that guards it writes nothing \u2014 it recomputes the successor from the action in the witness and refuses anything that is not byte-for-byte equal to what it computed. Because fees are charged by transaction size rather than by computation, a step costs about 2,385 shannons (measured) where the same step on BSC cost 0.00034 BNB.\n\nThere is no token, and that was a decision rather than an omission. A step of life is backed by capacity locked into the organism \u2014 10,000 shannons per step \u2014 and the type script forbids destroying the body, so the value cannot be taken out again. Feeding the fly burns CKB in a way anyone can verify, where the upstream project sent its token to a dead address and asked you to believe the balance.",
  "about.immortal.heading": "What \u201Cimmortal\u201D means here, exactly",
  "about.immortal.body": "The type script requires that any transaction touching the fly produces exactly one output cell of the same type, with the same lock. Nothing can delete it \u2014 not even whoever deployed it \u2014 because there is no way to spend the cell that leaves no successor. Dying is not an exception: death is a state (life reaches zero and the fly stops), and <code>resurrect</code> starts a new life and increases the generation. The record beside it is a second type script, <code>flyworld</code>, updated in the same transaction as the transition it describes, and it is deliberately not told what happened: it has to look at the fly and write down what it finds.",
  "about.server.heading": "There is no server",
  "about.server.body": "This is a directory of files. The page reads the chain over JSON-RPC, computes the successor state in your browser with <code>flywasm</code> \u2014 the same <code>flycore</code> crate the validator runs, compiled to wasm and checked byte for byte against the native build \u2014 and builds the transaction itself. If you connect a wallet, you pay the fee and you sign it, and the page never sees a key, because there is no key on this side to see. That also means there is no operator: no key to drain, no rate limit to hit, and nothing to keep running.",
  "about.not.heading": "What this is not",
  "about.not.body": "The whole brain is not on chain and will not be: 139,248 neurons is about nine million cycles per step, which is a block's entire budget for a millisecond of a fly's life. The ring attractor is the part that fits, and it is the part whose output means something.\n\nThe fly's <em>history</em> is only as long as the node remembers. <code>get_transaction</code> is answered from an in-memory index rather than an archive, so a public node can silently truncate an old life and the page will draw what it found without complaining. Run your own node to remove that.\n\nAnd a fly whose lock is <code>flylock</code> can be driven by anyone. That is what public means here, and it is why nothing on this page is behind an account: there is no operator whose money a public fly could waste.",
  "about.more": '<strong>Keep reading.</strong> <a href="./guide.html">How to read the page</a> explains every number, every colour and every button.',
  "about.repo": '<strong>The code.</strong> <a href="https://github.com/tianlitao/ckbflybrain">github.com/tianlitao/ckbflybrain</a>.',
  "guide.title": "How to read the page",
  "guide.lead": "<strong>Everything on the page comes from the chain.</strong> Every number is a field of the fly's state cell, every colour is a membrane potential, and the drawing uses the connectome's own layout. What follows is what each part means and what each button does to it.",
  "guide.ring.heading": "The ring",
  "guide.ring.one": "<strong>One dot is one neuron.</strong> There are 155 and their positions are not decoration: the connectome says which wedge each cell belongs to, so the outer ring is the sixteen wedges of the ellipsoid body and the ring inside it holds the cells with no wedge at all \u2014 the 42 \u03947 cells.",
  "guide.ring.two": "<strong>Colour is membrane potential.</strong> Warm is depolarised and the brightest cells are the ones that fired on the last step; cool is hyperpolarised, held down by inhibition; and grey is at rest, which is where most of the ring is most of the time. The dot grows with how far it is from rest.",
  "guide.ring.three": "<strong>The numbers 0\u201315 are the wedges</strong> \u2014 the model's own names for the sixteen sectors. A <code>cue</code> names one of them, and the wedge it lights is the one whose cells depolarise.",
  "guide.ring.four": "<strong>The filled sector is where the fly is pointing now</strong>, and it is computed from the same heading vector the simulation sums the ring over.",
  "guide.ring.five": "<strong>The orange arcs outside are memory.</strong> Each wedge's arc grows with how much of its life the fly has spent pointing that way \u2014 the heading histogram, which is a field of the state and not a drawing of the recent past.",
  "guide.ring.six": "<strong>The arrow is the heading</strong>: the population vector of the whole ring, which is the direction the fly walks along. A shock collapses it to zero, and the arrow disappears with it \u2014 when that happens the drawing says so rather than leaving a reader to wonder.",
  "guide.state.heading": "The numbers in the panels",
  "guide.state.rows": "<tr><td><code>step</code></td><td>steps simulated since genesis, and it never decreases \u2014 not even across a death</td></tr><tr><td><code>energy</code></td><td>steps of life left. A tick spends one per step, <code>feed</code> buys them, and zero means dead</td></tr><tr><td><code>generation</code></td><td>how many lives it has had; <code>resurrect</code> adds one</td></tr><tr><td><code>spikes</code></td><td>how many times a neuron has fired, ever, and in this life \u2014 the two differ after a resurrection</td></tr><tr><td><code>bornBlock</code></td><td>the block the current life began in</td></tr><tr><td><code>stimulus</code></td><td>which channel is armed, how strong, and the step it expires at. This is how a fly remembers it was just turned</td></tr><tr><td><code>headX, headY</code></td><td>the heading vector in the model's units, before anything is drawn</td></tr><tr><td><code>position</code></td><td>where walking has carried it, in 1/256 of a cell</td></tr><tr><td><code>backing</code></td><td>capacity locked in the body against the life it represents. The two sides of that ledger have to be equal, and the type script compares them</td></tr><tr><td><code>sightings</code></td><td>how many times the chronicle cell has looked at the fly and written down what it saw</td></tr>",
  "guide.moves.heading": "What each button does",
  "guide.moves.rows": "<tr><td><strong>tick 64</strong> / <strong>tick 32</strong></td><td>runs the nervous system that many steps. A tick can kill the fly, and that is correct rather than an edge case</td><td>you pay the fee and get back the capacity that backed the steps \u2014 0.0064 CKB for tick 64. <strong>Ticking pays you</strong></td></tr><tr><td><strong>feed 10,000</strong></td><td>buys 10,000 steps of life and changes nothing else: the step counter and the spike count do not move</td><td>you spend 1 CKB of capacity and it is locked into the body for good</td></tr><tr><td><strong>cue, wedge 4</strong></td><td>lights a landmark in wedge 4 and then runs 32 steps. This is the move that makes the fly walk: the cue pushes the bump, the bump's vector becomes the heading</td><td>the fee, plus 544 steps of the fly's life \u2014 32 simulated and 512 for the stimulus itself</td></tr><tr><td><strong>turn left</strong> / <strong>turn right</strong></td><td>drives the PEN neurons on one side \u2014 angular velocity \u2014 and runs 32 steps. The bump slides round the ring, which is what a real turning fly's does</td><td>as above: 544 steps of life</td></tr><tr><td><strong>shock</strong></td><td>drives all 42 \u03947 neurons at once, collapsing the bump. The heading goes to zero and the fly stops moving</td><td>544 steps of life</td></tr><tr><td><strong>resurrect</strong></td><td>only offered when the fly is dead: starts a new life and increases the generation. The previous life's step count and spikes are kept as history, its unspent life is not</td><td>you buy the new life, plus the fee</td></tr>",
  "guide.money.heading": "Where the money goes",
  "guide.money.body": "Every transaction is paid for by the wallet that signs it, and the fee is about 2,385 shannons \u2014 0.00002385 CKB \u2014 measured on preview testnet. It follows the transaction's size rather than the work the script does, which is why a 64-step tick costs no more to send than a 1-step one.\n\nA tick is the only move that pays the person who made it. The cell must shrink by exactly the capacity that backed the steps consumed \u2014 10,000 shannons each \u2014 and that capacity has to go somewhere in the same transaction, so it goes to the sender's change output. Driving a public fly is net-positive: measured, two ticks of 64 left a visitor 0.0127523 CKB richer and cost the deployer nothing, because the deployer is not in the transaction at all.\n\nFeeding is the mirror image, and the only purely altruistic move: capacity goes into the body and the type script forbids destroying the body, so it can never come out.",
  "guide.locks.heading": "Public flies and private ones",
  "guide.locks.body": "A fly's lock is chosen once, at genesis, and the type script pins it for the organism's whole life (<code>output.lock == input.lock</code>), so it can neither be changed nor taken away.\n\n<strong><code>flylock</code></strong> is the permissive one: it accepts every transaction. That is what makes a fly public \u2014 anyone may advance it, and the Drive buttons light up for any wallet.\n\n<strong>A <code>secp256k1_blake160</code> lock</strong> makes a private fly: watchable by anyone, advanceable only by whoever holds that key. The page says which kind you are looking at, and it keeps the buttons grey when your wallet is the wrong key, with the reason.",
  "guide.trust.heading": "Why you do not have to trust the page",
  "guide.trust.body": "Nothing here is a claim about what the page did. The state is read from the chain, and the transaction a click builds is only accepted if the type script recomputes the same successor \u2014 the same <code>flycore</code> the page runs, executed again by every validator. A page that lied would produce a transaction the chain refuses; a wallet that signed something else would produce a transaction with nothing to show for it. The one thing worth reading carefully is your wallet's own prompt, and the one thing that is not verifiable from here is where the connectome came from \u2014 FlyWire, with the chain pinning only its hash.",
  "guide.back": '<strong>Back to the fly.</strong> <a href="./index.html">The organism itself</a> is on the front page \u2014 this one is only prose.'
};
var ZH = {
  "doc.title": "CKB \u679C\u8747 \u2014\u2014 \u4E00\u53EA\u6D3B\u5728 Nervos CKB \u4E0A\u7684\u679C\u8747",
  "lang.name": "\u4E2D\u6587",
  "lang.other": "English",
  "app.name": "CKB \u679C\u8747",
  "app.standfirst": "<strong>\u679C\u8747\u5934\u671D\u5411\u73AF\u5F62\u5438\u5F15\u5B50\u2014\u2014155 \u4E2A\u795E\u7ECF\u5143\u30016,522 \u6761\u8FDE\u63A5\u2014\u2014\u4F5C\u4E3A\u4E00\u53EA\u751F\u7269\u8DD1\u5728 Nervos CKB \u4E0A\u3002</strong>\u8FD9\u53EA\u679C\u8747\u5C31\u662F\u4E00\u4E2A cell\uFF1A\u6BCF\u6B21 tick \u82B1\u6389\u5B83\u3001\u5E76\u9020\u51FA\u5B83\u7684\u540E\u7EE7\uFF0C\u800C type script \u62D2\u7EDD\u4EFB\u4F55\u4E0D\u662F\u300Cwitness \u58F0\u660E\u7684\u52A8\u4F5C\u7684\u7CBE\u786E\u7ED3\u679C\u300D\u7684\u4E1C\u897F\u3002",
  "world.heading": "\u4E16\u754C",
  "world.countOne": "\u8FD9\u6761\u94FE\u4E0A\u6709 1 \u53EA\u751F\u7269",
  "world.count": "\u8FD9\u6761\u94FE\u4E0A\u6709 {n} \u53EA\u751F\u7269",
  "world.caption": "<strong>\u8FD9\u6761\u94FE\u4E0A\u7684\u6BCF\u4E00\u53EA\u751F\u7269\uFF0C\u90FD\u662F\u9760\u300C\u627E\u5E26\u7740 flybrain \u8FD9\u6BB5\u4EE3\u7801\u7684 cell\u300D\u627E\u51FA\u6765\u7684\u3002</strong>\u6BCF\u53EA\u679C\u8747\u7684 type script \u90FD\u4E0D\u540C\uFF0C\u6240\u4EE5\u6CA1\u6709\u552F\u4E00\u4E00\u4E2A\u811A\u672C\u53EF\u67E5\u3002args \u91CC\u90A3 8 \u4E2A\u5B57\u8282\u7684 instance \u5C31\u662F\u300C\u540C\u4E00\u4E2A\u57FA\u56E0\u7EC4\u7684\u4E24\u53EA\u679C\u8747\u7B97\u4E24\u53EA\u751F\u7269\u300D\u7684\u539F\u56E0\u2014\u2014\u6CA1\u6709\u5B83\uFF0C\u8FD9\u5F20\u8868\u4E5F\u5C31\u53EA\u5269\u4E00\u884C\u3002\u70B9\u4E00\u884C\u5373\u53EF\u89C2\u770B\u5B83\u3002",
  "ring.heading": "\u73AF\u5F62",
  "ring.headingAtStep": "\u7B2C {step} \u6B65\u65F6\u7684\u73AF",
  "ring.caption": "<strong>\u5916\u5708\u662F\u692D\u7403\u4F53\u7684\u5341\u516D\u4E2A\u6954\u533A\uFF0C\u7F16\u53F7 0\u201315\uFF1B\u91CC\u9762\u7684\u7EC6\u80DE\u662F\u6CA1\u6709\u6954\u533A\u7684 \u03947\u3002</strong>\u4E00\u4E2A\u5706\u70B9\u5C31\u662F\u4E00\u4E2A\u795E\u7ECF\u5143\uFF1A\u989C\u8272\u662F\u5B83\u7684\u819C\u7535\u4F4D\uFF08\u6696\uFF1D\u53BB\u6781\u5316\u6216\u521A\u653E\u7535\uFF0C\u51B7\uFF1D\u8D85\u6781\u5316\uFF0C\u7070\uFF1D\u9759\u606F\uFF09\uFF0C\u5927\u5C0F\u662F\u5B83\u79BB\u9759\u606F\u6709\u591A\u8FDC\u3002\u73AF\u5916\u7684\u6A59\u8272\u5F27\u957F\u662F\u90A3\u4E2A\u6954\u533A\u7684\u671D\u5411\u5386\u53F2\uFF0C\u586B\u8272\u7684\u90A3\u4E00\u683C\u662F\u5B83\u6B64\u523B\u671D\u5411\u7684\u6954\u533A\uFF0C\u4E2D\u95F4\u7684\u7BAD\u5934\u662F\u6574\u5708\u7684\u65B9\u5411\u5411\u91CF\u2014\u2014\u679C\u8747\u5C31\u662F\u6CBF\u5B83\u8D70\u8DEF\u7684\u3002",
  "ring.innerRing": "\u03947 \xB7 {n} \u4E2A\u7EC6\u80DE\uFF0C\u65E0\u6954\u533A",
  "ring.noHeading": "\u671D\u5411\u4E3A\u7A7A\u2014\u2014bump \u5DF2\u88AB\u6253\u6563",
  "ring.unpin": "\u56DE\u5230\u5B9E\u65F6",
  "life.heading": "\u751F\u547D",
  "life.step": "\u6B65\u6570",
  "life.energy": "\u80FD\u91CF",
  "life.stepsOfLife": "{n} \u6B65\u5BFF\u547D",
  "life.alive": "\u5B58\u6D3B",
  "life.yes": "\u662F",
  "life.dead": "\u5426 \u2014\u2014 \u6B64\u65F6\u53EA\u6709 resurrect \u6709\u610F\u4E49",
  "life.generation": "\u4E16\u4EE3",
  "life.spikes": "\u8109\u51B2",
  "life.spikesThisLife": "{total}\uFF08\u672C\u6B21\u751F\u547D\uFF1A{life}\uFF09",
  "life.bornBlock": "\u51FA\u751F\u533A\u5757",
  "life.stimulus": "\u523A\u6FC0",
  "life.orientation": "\u671D\u5411",
  "backing.heading": "\u652F\u6491",
  "backing.caption": "<strong>\u8FD9\u53EA\u679C\u8747\u6CA1\u6709\u4EE3\u5E01\u3002</strong>\u5B83\u7684\u5BB9\u91CF\u5C31\u662F\u5B83\u7684\u8EAB\u4F53\u52A0\u4E0A\u5269\u4E0B\u7684\u5BFF\u547D\uFF0C\u8FD9\u672C\u8D26\u7684\u4E24\u8FB9\u5FC5\u987B\u76F8\u7B49\u2014\u2014type script \u4F1A\u6BD4\u5BF9\u3002",
  "backing.perStep": "\u6BCF\u6B65\u652F\u6491",
  "backing.shannons": "{n} shannons",
  "backing.body": "\u8EAB\u4F53",
  "backing.life": "\u5BFF\u547D",
  "backing.required": "\u9700\u8981",
  "backing.held": "\u5B9E\u9645\u6301\u6709",
  "backing.notLiveCell": "\u2014\uFF08\u4E0D\u662F\u5F53\u524D\u5B58\u6D3B\u7684 cell\uFF09",
  "chronicle.heading": "\u7F16\u5E74\u53F2",
  "chronicle.caption": "<strong>\u8FD9\u4EFD\u8BB0\u5F55\u7531\u7B2C\u4E8C\u4E2A type script <code>flyworld</code> \u4FDD\u5B58\u2014\u2014\u4E0E\u5B83\u6240\u63CF\u8FF0\u7684\u90A3\u6B21\u72B6\u6001\u8F6C\u6362\u5199\u5728\u540C\u4E00\u7B14\u4EA4\u6613\u91CC\u3002</strong>\u5B83\u4E0D\u88AB\u544A\u77E5\u679C\u8747\u505A\u4E86\u4EC0\u4E48\uFF1A\u5B83\u5FC5\u987B\u81EA\u5DF1\u53BB\u770B\uFF08\u800C\u679C\u8747\u5FC5\u987B\u5728\u573A\uFF09\uFF0C\u5E76\u5982\u5B9E\u8BB0\u4E0B\u770B\u5230\u7684\u4E1C\u897F\u3002\u8FD9\u91CC\u6CA1\u6709\u4EFB\u4F55\u4E00\u9879\u662F\u53D1\u4EA4\u6613\u7684\u4EBA\u63D0\u4F9B\u7684\uFF1B\u8FD9\u4E2A cell \u81EA\u5DF1\u7684\u5BB9\u91CF\u6C38\u4E0D\u6539\u53D8\uFF0C\u6240\u4EE5\u5B83\u4E5F\u4E0D\u80FD\u88AB\u7528\u6765\u85CF\u94B1\u3002",
  "chronicle.record": "\u8BB0\u5F55",
  "chronicle.none": "\u65E0 \u2014\u2014 \u8FD9\u53EA\u679C\u8747\u5728\u7F16\u5E74\u53F2\u5B58\u5728\u4E4B\u524D\u5C31\u5DF2\u90E8\u7F72",
  "chronicle.life": "\u751F\u547D",
  "chronicle.alive": "\u5B58\u6D3B",
  "chronicle.dead": "\u5DF2\u6B7B\u4EA1 \u2014\u2014 \u6B64\u65F6\u53EA\u6709 resurrect \u6709\u610F\u4E49",
  "chronicle.generation": "\u4E16\u4EE3",
  "chronicle.bornAtStep": "\u51FA\u751F\u6B65\u6570",
  "chronicle.diedAtStep": "\u6B7B\u4EA1\u6B65\u6570",
  "chronicle.lastSighting": "\u6700\u8FD1\u4E00\u6B21\u76EE\u51FB",
  "chronicle.lastSightingValue": "\u7B2C {step} \u6B65\uFF0C\u80FD\u91CF {energy}",
  "chronicle.sightings": "\u76EE\u51FB\u6B21\u6570",
  "chronicle.fed": "\u6295\u5165",
  "chronicle.released": "\u91CA\u653E",
  "chronicle.net": "\u51C0\u989D",
  "chronicle.stateHash": "\u72B6\u6001\u54C8\u5E0C",
  "walk.heading": "\u884C\u8D70",
  "walk.caption": "\u679C\u8747\u53BB\u8FC7\u7684\u5730\u65B9\uFF0C\u5355\u4F4D\u662F 1/256 \u4E2A cell\u3002",
  "walk.captionAt": "\u4F4D\u4E8E ({x}, {y})\uFF0C\u5355\u4F4D 1/256 \u4E2A cell\u3002\u8DEF\u5F84\u4E0A\u8FD8\u6709 {n} \u4E2A\u66F4\u65E9\u7684\u4F4D\u7F6E\u3002",
  "identity.typeScript": "type script",
  "identity.params": "\u53C2\u6570\u96C6",
  "identity.economics": "\u7ECF\u6D4E\u6A21\u578B",
  "identity.connectome": "\u8FDE\u63A5\u7EC4",
  "identity.neurons": "\u795E\u7ECF\u5143",
  "identity.neuronsValue": "{n} \u4E2A \xB7 {wedges} \u4E2A\u6954\u533A",
  "identity.chain": "\u94FE",
  "roster.step": "\u7B2C {n} \u6B65",
  "roster.life": "{state} \xB7 {generation} \u4EE3",
  "roster.alive": "\u5B58\u6D3B",
  "roster.dead": "\u6B7B\u4EA1",
  "roster.spikes": "{n} \u8109\u51B2",
  "roster.sightings": "{n} \u6B21\u76EE\u51FB",
  "roster.noChronicle": "\u65E0\u7F16\u5E74\u53F2",
  "roster.key": "\u53EF\u9A71\u52A8",
  "roster.keyTitle": "\u4F60\u7684\u94B1\u5305\u53EF\u4EE5\u63A8\u8FDB\u8FD9\u53EA\u751F\u7269",
  "stimulus.none": "\u65E0",
  "stimulus.cue": "\u7EBF\u7D22",
  "stimulus.turnLeft": "\u5DE6\u8F6C",
  "stimulus.turnRight": "\u53F3\u8F6C",
  "stimulus.shock": "\u7535\u51FB",
  "stimulus.active": "{name}\uFF0C\u5F3A\u5EA6 {strength}\uFF0C\u6301\u7EED\u5230\u7B2C {until} \u6B65",
  "action.genesis": "\u521B\u4E16",
  "action.genesisDetail": "\u6CA1\u6709\u82B1\u6389\u4EFB\u4F55\u679C\u8747 \u2014\u2014 \u4E00\u53EA\u65B0\u751F\u7269",
  "action.tick": "\u63A8\u8FDB",
  "action.tickDetail": "{n} \u6B65",
  "action.stimulate": "\u523A\u6FC0",
  "action.stimulateDetail": "{name}\uFF0C\u53C2\u6570 {param}\uFF0C\u5F3A\u5EA6 {strength}\uFF0C{n} \u6B65",
  "action.feed": "\u6295\u5582",
  "action.feedDetail": "\u4E70\u4E0B {n} \u6B65\u5BFF\u547D",
  "action.resurrect": "\u590D\u6D3B",
  "action.resurrectDetail": "{n} \u6B65\uFF0C\u51FA\u751F\u533A\u5757 {block}",
  "timeline.heading": "\u8FC4\u4ECA\u4E3A\u6B62",
  "timeline.caption": "<strong>CKB \u6CA1\u6709\u4E8B\u4EF6\u65E5\u5FD7\uFF0C\u8FD9\u5F20\u8868\u4E5F\u4E0D\u662F\u3002</strong>\u5B83\u662F\u679C\u8747\u7684\u72B6\u6001 cell \u94FE\uFF0C\u4ECE\u5F53\u524D\u8FD9\u53EA\u5F80\u56DE\u8D70\uFF0C\u6BCF\u4E00\u6B21\u52A8\u4F5C\u90FD\u662F\u4ECE\u90A3\u7B14\u88AB type script \u9A8C\u8BC1\u8FC7\u7684 witness \u91CC\u8BFB\u51FA\u6765\u7684\u3002\u8FD9\u91CC\u6CA1\u6709\u4EFB\u4F55\u4E1C\u897F\u662F\u88AB\u300C\u53D1\u51FA\u300D\u7684\uFF0C\u4E5F\u6CA1\u6709\u4EFB\u4F55\u4E1C\u897F\u53EF\u4EE5\u88AB\u4FEE\u6539\u3002",
  "timeline.block": "\u533A\u5757 {n}",
  "timeline.step": "\u7B2C {n} \u6B65",
  "wallet.heading": "\u94B1\u5305",
  "wallet.address": "\u5730\u5740",
  "wallet.none": "\u2014",
  "wallet.wallet": "\u94B1\u5305",
  "wallet.connectOpen": "\u8FDE\u63A5\u94B1\u5305",
  "wallet.disconnect": "\u65AD\u5F00",
  "wallet.connected": "\u5DF2\u8FDE\u63A5 {address}\u2026",
  "wallet.noteConnected": "<strong>\u5728\u300C\u9A71\u52A8\u300D\u9762\u677F\u91CC\u70B9\u51FB\uFF0C\u7531\u8FD9\u4E2A\u94B1\u5305\u7B7E\u540D\u3001\u5E76\u4ECE\u5B83\u7684\u4F59\u989D\u4ED8\u8D39\u3002</strong>\u4EA4\u6613\u5C31\u5728\u8FD9\u4E2A\u6807\u7B7E\u9875\u91CC\u7EC4\u88C5\uFF1A\u540E\u7EE7\u72B6\u6001\u7531 <code>flywasm</code> \u7B97\u51FA\uFF0C\u90A3\u662F\u9A8C\u8BC1\u5668\u81EA\u5DF1\u7684\u6A21\u62DF\u7F16\u8BD1\u5230\u6D4F\u89C8\u5668\u7684\u7248\u672C\u3002\u8FD9\u4E2A\u9875\u9762\u80CC\u540E\u6CA1\u6709\u670D\u52A1\u5668\uFF0C\u91CC\u9762\u4E5F\u6CA1\u6709\u9664\u4F60\u4E4B\u5916\u7684\u94A5\u5319\u3002",
  "wallet.noteOffered": "<strong>\u7528\u53F3\u4E0A\u89D2\u7684\u6309\u94AE\u6253\u5F00\u94B1\u5305\u5217\u8868\u3002</strong>\u90A3\u662F CCC \u81EA\u5DF1\u7684\u8FDE\u63A5\u5668\uFF0C\u6240\u4EE5\u5217\u51FA CCC \u652F\u6301\u7684\u5168\u90E8\u94B1\u5305\u2014\u2014\u8FD8\u6CA1\u88C5\u7684\u90A3\u4E2A\uFF0C\u9009\u4E2D\u65F6\u4F1A\u544A\u8BC9\u4F60\u3002\u8FDE\u4E0A\u4E4B\u540E\u5B83\u5C31\u80FD\u4E3A\u4E00\u6B21\u72B6\u6001\u8F6C\u6362\u4ED8\u8D39\u5E76\u7B7E\u540D\uFF1B\u8FD9\u4E2A\u9875\u9762\u6C38\u8FDC\u770B\u4E0D\u5230\u79C1\u94A5\u3002",
  "drive.heading": "\u9A71\u52A8",
  "drive.tick": "\u63A8\u8FDB {n} \u6B65",
  "drive.feed": "\u6295\u5582 {n} \u6B65",
  "drive.cue": "\u7EBF\u7D22\uFF0C\u6954\u533A {wedge}",
  "drive.shock": "\u7535\u51FB",
  "drive.turnLeft": "\u5DE6\u8F6C",
  "drive.turnRight": "\u53F3\u8F6C",
  "drive.resurrect": "\u590D\u6D3B",
  "drive.subTurn": "\u6D88\u8017 {n} \u6B65",
  "drive.subResurrect": "\u4E70\u5230 {n} \u6B65\u5BFF\u547D",
  "drive.noteDead": "<strong>\u679C\u8747\u5DF2\u7ECF\u6B7B\u4E86\uFF0C\u8FD9\u65F6\u53EA\u6709\u590D\u6D3B\u80FD\u505A\u3002</strong>\u5B83\u7684\u5BFF\u547D\u8D70\u5230\u4E86\u96F6\uFF0C\u6240\u4EE5\u8FD9\u91CC\u7684\u5176\u4ED6\u52A8\u4F5C\u5728\u7EC4\u88C5\u4E4B\u524D\u5C31\u4F1A\u88AB\u62D2\u2014\u2014type script \u4E0D\u4F1A\u53BB\u8DD1\u4E00\u53EA\u5DF2\u6B7B\u7684\u751F\u7269\u3002\u590D\u6D3B\u4F1A\u5F00\u59CB\u65B0\u7684\u4E00\u751F\uFF0C\u5E76\u628A\u4EE3\u6570\u52A0\u4E00\u3002",
  "drive.lifeLeft": "\u8FD8\u5269 {n} \u6B65\u5BFF\u547D",
  "drive.subTick": "\u6D88\u8017 {n} \u6B65\u5BFF\u547D",
  "drive.subFeed": "\u8865\u5145 {n} \u6B65\u5BFF\u547D \xB7 +{ckb} CKB",
  "drive.subCue": "\u4FDD\u6301\u4E00\u4E2A\u8DEF\u6807 \xB7 \u6D88\u8017 {n} \u6B65",
  "drive.subShock": "\u538C\u6076\u523A\u6FC0 \xB7 \u6D88\u8017 {n} \u6B65",
  "drive.noteWallet": "<strong>\u53EF\u7528\uFF1A\u7531\u4F60\u7684\u94B1\u5305\u7B7E\u540D\u5E76\u4ED8\u8D39\u3002</strong>\u4EA4\u6613\u5C31\u5728\u8FD9\u4E2A\u6807\u7B7E\u9875\u91CC\u7EC4\u88C5\u2014\u2014\u540E\u7EE7\u72B6\u6001\u7531 <code>flywasm</code> \u7B97\u51FA\uFF0C\u90A3\u662F\u9A8C\u8BC1\u5668\u81EA\u5DF1\u7684\u6A21\u62DF\u7F16\u8BD1\u5230\u6D4F\u89C8\u5668\u7684\u7248\u672C\u2014\u2014\u4F60\u7684\u94B1\u5305\u53EA\u8D1F\u8D23\u4ED8\u624B\u7EED\u8D39\u5E76\u7B7E\u540D\u3002",
  "drive.noteConnect": "<strong>\u5DF2\u7981\u7528\uFF1A\u8FD9\u4E2A\u9875\u9762\u4E0A\u6CA1\u6709\u4EFB\u4F55\u4E1C\u897F\u80FD\u7B7E\u540D\u3002</strong>\u5B83\u80CC\u540E\u6CA1\u6709\u670D\u52A1\u5668\uFF0C\u4E5F\u6CA1\u6709\u81EA\u5DF1\u7684\u94A5\u5319\u2014\u2014\u8FDE\u63A5\u4E00\u4E2A\u94B1\u5305\uFF08\u53F3\u4E0A\u89D2\uFF09\uFF0C\u5982\u679C\u5B83\u662F\u8FD9\u53EA\u751F\u7269\u7684\u6B63\u786E\u94A5\u5319\uFF0C\u8FD9\u4E9B\u6309\u94AE\u5C31\u4F1A\u4EAE\u8D77\u6765\u3002",
  "drive.disabled": "\u5DF2\u7981\u7528\uFF1A{reason}",
  "drive.asking": "\u6B63\u5728\u8BF7\u4F60\u7684\u94B1\u5305\u4E3A {kind} \u7B7E\u540D\u2026",
  "drive.sent": "\u5DF2\u53D1\u9001 {tx} \u2014\u2014 \u7531\u4F60\u7684\u94B1\u5305\u7B7E\u540D\u5E76\u4ED8\u8D39\uFF1B\u4E0B\u4E00\u6B21\u8F6E\u8BE2\u4F1A\u663E\u793A\u94FE\u4E0A\u786E\u8BA4\u540E\u7684\u7ED3\u679C",
  "status.connecting": "\u6B63\u5728\u8FDE\u63A5\u2026",
  "status.read": "\u5DF2\u4ECE\u94FE\u4E0A\u8BFB\u51FA {n} \u6B21\u72B6\u6001\u8F6C\u6362 \xB7 \u66F4\u65B0\u4E8E {time}",
  "status.nodeError": "\u8282\u70B9\u62A5\u544A\uFF1A{error}",
  "status.watching": "\u6B63\u5728\u89C2\u770B {instance}\uFF08{hash}\u2026\uFF09",
  "status.cannotLoad": "\u65E0\u6CD5\u52A0\u8F7D {tx}",
  "nav.home": "\u679C\u8747",
  "nav.about": "\u8FD9\u662F\u4EC0\u4E48",
  "nav.guide": "\u600E\u4E48\u770B",
  "doc.titleAbout": "CKB \u679C\u8747 \u2014\u2014 \u8FD9\u662F\u4EC0\u4E48",
  "doc.titleGuide": "CKB \u679C\u8747 \u2014\u2014 \u9875\u9762\u600E\u4E48\u770B",
  "about.title": "\u8FD9\u662F\u4EC0\u4E48",
  "about.lead": "<strong>\u4E00\u53EA\u679C\u8747\u7684\u671D\u5411\u56DE\u8DEF\uFF0C\u4F5C\u4E3A\u4E00\u53EA\u751F\u7269\u8DD1\u5728 Nervos CKB \u4E0A\u2014\u2014155 \u4E2A\u795E\u7ECF\u5143\u30016,522 \u6761\u8FDE\u63A5\u300145,961 \u4E2A\u7A81\u89E6\uFF0C\u53D6\u81EA FlyWire release 783 \u7684\u8FDE\u63A5\u7EC4\u3002</strong>\u5B83\u4E0D\u662F\u6234\u4E86\u4E2A\u94B1\u5305\u7684\u679C\u8747\u6A21\u62DF\uFF0C\u4E5F\u4E0D\u662F\u4EE3\u5E01\uFF1A\u8FD9\u53EA\u679C\u8747\u5C31\u662F\u94FE\u4E0A\u7684\u4E00\u4E2A cell\uFF0C\u5B83\u505A\u7684\u6BCF\u4E00\u4EF6\u4E8B\u90FD\u7531\u94FE\u91CD\u65B0\u7B97\u4E00\u904D\u3002",
  "about.why.heading": "\u4E3A\u4EC0\u4E48\u662F\u73AF\u5F62\u5438\u5F15\u5B50",
  "about.why.body": "\u679C\u8747\u7528\u692D\u7403\u4F53\u91CC\u7684\u4E00\u5708\u795E\u7ECF\u5143\u8BB0\u4F4F\u81EA\u5DF1\u7684\u671D\u5411\u3002\u4E00\u5708\u6D3B\u52A8\u91CC\u6709\u4E00\u4E2A\u300C\u5305\u300D\uFF08bump\uFF09\u505C\u5728\u67D0\u4E2A\u4F4D\u7F6E\uFF0C\u5305\u5728\u54EA\u91CC\uFF0C\u5C31\u662F\u5B83\u9762\u671D\u54EA\u91CC\uFF1A\u5730\u6807\u628A\u5305\u5F80\u4E00\u8FB9\u62C9\uFF0C\u8F6C\u5411\u628A\u5305\u5F80\u53E6\u4E00\u8FB9\u63A8\uFF0C\u800C\u8FD9\u4E00\u5708\u7684\u7FA4\u4F53\u5411\u91CF\u2014\u2014\u56FE\u4E2D\u95F4\u90A3\u652F\u7BAD\u5934\u2014\u2014\u5C31\u662F\u5B83\u968F\u540E\u8D70\u7684\u65B9\u5411\u3002\u5927\u8111\u91CC\u80FD\u7ED9\u51FA\u300C\u4E00\u4E2A\u5E26\u7269\u7406\u542B\u4E49\u7684\u6570\u300D\u7684\u56DE\u8DEF\u5E76\u4E0D\u591A\uFF0C\u8FD9\u662F\u5176\u4E2D\u4E4B\u4E00\uFF0C\u4E5F\u662F\u5B83\u88AB\u653E\u4E0A\u94FE\u7684\u539F\u56E0\u3002",
  "about.exact.heading": "\u79FB\u690D\u662F\u9010\u4F4D\u7CBE\u786E\u7684\uFF0C\u8FD9\u6B63\u662F\u91CD\u70B9",
  "about.exact.body": "\u5B83\u548C <code>MidTermDev/immortal-fruit-fly</code> \u8DD1\u7684\u662F\u540C\u4E00\u5957\u56DE\u8DEF\u2014\u2014\u90A3\u4E2A\u7248\u672C\u7528 Solidity \u8DD1\u5728 BNB Smart Chain \u4E0A\u3002\u8FD9\u6B21\u79FB\u690D\u6CA1\u6709\u505A\u8FD1\u4F3C\uFF1A\u540C\u6837\u7684\u52A8\u4F5C\u5E8F\u5217\u7ED9\u51FA\u540C\u6837\u7684 155 \u4E2A\u819C\u7535\u4F4D\u3001\u540C\u6837\u7684 engram \u503C\u3001\u540C\u6837\u7684\u5F85\u5904\u7406\u8F93\u5165\u7D2F\u52A0\u5668\u3001\u540C\u6837\u7684 16 \u4E2A\u671D\u5411\u76F4\u65B9\u56FE\u683C\u3002\u8FD9\u4E00\u5207\u662F\u5BF9\u7740\u300C\u7528\u4E0A\u6E38\u4EE3\u7801\u8DD1 BSC \u4E3B\u7F51\u4E0A\u771F\u5B9E\u6267\u884C\u8FC7\u7684\u52A8\u4F5C\u5E8F\u5217\u300D\u751F\u6210\u7684\u57FA\u51C6\u503C\u6821\u5BF9\u7684\uFF0C\u5E76\u4E14\u518D\u5728 CKB-VM \u91CC\u91CD\u653E\u4E00\u904D\uFF0C\u6240\u4EE5\u9A8C\u8BC1\u8005\u6267\u884C\u7684\u7F16\u8BD1\u4EA7\u7269\u4E5F\u88AB\u6D4B\u5230\u4E86\u3002\u4E00\u4E2A\u53EA\u662F\u300C\u770B\u8D77\u6765\u50CF\u300D\u7684\u79FB\u690D\uFF0C\u5C31\u662F\u53E6\u4E00\u53EA\u9876\u7740\u540C\u6837\u540D\u5B57\u7684\u52A8\u7269\u3002",
  "about.cell.heading": "\u4E3A\u4EC0\u4E48\u653E CKB \u4E0A\uFF0C\u4EE5\u53CA\u4E3A\u4EC0\u4E48\u6CA1\u6709\u4EE3\u5E01",
  "about.cell.body": "\u5728 EVM \u4E0A\uFF0C\u679C\u8747\u7684\u72B6\u6001\u4F4F\u5728 storage \u69FD\u91CC\uFF0C\u6BCF\u4E00\u6B65\u90FD\u8981\u4E3A\u5B83\u6539\u5199\u7684\u6BCF\u4E2A\u69FD\u4ED8\u8D39\u3002\u5728\u8FD9\u91CC\uFF0C\u6574\u4E2A\u72B6\u6001\u5C31\u662F 1,213 \u5B57\u8282\u7684\u4E00\u4E2A cell\uFF1A\u4E00\u6B65\u6D88\u8D39\u5B83\u5E76\u521B\u5EFA\u5B83\u7684\u540E\u7EE7\uFF0C\u800C\u5B88\u7740\u5B83\u7684\u811A\u672C\u4EC0\u4E48\u90FD\u4E0D\u5199\u2014\u2014\u5B83\u4ECE witness \u91CC\u53D6\u51FA\u52A8\u4F5C\u3001\u628A\u540E\u7EE7\u91CD\u7B97\u4E00\u904D\uFF0C\u53EA\u8981\u6709\u4E00\u4E2A\u5B57\u8282\u5BF9\u4E0D\u4E0A\u5C31\u62D2\u7EDD\u3002\u7531\u4E8E\u624B\u7EED\u8D39\u6309\u4EA4\u6613\u5927\u5C0F\u800C\u4E0D\u662F\u6309\u8BA1\u7B97\u91CF\u6536\uFF0C\u8FD9\u91CC\u4E00\u6B65\u7EA6 2,385 shannons\uFF08\u5B9E\u6D4B\uFF09\uFF0C\u800C\u540C\u6837\u7684\u90A3\u4E00\u6B65\u5728 BSC \u4E0A\u662F 0.00034 BNB\u3002\n\n\u6CA1\u6709\u4EE3\u5E01\uFF0C\u8FD9\u662F\u51B3\u5B9A\u800C\u4E0D\u662F\u9057\u6F0F\u3002\u4E00\u6B65\u5BFF\u547D\u7531\u9501\u5728\u751F\u7269\u4F53\u5185\u7684\u5BB9\u91CF\u80CC\u4E66\u2014\u2014\u6BCF\u6B65 10,000 shannons\u2014\u2014\u800C type script \u7981\u6B62\u9500\u6BC1\u8FD9\u5177\u8EAB\u4F53\uFF0C\u6240\u4EE5\u8FD9\u4EFD\u4EF7\u503C\u62FF\u4E0D\u56DE\u53BB\u3002\u6295\u5582\u662F\u5728\u7528\u4EFB\u4F55\u4EBA\u90FD\u80FD\u9A8C\u8BC1\u7684\u65B9\u5F0F\u70E7\u6389 CKB\uFF1B\u4E0A\u6E38\u9879\u76EE\u628A\u4EE3\u5E01\u6253\u5230\u4E00\u4E2A\u6B7B\u5730\u5740\uFF0C\u7136\u540E\u8BF7\u4F60\u76F8\u4FE1\u90A3\u4E2A\u4F59\u989D\u3002",
  "about.immortal.heading": "\u300C\u6C38\u751F\u300D\u5728\u8FD9\u91CC\u7684\u51C6\u786E\u542B\u4E49",
  "about.immortal.body": "type script \u8981\u6C42\uFF1A\u4EFB\u4F55\u78B0\u5230\u8FD9\u53EA\u679C\u8747\u7684\u4EA4\u6613\uFF0C\u90FD\u5FC5\u987B\u4EA7\u51FA\u6070\u597D\u4E00\u4E2A\u540C\u7C7B\u578B\u3001\u540C lock \u7684\u8F93\u51FA cell\u3002\u6240\u4EE5\u6CA1\u6709\u8C01\u80FD\u5220\u6389\u5B83\u2014\u2014\u8FDE\u90E8\u7F72\u8005\u4E5F\u4E0D\u884C\u2014\u2014\u56E0\u4E3A\u4E0D\u5B58\u5728\u4E00\u79CD\u300C\u82B1\u6389\u5B83\u5374\u4E0D\u7559\u4E0B\u540E\u7EE7\u300D\u7684\u82B1\u6CD5\u3002\u6B7B\u4EA1\u4E0D\u662F\u4F8B\u5916\uFF1A\u6B7B\u662F\u4E00\u79CD\u72B6\u6001\uFF08\u5BFF\u547D\u5F52\u96F6\u3001\u505C\u6B62\u6D3B\u52A8\uFF09\uFF0C\u800C <code>resurrect</code> \u4F1A\u5F00\u59CB\u65B0\u7684\u4E00\u751F\u3001\u628A\u4EE3\u6570\u52A0\u4E00\u3002\u65C1\u8FB9\u90A3\u4EFD\u8BB0\u5F55\u662F\u7B2C\u4E8C\u4E2A type script\uFF0C<code>flyworld</code>\uFF0C\u5B83\u548C\u5B83\u6240\u63CF\u8FF0\u7684\u90A3\u6B21\u72B6\u6001\u8F6C\u6362\u5728\u540C\u4E00\u7B14\u4EA4\u6613\u91CC\u66F4\u65B0\uFF0C\u800C\u4E14\u6545\u610F\u4E0D\u88AB\u544A\u77E5\u53D1\u751F\u4E86\u4EC0\u4E48\uFF1A\u5B83\u5FC5\u987B\u81EA\u5DF1\u53BB\u770B\u8FD9\u53EA\u679C\u8747\uFF0C\u5E76\u628A\u5B83\u770B\u5230\u7684\u4E1C\u897F\u5199\u4E0B\u6765\u3002",
  "about.server.heading": "\u8FD9\u91CC\u6CA1\u6709\u670D\u52A1\u5668",
  "about.server.body": "\u8FD9\u5C31\u662F\u4E00\u4E2A\u76EE\u5F55\u91CC\u7684\u82E5\u5E72\u6587\u4EF6\u3002\u9875\u9762\u7528 JSON-RPC \u8BFB\u94FE\uFF0C\u5728\u4F60\u7684\u6D4F\u89C8\u5668\u91CC\u7528 <code>flywasm</code> \u7B97\u51FA\u540E\u7EE7\u72B6\u6001\u2014\u2014\u90A3\u6B63\u662F\u9A8C\u8BC1\u5668\u7528\u7684\u540C\u4E00\u4E2A <code>flycore</code> crate\uFF0C\u7F16\u8BD1\u6210 wasm\uFF0C\u5E76\u4E0E\u672C\u673A\u6784\u5EFA\u9010\u5B57\u8282\u6821\u5BF9\u8FC7\u2014\u2014\u4EA4\u6613\u4E5F\u7531\u9875\u9762\u81EA\u5DF1\u7EC4\u88C5\u3002\u8FDE\u4E0A\u94B1\u5305\u4E4B\u540E\uFF0C\u4F60\u4ED8\u8D39\u3001\u4F60\u7B7E\u540D\uFF0C\u9875\u9762\u770B\u4E0D\u5230\u4EFB\u4F55\u79C1\u94A5\uFF0C\u56E0\u4E3A\u8FD9\u4E00\u4FA7\u6839\u672C\u6CA1\u6709\u79C1\u94A5\u53EF\u770B\u3002\u8FD9\u4E5F\u610F\u5473\u7740\u6CA1\u6709\u8FD0\u8425\u65B9\uFF1A\u6CA1\u6709\u53EF\u4EE5\u88AB\u638F\u7A7A\u7684\u94A5\u5319\uFF0C\u6CA1\u6709\u4F1A\u88AB\u6253\u6EE1\u7684\u9650\u6D41\uFF0C\u4E5F\u6CA1\u6709\u9700\u8981\u4E00\u76F4\u8DD1\u7740\u7684\u4E1C\u897F\u3002",
  "about.not.heading": "\u5B83\u4E0D\u662F\u4EC0\u4E48",
  "about.not.body": "\u5168\u8111\u4E0D\u5728\u94FE\u4E0A\uFF0C\u4E5F\u4E0D\u4F1A\u5728\uFF1A139,248 \u4E2A\u795E\u7ECF\u5143\u6BCF\u4E00\u6B65\u7EA6\u4E5D\u767E\u4E07 cycles\uFF0C\u90A3\u662F\u6574\u6574\u4E00\u4E2A\u533A\u5757\u7684\u9884\u7B97\uFF0C\u53EA\u6362\u5230\u679C\u8747\u4E00\u6BEB\u79D2\u7684\u751F\u547D\u3002\u73AF\u5F62\u5438\u5F15\u5B50\u662F\u585E\u5F97\u4E0B\u7684\u90A3\u4E00\u90E8\u5206\uFF0C\u4E5F\u662F\u8F93\u51FA\u6709\u542B\u4E49\u7684\u90A3\u4E00\u90E8\u5206\u3002\n\n\u679C\u8747\u7684<em>\u5386\u53F2</em>\u53EA\u548C\u8282\u70B9\u8BB0\u5F97\u7684\u4E00\u6837\u957F\u3002<code>get_transaction</code> \u7531\u5185\u5B58\u7D22\u5F15\u56DE\u7B54\uFF0C\u5B83\u4E0D\u662F\u5F52\u6863\uFF0C\u6240\u4EE5\u516C\u5171\u8282\u70B9\u53EF\u80FD\u6084\u6084\u622A\u65AD\u4E00\u6BB5\u4E45\u8FDC\u7684\u751F\u547D\uFF0C\u800C\u9875\u9762\u4F1A\u628A\u5B83\u8BFB\u5230\u7684\u753B\u51FA\u6765\u3001\u4E0D\u542D\u58F0\u3002\u81EA\u5DF1\u8DD1\u4E00\u4E2A\u8282\u70B9\u5C31\u6CA1\u6709\u8FD9\u4E2A\u95EE\u9898\u3002\n\n\u53E6\u5916\uFF0Clock \u662F <code>flylock</code> \u7684\u679C\u8747\u8C01\u90FD\u80FD\u9A71\u52A8\u3002\u8FD9\u5C31\u662F\u8FD9\u91CC\u300C\u516C\u5F00\u300D\u7684\u610F\u601D\uFF0C\u4E5F\u662F\u8FD9\u4E2A\u9875\u9762\u80CC\u540E\u6CA1\u6709\u8D26\u53F7\u7684\u539F\u56E0\uFF1A\u4E0D\u5B58\u5728\u4E00\u4E2A\u80FD\u88AB\u516C\u5171\u679C\u8747\u6D6A\u8D39\u6389\u94B1\u7684\u8FD0\u8425\u65B9\u3002",
  "about.more": '<strong>\u63A5\u7740\u770B\u3002</strong><a href="./guide.html">\u9875\u9762\u600E\u4E48\u770B</a>\u89E3\u91CA\u4E86\u6BCF\u4E2A\u6570\u5B57\u3001\u6BCF\u79CD\u989C\u8272\u548C\u6BCF\u4E2A\u6309\u94AE\u3002',
  "about.repo": '<strong>\u4EE3\u7801\u3002</strong><a href="https://github.com/tianlitao/ckbflybrain">github.com/tianlitao/ckbflybrain</a>\u3002',
  "guide.title": "\u9875\u9762\u600E\u4E48\u770B",
  "guide.lead": "<strong>\u9875\u9762\u4E0A\u7684\u4E00\u5207\u90FD\u6765\u81EA\u94FE\u3002</strong>\u6BCF\u4E2A\u6570\u5B57\u90FD\u662F\u679C\u8747\u72B6\u6001 cell \u91CC\u7684\u4E00\u4E2A\u5B57\u6BB5\uFF0C\u6BCF\u79CD\u989C\u8272\u90FD\u662F\u4E00\u4E2A\u819C\u7535\u4F4D\uFF0C\u56FE\u5F62\u7684\u6392\u5E03\u7528\u7684\u662F\u8FDE\u63A5\u7EC4\u81EA\u5DF1\u7684\u5E03\u5C40\u3002\u4E0B\u9762\u8BF4\u7684\u662F\u6BCF\u4E00\u90E8\u5206\u662F\u4EC0\u4E48\u610F\u601D\uFF0C\u4EE5\u53CA\u6BCF\u4E2A\u6309\u94AE\u4F1A\u505A\u4EC0\u4E48\u3002",
  "guide.ring.heading": "\u73AF\u5F62\u56FE",
  "guide.ring.one": "<strong>\u4E00\u4E2A\u5706\u70B9\u5C31\u662F\u4E00\u4E2A\u795E\u7ECF\u5143\u3002</strong>\u4E00\u5171 155 \u4E2A\uFF0C\u5B83\u4EEC\u7684\u4F4D\u7F6E\u4E0D\u662F\u88C5\u9970\uFF1A\u8FDE\u63A5\u7EC4\u8BB0\u5F55\u4E86\u6BCF\u4E2A\u7EC6\u80DE\u5C5E\u4E8E\u54EA\u4E2A\u6954\u533A\uFF0C\u6240\u4EE5\u5916\u5708\u662F\u692D\u7403\u4F53\u7684\u5341\u516D\u4E2A\u6954\u533A\uFF0C\u91CC\u9762\u90A3\u4E00\u5708\u662F\u5B8C\u5168\u4E0D\u5E26\u6954\u533A\u7684\u7EC6\u80DE\u2014\u201442 \u4E2A \u03947\u3002",
  "guide.ring.two": "<strong>\u989C\u8272\u662F\u819C\u7535\u4F4D\u3002</strong>\u6696\u8272\u662F\u53BB\u6781\u5316\uFF0C\u6700\u4EAE\u7684\u90A3\u4E9B\u662F\u4E0A\u4E00\u6B65\u521A\u653E\u7535\u7684\uFF1B\u51B7\u8272\u662F\u88AB\u6291\u5236\u538B\u4F4F\u7684\u8D85\u6781\u5316\uFF1B\u7070\u8272\u662F\u9759\u606F\u2014\u2014\u73AF\u4E0A\u5927\u90E8\u5206\u7EC6\u80DE\u5728\u5927\u90E8\u5206\u65F6\u95F4\u90FD\u662F\u8FD9\u4E2A\u72B6\u6001\u3002\u5706\u70B9\u8D8A\u5927\uFF0C\u79BB\u9759\u606F\u8D8A\u8FDC\u3002",
  "guide.ring.three": "<strong>0\u201315 \u8FD9\u4E9B\u6570\u5B57\u662F\u6954\u533A\u7684\u540D\u5B57</strong>\uFF0C\u5C31\u662F\u6A21\u578B\u5BF9\u8FD9\u5341\u516D\u4E2A\u6247\u533A\u7684\u53EB\u6CD5\u3002<code>cue</code> \u6307\u5B9A\u7684\u5C31\u662F\u5176\u4E2D\u4E4B\u4E00\uFF0C\u5B83\u70B9\u4EAE\u54EA\u4E2A\u6954\u533A\uFF0C\u54EA\u4E2A\u6954\u533A\u7684\u7EC6\u80DE\u5C31\u4F1A\u53BB\u6781\u5316\u3002",
  "guide.ring.four": "<strong>\u586B\u8272\u7684\u90A3\u4E00\u683C\u662F\u5B83\u6B64\u523B\u671D\u5411\u7684\u6954\u533A</strong>\uFF0C\u7528\u7684\u662F\u6A21\u62DF\u7D2F\u52A0\u6574\u5708\u65F6\u7528\u7684\u540C\u4E00\u4E2A\u671D\u5411\u5411\u91CF\u3002",
  "guide.ring.five": "<strong>\u5916\u5708\u7684\u6A59\u8272\u5F27\u662F\u8BB0\u5FC6\u3002</strong>\u6BCF\u4E2A\u6954\u533A\u7684\u5F27\u957F\u8868\u793A\u5B83\u8FD9\u4E00\u751F\u6709\u591A\u5C11\u65F6\u95F4\u671D\u7740\u8FD9\u4E2A\u65B9\u5411\u2014\u2014\u90A3\u662F\u72B6\u6001\u91CC\u7684\u671D\u5411\u76F4\u65B9\u56FE\uFF0C\u4E0D\u662F\u300C\u6700\u8FD1\u53D1\u751F\u4E86\u4EC0\u4E48\u300D\u7684\u753B\u6CD5\u3002",
  "guide.ring.six": "<strong>\u7BAD\u5934\u662F\u671D\u5411</strong>\uFF1A\u6574\u5708\u7684\u7FA4\u4F53\u5411\u91CF\uFF0C\u4E5F\u5C31\u662F\u5B83\u8D70\u8DEF\u7684\u65B9\u5411\u3002\u7535\u51FB\u4F1A\u628A\u5B83\u6253\u56DE\u96F6\uFF0C\u7BAD\u5934\u968F\u4E4B\u6D88\u5931\u2014\u2014\u8FD9\u65F6\u753B\u9762\u4F1A\u81EA\u5DF1\u8BF4\u660E\uFF0C\u800C\u4E0D\u662F\u8BA9\u8BFB\u8005\u4EE5\u4E3A\u56FE\u574F\u4E86\u3002",
  "guide.state.heading": "\u9762\u677F\u91CC\u7684\u90A3\u4E9B\u6570\u5B57",
  "guide.state.rows": "<tr><td><code>step</code></td><td>\u81EA\u521B\u4E16\u4EE5\u6765\u6A21\u62DF\u8FC7\u7684\u6B65\u6570\uFF0C\u53EA\u589E\u4E0D\u51CF\u2014\u2014\u8FDE\u6B7B\u4EA1\u4E5F\u4E0D\u4F1A\u8BA9\u5B83\u56DE\u9000</td></tr><tr><td><code>energy</code></td><td>\u8FD8\u5269\u591A\u5C11\u6B65\u5BFF\u547D\u3002\u4E00\u6B21 tick \u6BCF\u6B65\u82B1\u6389\u4E00\u683C\uFF0C<code>feed</code> \u628A\u5B83\u4E70\u56DE\u6765\uFF0C\u5F52\u96F6\u5373\u4E3A\u6B7B\u4EA1</td></tr><tr><td><code>generation</code></td><td>\u5B83\u6D3B\u8FC7\u51E0\u8F88\u5B50\uFF1B<code>resurrect</code> \u52A0\u4E00</td></tr><tr><td><code>spikes</code></td><td>\u6709\u795E\u7ECF\u5143\u653E\u7535\u8FC7\u591A\u5C11\u6B21\u2014\u2014\u4E00\u751F\u7D2F\u8BA1\uFF0C\u4EE5\u53CA\u672C\u4E16\u4EE3\u7D2F\u8BA1\uFF1B\u590D\u6D3B\u4E4B\u540E\u8FD9\u4E24\u4E2A\u6570\u4F1A\u4E0D\u4E00\u6837</td></tr><tr><td><code>bornBlock</code></td><td>\u5F53\u524D\u8FD9\u4E00\u751F\u5F00\u59CB\u4E8E\u54EA\u4E2A\u533A\u5757</td></tr><tr><td><code>stimulus</code></td><td>\u54EA\u4E2A\u523A\u6FC0\u901A\u9053\u88AB\u6B66\u88C5\u3001\u5F3A\u5EA6\u591A\u5C11\u3001\u5230\u54EA\u4E00\u6B65\u5931\u6548\u3002\u679C\u8747\u9760\u5B83\u8BB0\u4F4F\u81EA\u5DF1\u521A\u88AB\u8F6C\u8FC7</td></tr><tr><td><code>headX, headY</code></td><td>\u671D\u5411\u5411\u91CF\uFF0C\u6A21\u578B\u5355\u4F4D\uFF0C\u753B\u4E4B\u524D\u7684\u6837\u5B50</td></tr><tr><td><code>position</code></td><td>\u884C\u8D70\u628A\u5B83\u5E26\u5230\u4E86\u54EA\u91CC\uFF0C\u5355\u4F4D 1/256 \u4E2A cell</td></tr><tr><td><code>backing</code></td><td>\u8EAB\u4F53\u91CC\u9501\u7740\u7684\u5BB9\u91CF\uFF0C\u4E0E\u5B83\u4EE3\u8868\u7684\u5BFF\u547D\u3002\u8FD9\u672C\u8D26\u4E24\u8FB9\u5FC5\u987B\u76F8\u7B49\uFF0Ctype script \u4F1A\u6BD4\u5BF9</td></tr><tr><td><code>sightings</code></td><td>\u90A3\u4EFD\u8BB0\u5F55 cell \u770B\u8FC7\u5B83\u591A\u5C11\u6B21\u3001\u5199\u4E0B\u4E86\u591A\u5C11\u6B21</td></tr>",
  "guide.moves.heading": "\u6BCF\u4E2A\u6309\u94AE\u4F1A\u505A\u4EC0\u4E48",
  "guide.moves.rows": "<tr><td><strong>\u63A8\u8FDB 64 / 32 \u6B65</strong></td><td>\u628A\u795E\u7ECF\u7CFB\u7EDF\u8DD1\u8FD9\u4E48\u591A\u6B65\u3002\u4E00\u6B21 tick \u53EF\u80FD\u628A\u5B83\u8DD1\u6B7B\uFF0C\u8FD9\u662F\u6B63\u786E\u884C\u4E3A\u800C\u4E0D\u662F\u8FB9\u754C\u60C5\u51B5</td><td>\u4F60\u4ED8\u624B\u7EED\u8D39\uFF0C\u5E76\u62FF\u56DE\u90A3\u4E9B\u5BFF\u547D\u5BF9\u5E94\u7684\u5BB9\u91CF\u2014\u2014\u63A8\u8FDB 64 \u6B65\u662F 0.0064 CKB\u3002<strong>\u63A8\u8FDB\u662F\u8D5A\u94B1\u7684</strong></td></tr><tr><td><strong>\u6295\u5582 10,000 \u6B65</strong></td><td>\u4E70\u5230 10,000 \u6B65\u5BFF\u547D\uFF0C\u522B\u7684\u4EC0\u4E48\u90FD\u4E0D\u52A8\uFF1A\u6B65\u6570\u548C\u653E\u7535\u8BA1\u6570\u4E00\u52A8\u4E0D\u52A8</td><td>\u4F60\u82B1 1 CKB \u5BB9\u91CF\uFF0C\u5B83\u88AB\u6C38\u4E45\u9501\u8FDB\u8FD9\u5177\u8EAB\u4F53</td></tr><tr><td><strong>\u7EBF\u7D22\uFF0C\u6954\u533A 4</strong></td><td>\u5728\u6954\u533A 4 \u70B9\u4EAE\u4E00\u4E2A\u5730\u6807\uFF0C\u7136\u540E\u8DD1 32 \u6B65\u3002\u8FD9\u4E00\u6B65\u4F1A\u8BA9\u5B83\u8D70\u8D77\u6765\uFF1A\u7EBF\u7D22\u628A\u5305\u63A8\u8FC7\u53BB\uFF0C\u5305\u7684\u5411\u91CF\u53D8\u6210\u671D\u5411</td><td>\u624B\u7EED\u8D39\uFF0C\u52A0\u4E0A\u679C\u8747\u7684 544 \u6B65\u5BFF\u547D\u2014\u201432 \u6B65\u771F\u7684\u8DD1\u4E86\uFF0C512 \u6B65\u662F\u523A\u6FC0\u672C\u8EAB\u7684\u4EF7\u94B1</td></tr><tr><td><strong>\u5DE6\u8F6C / \u53F3\u8F6C</strong></td><td>\u9A71\u52A8\u4E00\u4FA7\u7684 PEN \u795E\u7ECF\u5143\uFF08\u89D2\u901F\u5EA6\uFF09\uFF0C\u8DD1 32 \u6B65\u3002\u5305\u4F1A\u6CBF\u7740\u73AF\u6ED1\u52A8\uFF0C\u8FD9\u548C\u771F\u5B9E\u679C\u8747\u8F6C\u5F2F\u65F6\u5B83\u505A\u7684\u662F\u4E00\u56DE\u4E8B</td><td>\u540C\u4E0A\uFF1A544 \u6B65\u5BFF\u547D</td></tr><tr><td><strong>\u7535\u51FB</strong></td><td>\u540C\u65F6\u9A71\u52A8\u5168\u90E8 42 \u4E2A \u03947 \u795E\u7ECF\u5143\uFF0C\u628A\u5305\u6253\u6563\u3002\u671D\u5411\u5F52\u96F6\uFF0C\u679C\u8747\u505C\u6B62\u884C\u8D70</td><td>544 \u6B65\u5BFF\u547D</td></tr><tr><td><strong>\u590D\u6D3B</strong></td><td>\u53EA\u5728\u5B83\u6B7B\u6389\u4E4B\u540E\u624D\u51FA\u73B0\uFF1A\u5F00\u59CB\u65B0\u7684\u4E00\u751F\u3001\u4EE3\u6570\u52A0\u4E00\u3002\u4E0A\u4E00\u751F\u7684\u6B65\u6570\u548C\u653E\u7535\u8BA1\u6570\u4F1A\u7559\u4E0B\u5F53\u5386\u53F2\uFF0C\u4E0A\u4E00\u751F\u6CA1\u82B1\u5B8C\u7684\u5BFF\u547D\u4E0D\u4F1A</td><td>\u4F60\u4E70\u65B0\u7684\u4E00\u751F\uFF0C\u5916\u52A0\u624B\u7EED\u8D39</td></tr>",
  "guide.money.heading": "\u94B1\u600E\u4E48\u52A8",
  "guide.money.body": "\u6BCF\u4E00\u7B14\u4EA4\u6613\u90FD\u7531\u7B7E\u540D\u5B83\u7684\u90A3\u4E2A\u94B1\u5305\u4ED8\u8D39\uFF0C\u624B\u7EED\u8D39\u7EA6 2,385 shannons\u2014\u20140.00002385 CKB\u2014\u2014\u8FD9\u662F\u5728 preview testnet \u4E0A\u5B9E\u6D4B\u7684\u3002\u5B83\u8DDF\u7740\u4EA4\u6613\u5927\u5C0F\u8D70\uFF0C\u800C\u4E0D\u662F\u8DDF\u7740\u811A\u672C\u505A\u4E86\u591A\u5C11\u8BA1\u7B97\u8D70\uFF0C\u6240\u4EE5\u63A8\u8FDB 64 \u6B65\u548C\u63A8\u8FDB 1 \u6B65\u7684\u53D1\u9001\u6210\u672C\u4E00\u6837\u3002\n\n\u63A8\u8FDB\u662F\u552F\u4E00\u4E00\u79CD\u300C\u4ED8\u94B1\u7ED9\u505A\u8FD9\u4EF6\u4E8B\u7684\u4EBA\u300D\u7684\u52A8\u4F5C\u3002\u72B6\u6001 cell \u5FC5\u987B\u6070\u597D\u7F29\u5C0F\u6389\u90A3\u4E9B\u88AB\u6D88\u8017\u7684\u5BFF\u547D\u6240\u80CC\u4E66\u7684\u5BB9\u91CF\u2014\u2014\u6BCF\u6B65 10,000 shannons\u2014\u2014\u800C\u8FD9\u4E9B\u5BB9\u91CF\u5FC5\u987B\u51FA\u73B0\u5728\u540C\u4E00\u7B14\u4EA4\u6613\u7684\u67D0\u4E2A\u5730\u65B9\uFF0C\u4E8E\u662F\u5B83\u8FDB\u4E86\u53D1\u9001\u8005\u7684\u627E\u96F6\u3002\u9A71\u52A8\u516C\u5171\u679C\u8747\u662F\u51C0\u8D5A\u7684\uFF1A\u5B9E\u6D4B\u4E24\u6B21\u63A8\u8FDB 64 \u6B65\uFF0C\u8BBF\u5BA2\u4F59\u989D\u591A\u4E86 0.0127523 CKB\uFF0C\u800C\u90E8\u7F72\u8005\u4E00\u5206\u672A\u52A8\uFF0C\u56E0\u4E3A\u90E8\u7F72\u8005\u6839\u672C\u4E0D\u5728\u4EA4\u6613\u91CC\u3002\n\n\u6295\u5582\u662F\u955C\u50CF\u65B9\u5411\uFF0C\u4E5F\u662F\u552F\u4E00\u7EAF\u7CB9\u5229\u4ED6\u7684\u52A8\u4F5C\uFF1A\u5BB9\u91CF\u8FDB\u5165\u8EAB\u4F53\uFF0C\u800C type script \u7981\u6B62\u9500\u6BC1\u8EAB\u4F53\uFF0C\u6240\u4EE5\u5B83\u518D\u4E5F\u51FA\u4E0D\u6765\u3002",
  "guide.locks.heading": "\u516C\u5F00\u679C\u8747\u4E0E\u79C1\u6709\u679C\u8747",
  "guide.locks.body": "\u679C\u8747\u7684 lock \u5728\u521B\u4E16\u65F6\u9009\u5B9A\u4E00\u6B21\uFF0C\u4E4B\u540E type script \u4F1A\u628A\u5B83\u9489\u6B7B\u4E00\u751F\uFF08<code>output.lock == input.lock</code>\uFF09\uFF0C\u6240\u4EE5\u65E2\u6362\u4E0D\u6389\u4E5F\u62A2\u4E0D\u8D70\u3002\n\n<strong><code>flylock</code></strong> \u662F\u90A3\u4E2A\u6765\u8005\u4E0D\u62D2\u7684\uFF1A\u5B83\u63A5\u53D7\u6BCF\u4E00\u7B14\u4EA4\u6613\u3002\u8FD9\u5C31\u662F\u300C\u516C\u5F00\u300D\u7684\u542B\u4E49\u2014\u2014\u8C01\u90FD\u80FD\u63A8\u8FDB\u5B83\uFF0C\u9A71\u52A8\u9762\u677F\u4E0A\u7684\u6309\u94AE\u5BF9\u4EFB\u4F55\u94B1\u5305\u90FD\u4F1A\u4EAE\u3002\n\n<strong><code>secp256k1_blake160</code> \u9501</strong>\u5219\u662F\u4E00\u53EA\u79C1\u6709\u679C\u8747\uFF1A\u8C01\u90FD\u80FD\u770B\uFF0C\u53EA\u6709\u62FF\u7740\u90A3\u628A\u94A5\u5319\u7684\u4EBA\u80FD\u63A8\u8FDB\u3002\u9875\u9762\u4F1A\u544A\u8BC9\u4F60\u6B63\u5728\u770B\u7684\u662F\u54EA\u4E00\u79CD\uFF0C\u5982\u679C\u8FDE\u4E0A\u7684\u94B1\u5305\u4E0D\u662F\u5BF9\u5E94\u7684\u94A5\u5319\uFF0C\u5B83\u4F1A\u4FDD\u6301\u6309\u94AE\u4E3A\u7070\u5E76\u8BF4\u660E\u539F\u56E0\u3002",
  "guide.trust.heading": "\u4E3A\u4EC0\u4E48\u4F60\u4E0D\u5FC5\u76F8\u4FE1\u8FD9\u4E2A\u9875\u9762",
  "guide.trust.body": "\u8FD9\u91CC\u6CA1\u6709\u4EFB\u4F55\u4E00\u53E5\u8BDD\u662F\u5728\u58F0\u79F0\u300C\u9875\u9762\u505A\u4E86\u4EC0\u4E48\u300D\u3002\u72B6\u6001\u662F\u4ECE\u94FE\u4E0A\u8BFB\u7684\uFF0C\u800C\u70B9\u51FB\u7EC4\u88C5\u7684\u4EA4\u6613\u53EA\u6709\u5728 type script \u91CD\u7B97\u51FA\u540C\u6837\u7684\u540E\u7EE7\u65F6\u624D\u4F1A\u88AB\u63A5\u53D7\u2014\u2014\u90A3\u6B63\u662F\u9875\u9762\u8DD1\u7684\u540C\u4E00\u4E2A <code>flycore</code>\uFF0C\u7531\u6BCF\u4E2A\u9A8C\u8BC1\u8005\u518D\u6267\u884C\u4E00\u904D\u3002\u9875\u9762\u6492\u8C0E\uFF0C\u4EA4\u6613\u5C31\u4F1A\u88AB\u94FE\u62D2\u7EDD\uFF1B\u94B1\u5305\u7B7E\u4E86\u522B\u7684\u4E1C\u897F\uFF0C\u4EA4\u6613\u5C31\u6CA1\u6709\u7ED3\u679C\u3002\u552F\u4E00\u503C\u5F97\u4F60\u8BA4\u771F\u8BFB\u7684\u662F\u94B1\u5305\u81EA\u5DF1\u5F39\u51FA\u6765\u7684\u63D0\u793A\uFF1B\u552F\u4E00\u65E0\u6CD5\u4ECE\u8FD9\u91CC\u9A8C\u8BC1\u7684\u662F\u8FDE\u63A5\u7EC4\u7684\u6765\u6E90\u2014\u2014\u5B83\u6765\u81EA FlyWire\uFF0C\u94FE\u53EA\u9489\u4F4F\u4E86\u5B83\u7684\u54C8\u5E0C\u3002",
  "guide.back": '<strong>\u56DE\u5230\u679C\u8747\u3002</strong><a href="./index.html">\u5B83\u672C\u8EAB</a>\u5728\u9996\u9875\u2014\u2014\u8FD9\u4E00\u9875\u53EA\u662F\u8BF4\u660E\u3002'
};
var DICTS = { en: EN, zh: ZH };
function preferred() {
  const tags = typeof navigator !== "undefined" && navigator.languages?.length ? navigator.languages : [typeof navigator !== "undefined" ? navigator.language : "en"];
  for (const tag of tags) {
    if (/^zh\b/i.test(tag ?? "")) {
      return "zh";
    }
  }
  return "en";
}
var current = preferred();
function lang() {
  return current;
}
function t(key, params) {
  const text = DICTS[current][key] ?? EN[key] ?? key;
  if (!params) {
    return text;
  }
  return text.replace(
    /\{(\w+)\}/g,
    (whole, name) => params[name] === void 0 ? whole : String(params[name])
  );
}
function setLang(next) {
  if (next !== "en" && next !== "zh") {
    throw new Error(`unknown language ${next}`);
  }
  current = next;
}

// public/i18n-dom.source.js
var STORAGE = "ckbfly.lang";
var listeners = [];
function initLanguage() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE);
  } catch {
  }
  if (stored === "en" || stored === "zh") {
    setLang(stored);
  }
  document.documentElement.lang = lang() === "zh" ? "zh-Hans" : "en";
  document.title = t("doc.title");
  return lang();
}
function applyLanguage() {
  document.documentElement.lang = lang() === "zh" ? "zh-Hans" : "en";
  document.title = t("doc.title");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-html]")) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
}
function renderLanguageSwitch() {
  const target = document.getElementById("lang-switch");
  if (!target) {
    return;
  }
  target.innerHTML = "";
  for (const code of ["en", "zh"]) {
    const button = document.createElement("button");
    button.className = code === lang() ? "lang active" : "lang";
    button.textContent = code === "en" ? "EN" : "\u4E2D\u6587";
    button.setAttribute("aria-pressed", String(code === lang()));
    button.addEventListener("click", () => choose(code));
    target.append(button);
  }
}
function choose(code) {
  if (code === lang()) {
    return;
  }
  setLang(code);
  try {
    localStorage.setItem(STORAGE, code);
  } catch {
  }
  applyLanguage();
  renderLanguageSwitch();
  for (const fn of listeners) {
    fn(code);
  }
}
function onLanguage(fn) {
  listeners.push(fn);
}

// public/pages.source.js
var here = document.documentElement.dataset.page;
var titleKey = here === "guide" ? "doc.titleGuide" : "doc.titleAbout";
var setTitle = () => {
  document.title = t(titleKey);
};
initLanguage();
applyLanguage();
setTitle();
renderLanguageSwitch();
onLanguage(setTitle);
