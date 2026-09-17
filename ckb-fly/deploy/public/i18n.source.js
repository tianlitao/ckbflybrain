/**
 * Two languages, and the rule that keeps them honest.
 *
 * # Why the dictionary is a module and not inline in the page
 *
 * It is DOM-free on purpose: `test/i18n.test.js` imports it and asserts that the two
 * dictionaries have **the same keys**. That is the one failure mode this design has — a key
 * added to English and forgotten in Chinese renders as English (by fallback) or as the key
 * itself, and both would ship without anyone noticing, because the page looks fine in whichever
 * language the person checking it happens to read.
 *
 * # Keys, not sentences
 *
 * Every user-visible string on the page is looked up here, including the ones built in
 * JavaScript with values in them (`{n}`, `{step}`, …). The substituted values are never
 * translated: addresses, hashes and numbers are the same in both languages, and a
 * translator who localises a hex string has broken the page.
 *
 * The Chinese is not a word-for-word rendering of the English. Where the English explains a
 * mechanism in a subordinate clause, the Chinese says the same thing in the order a Chinese
 * reader expects it, and the technical nouns keep the words the rest of this project uses
 * (`cell`, `lock`, `witness`, `shadow`, `type script` → 细胞、锁、witness、type script…). Where a
 * term has no settled Chinese form, the English is kept and glossed rather than invented.
 *
 * @module i18n
 */

const EN = {
  "doc.title": "CKB Fly — a fruit fly on Nervos CKB",
  "lang.name": "English",
  "lang.other": "中文",

  "app.name": "CKB Fly",
  // Every caption that runs to more than one sentence opens with a `<strong>` lead: the sentence
  // that says what the panel *is*. Rendered through `data-i18n-html` rather than `data-i18n`
  // because of it — see the note in `i18n-dom.source.js`. The point is that a reader can find out
  // whether they need to read the paragraph without reading it.
  "app.standfirst":
    "<strong>A fruit fly's heading circuit, running on Nervos CKB: 155 neurons, 6,522 " +
    "connections.</strong> The fly is a cell on the chain. Every action spends that cell and " +
    "creates the next one, and a script on the chain checks that the new cell is exactly what the " +
    "action computes. If it is not, the whole transaction is rejected.",

  "world.heading": "The world",
  "world.countOne": "1 organism on this chain",
  "world.count": "{n} organisms on this chain",
  "world.caption":
    "<strong>Every living fly on this chain, found by looking for cells whose type script comes " +
    "from the flybrain code.</strong> Each fly has its own type script, so one query finds them " +
    "all. What tells them apart is the eight-byte instance in the args; without it this list " +
    "would have one row. Click a row to watch that fly.",

  "ring.heading": "The ring",
  "ring.headingAtStep": "The ring at step {step}",
  "ring.caption":
    "<strong>The outer ring is the sixteen wedges of the ellipsoid body, numbered 0–15; the cells " +
    "inside it are Δ7, which have no wedge.</strong> One dot is one neuron: its colour is its " +
    "membrane potential — warm is depolarised or just fired, cool is hyperpolarised, grey is at " +
    "rest — and its size follows how far from rest it is. The orange arcs outside are that wedge's heading memory, the " +
    "filled sector is the wedge the fly is pointing at now, and the arrow in the middle is the " +
    "ring's population vector, which is the direction the fly walks along.",
  "ring.innerRing": "Δ7 · {n} cells, no wedge",
  "ring.noHeading": "no heading — the bump is collapsed",
  "ring.unpin": "return to live",

  "life.heading": "Life",
  "life.step": "step",
  "life.energy": "energy",
  "life.stepsOfLife": "{n} steps of life",
  "life.alive": "alive",
  "life.yes": "yes",
  "life.dead": "no — only resurrect is meaningful",
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
  "backing.caption":
    "<strong>The fly has no token.</strong> Its capacity <em>is</em> its body and its remaining " +
    "life, and the two sides of this ledger have to be equal — the type script compares them.",
  "backing.perStep": "backing / step",
  "backing.shannons": "{n} shannons",
  "backing.body": "body",
  "backing.life": "life",
  "backing.required": "required",
  "backing.held": "held",
  "backing.notLiveCell": "— (not the live cell)",

  "chronicle.heading": "Chronicle",
  "chronicle.caption":
    "<strong>A second type script, <code>flyworld</code>, keeps this record — in the same " +
    "transaction as the transition it describes.</strong> It is not told what the fly did: it " +
    "is required to look at the fly, which must be present, and to record exactly what it " +
    "finds. Nothing here was supplied by whoever sent the transaction, and the cell's own " +
    "capacity never changes, so it cannot be used to hide value either.",
  "chronicle.record": "record",
  "chronicle.none": "none — this fly was deployed before the chronicle existed",
  "chronicle.life": "life",
  "chronicle.alive": "alive",
  "chronicle.dead": "dead — only resurrect is meaningful",
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
  "walk.captionAt":
    "At ({x}, {y}) in 1/256th of a cell. {n} earlier positions are on the path.",

  "identity.typeScript": "type script",
  "identity.params": "params",
  "identity.economics": "economics",
  "identity.connectome": "connectome",
  "identity.neurons": "neurons",
  "identity.neuronsValue": "{n} · {wedges} wedges",
  "identity.chain": "chain",

  "roster.step": "step {n}",
  "roster.life": "{state} · gen {generation}",
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
  "action.genesisDetail": "no fly consumed — a new organism",
  "action.tick": "tick",
  "action.tickDetail": "{n} steps",
  "action.stimulate": "stimulate",
  "action.stimulateDetail": "{name}, param {param}, strength {strength}, {n} steps",
  "action.feed": "feed",
  "action.feedDetail": "{n} steps of life bought",
  "action.resurrect": "resurrect",
  "action.resurrectDetail": "{n} steps, born block {block}",

  "timeline.heading": "Life so far",
  "timeline.caption":
    "<strong>Every step this fly has taken.</strong> Newest first: each row is one state cell, " +
    "and the action comes out of that transaction's witness. All of it is already on the chain.",
  "timeline.block": "block {n}",
  "timeline.step": "step {n}",

  "wallet.heading": "Wallet",
  "wallet.address": "address",
  "wallet.none": "—",
  "wallet.wallet": "wallet",
  "wallet.connectOpen": "Connect a wallet",
  "wallet.disconnect": "disconnect",
  "wallet.connected": "connected {address}…",
  "wallet.noteConnected":
    "<strong>The actions you click in the Drive panel are paid for and signed by this " +
    "wallet.</strong> The page builds the transaction and works out the next state in your " +
    "browser with <code>flywasm</code>. There is no key on this page.",
  "wallet.noteOffered":
    "<strong>Pick a wallet with the button at the top right.</strong> The list comes from CCC's " +
    "connector, so it has every wallet CCC supports — one that is not installed says so when you " +
    "pick it. Once connected, your wallet pays for and signs whatever you click.",

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
  "drive.noteDead":
    "<strong>The fly is dead, so only resurrection does anything here.</strong> Its life reached " +
    "zero. Resurrecting starts a new life and adds one to the generation; life left over from " +
    "the old one does not carry across.",
  // The second line of each card: what the click costs the fly. `tick 64` and `tick 32` are one
  // digit apart and differ by twice the life, and the only place that difference can be said is
  // under the label. `{ckb}` on the feed card is computed from `economics.backingPerStep` rather
  // than written in, so the two numbers cannot drift apart.
  "drive.lifeLeft": "{n} steps of life left",
  "drive.subTick": "spends {n} steps of life",
  "drive.subFeed": "adds {n} steps of life · +{ckb} CKB",
  "drive.subCue": "holds a landmark · spends {n} steps",
  "drive.subShock": "an aversive pulse · spends {n} steps",
  // Two sentences explain why these buttons work, and both carry markup because they open with a
  // bold lead like every caption on the page. `drive.disabled` is the exception and is named for a
  // reason: it interpolates the refusal the click will be met with, and a computed string goes in
  // as *text*, never as markup.
  "drive.noteWallet":
    "<strong>Ready: a transaction costs your wallet a fee and a signature.</strong> The page " +
    "builds it (the next state is computed in your browser by <code>flywasm</code>), and your " +
    "key stays in your wallet.",
  "drive.noteConnect":
    "<strong>Nothing to click yet: a transaction needs someone to pay for it and sign it.</strong> " +
    "Connect a wallet in the top right. If it is the right key for this fly, the buttons light up.",
  "drive.disabled": "Disabled: {reason}",
  "drive.asking": "asking your wallet to sign {kind}…",
  "drive.sent":
    "sent {tx} — signed and paid by your wallet; the next poll shows what the chain made of it",

  "status.connecting": "connecting…",
  "status.read": "{n} transitions read from the chain · updated {time}",
  "status.nodeError": "the node reported: {error}",
  "status.watching": "watching {instance} ({hash}…)",
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
  "doc.titleAbout": "CKB Fly — what this is",
  "doc.titleGuide": "CKB Fly — how to read the page",

  "about.title": "What this is",
  "about.lead":
    "<strong>One fruit fly's heading circuit, running on Nervos CKB: 155 neurons, 6,522 " +
    "connections and 45,961 synapses, from the FlyWire release 783 connectome.</strong> It is " +
    "not a simulation running somewhere else, and it is not a token — the fly is a cell on the " +
    "chain, and every step it takes is recomputed there.",

  "about.why.heading": "Why a ring attractor",
  "about.why.body":
    "The fly keeps its heading with a ring of neurons in the ellipsoid body. A patch of activity " +
    "— the bump — sits somewhere on that ring, and where it sits is which way the fly is facing: " +
    "a landmark pulls it to one place, a turn slides it along, and the ring's combined vector is " +
    "the direction the fly walks in. It is one of the few brain circuits that can be explained " +
    "with a single picture, which is why it is the one we put on chain.",

  "about.exact.heading": "The port is bit-exact, and that is the point",
  "about.exact.body":
    "This is the same circuit as <code>MidTermDev/immortal-fruit-fly</code>, which implements it " +
    "in Solidity on BNB Smart Chain. The same actions produce the same 155 membrane potentials, " +
    "the same engram values and the same 16 heading bins, checked against the real action " +
    "sequence that contract executed on mainnet and replayed inside CKB-VM.",

  "about.cell.heading": "Why CKB, and why there is no token",
  "about.cell.body":
    "On the EVM the fly's state lives in storage slots, and every step pays for every slot it " +
    "rewrites. Here the whole state is one cell of 1,213 bytes: a step consumes it and creates " +
    "the next one, and the script that guards it writes nothing — it recomputes the result from " +
    "the action in the witness and refuses anything that does not match. Fees are charged by " +
    "transaction size rather than by computation, so a step here costs about 2,385 shannons " +
    "(measured) where the same step on BSC cost 0.00034 BNB.\n\n" +
    "There is no token. A step of life is backed by capacity locked inside the fly — 10,000 " +
    "shannons per step — and the type script will not let the body be destroyed, so that capacity " +
    "cannot be taken out again.",

  "about.immortal.heading": "What \u201cimmortal\u201d means here, exactly",
  "about.immortal.body":
    "The type script requires that any transaction touching the fly produces exactly one output " +
    "cell of the same type, with the same lock. So nothing can delete the fly — not even whoever " +
    "deployed it — because there is no way to spend the cell without leaving a successor. Dying " +
    "is not an exception: death is a state (life reaches zero and the fly stops), and " +
    "<code>resurrect</code> starts a new life and adds one to the generation. Beside it is a " +
    "second type script, <code>flyworld</code>, which is updated in the same transaction and is " +
    "not told what happened: it has to look at the fly itself.",

  "about.server.heading": "There is no server",
  "about.server.body":
    "This is a folder of files. The page reads the chain directly over JSON-RPC, works out the " +
    "next state in your browser with <code>flywasm</code> — the same code the chain's validator " +
    "runs, compiled to wasm your browser can execute — and builds the transaction itself. " +
    "Connect a wallet and you pay and sign. There is no operator, and nothing to keep running.",

  "about.not.heading": "What this is not",
  "about.not.body":
    "What runs here is the fly's heading circuit, not its whole brain. A whole brain does not " +
    "fit on a chain.\n\n" +
    "How far back the page can show depends on how far back the node you are reading remembers; " +
    "run your own CKB node if you want older history.\n\n" +
    "And a fly whose lock is <code>flylock</code> can be driven by anyone. That is what public " +
    "means here.",

  "about.more":
    "Next: <a href=\"./guide.html\">how to read the page</a> — what every number, colour and " +
    "button means.",
  "about.repo":
    "The code: <a href=\"https://github.com/tianlitao/ckbflybrain\">" +
    "github.com/tianlitao/ckbflybrain</a>.",

  "guide.title": "How to read the page",
  "guide.lead":
    "<strong>Everything on the page comes from the chain.</strong> Every number is a field of the " +
    "fly's state cell, every colour is a membrane potential, and the drawing uses the connectome's " +
    "own layout. What follows is what each part means and what each button does to it.",

  "guide.ring.heading": "The ring",
  "guide.ring.one":
    "<strong>One dot is one neuron.</strong> There are 155 and their positions are not decoration: " +
    "the connectome says which wedge each cell belongs to, so the outer ring is the sixteen wedges " +
    "of the ellipsoid body and the ring inside it holds the cells with no wedge at all — the 42 " +
    "Δ7 cells.",
  "guide.ring.two":
    "<strong>Colour is membrane potential.</strong> Warm is depolarised and the brightest cells " +
    "are the ones that fired on the last step; cool is hyperpolarised, held down by inhibition; " +
    "and grey is at rest, which is where most of the ring is most of the time. The dot grows with " +
    "how far it is from rest.",
  "guide.ring.three":
    "<strong>The numbers 0–15 are the wedges</strong> — the model's own names for the sixteen " +
    "sectors. A <code>cue</code> names one of them, and the wedge it lights is the one whose cells " +
    "depolarise.",
  "guide.ring.four":
    "<strong>The filled sector is where the fly is pointing now</strong>, and it is computed from " +
    "the same heading vector the simulation sums the ring over.",
  "guide.ring.five":
    "<strong>The orange arcs outside are memory.</strong> Each wedge's arc grows with how much of " +
    "its life the fly has spent pointing that way — the heading histogram, which is a field of the " +
    "state and not a drawing of the recent past.",
  "guide.ring.six":
    "<strong>The arrow is the heading</strong>: the population vector of the whole ring, which is " +
    "the direction the fly walks along. A shock collapses it to zero, and the arrow disappears with " +
    "it — when that happens the drawing says so rather than leaving a reader to wonder.",

  "guide.state.heading": "The numbers in the panels",
  "guide.state.rows":
    "<tr><td><code>step</code></td><td>steps simulated since genesis, and it never decreases — " +
    "not even across a death</td></tr>" +
    "<tr><td><code>energy</code></td><td>steps of life left. A tick spends one per step, " +
    "<code>feed</code> buys them, and zero means dead</td></tr>" +
    "<tr><td><code>generation</code></td><td>how many lives it has had; " +
    "<code>resurrect</code> adds one</td></tr>" +
    "<tr><td><code>spikes</code></td><td>how many times a neuron has fired, ever, and in this " +
    "life — the two differ after a resurrection</td></tr>" +
    "<tr><td><code>bornBlock</code></td><td>the block the current life began in</td></tr>" +
    "<tr><td><code>stimulus</code></td><td>which channel is armed, how strong, and the step it " +
    "expires at. This is how a fly remembers it was just turned</td></tr>" +
    "<tr><td><code>headX, headY</code></td><td>the heading vector in the model's units, before " +
    "anything is drawn</td></tr>" +
    "<tr><td><code>position</code></td><td>where walking has carried it, in 1/256 of a cell</td></tr>" +
    "<tr><td><code>backing</code></td><td>capacity locked in the body against the life it " +
    "represents. The two sides of that ledger have to be equal, and the type script compares " +
    "them</td></tr>" +
    "<tr><td><code>sightings</code></td><td>how many times the chronicle cell has looked at the " +
    "fly and written down what it saw</td></tr>",

  "guide.moves.heading": "What each button does",
  "guide.moves.rows":
    "<tr><td><strong>tick 64</strong> / <strong>tick 32</strong></td>" +
    "<td>runs the nervous system that many steps. A tick can kill the fly, and that is correct " +
    "rather than an edge case</td>" +
    "<td>you pay the fee and get back the capacity that backed the steps — 0.0064 CKB for " +
    "tick 64. <strong>Ticking pays you</strong></td></tr>" +
    "<tr><td><strong>feed 10,000</strong></td><td>buys 10,000 steps of life and changes nothing " +
    "else: the step counter and the spike count do not move</td><td>you spend 1 CKB of capacity " +
    "and it is locked into the body for good</td></tr>" +
    "<tr><td><strong>cue, wedge 4</strong></td><td>lights a landmark in wedge 4 and then runs 32 " +
    "steps. This is the move that makes the fly walk: the cue pushes the bump, the bump's vector " +
    "becomes the heading</td><td>the fee, plus 544 steps of the fly's life — 32 simulated and 512 " +
    "for the stimulus itself</td></tr>" +
    "<tr><td><strong>turn left</strong> / <strong>turn right</strong></td><td>drives the PEN " +
    "neurons on one side — angular velocity — and runs 32 steps. The bump slides round the ring, " +
    "which is what a real turning fly's does</td><td>as above: 544 steps of life</td></tr>" +
    "<tr><td><strong>shock</strong></td><td>drives all 42 Δ7 neurons at once, collapsing the " +
    "bump. The heading goes to zero and the fly stops moving</td><td>544 steps of life</td></tr>" +
    "<tr><td><strong>resurrect</strong></td><td>only offered when the fly is dead: starts a new " +
    "life and increases the generation. The previous life's step count and spikes are kept as " +
    "history, its unspent life is not</td><td>you buy the new life, plus the fee</td></tr>",

  "guide.money.heading": "Where the money goes",
  "guide.money.body":
    "Every transaction is paid for by the wallet that signs it, and the fee is about 2,385 " +
    "shannons — 0.00002385 CKB — measured on preview testnet. It follows the transaction's size " +
    "rather than the work the script does, which is why a 64-step tick costs no more to send than " +
    "a 1-step one.\n\n" +
    "A tick is the only move that pays the person who made it. The cell must shrink by exactly the " +
    "capacity that backed the steps consumed — 10,000 shannons each — and that capacity has to go " +
    "somewhere in the same transaction, so it goes to the sender's change output. Driving a public " +
    "fly is net-positive: measured, two ticks of 64 left a visitor 0.0127523 CKB richer and cost " +
    "the deployer nothing, because the deployer is not in the transaction at all.\n\n" +
    "Feeding is the mirror image, and the only purely altruistic move: capacity goes into the body " +
    "and the type script forbids destroying the body, so it can never come out.",

  "guide.locks.heading": "Public flies and private ones",
  "guide.locks.body":
    "A fly's lock is chosen once, at genesis, and the type script pins it for the organism's whole " +
    "life (<code>output.lock == input.lock</code>), so it can neither be changed nor taken away.\n\n" +
    "<strong><code>flylock</code></strong> is the permissive one: it accepts every transaction. " +
    "That is what makes a fly public — anyone may advance it, and the Drive buttons light up for " +
    "any wallet.\n\n" +
    "<strong>A <code>secp256k1_blake160</code> lock</strong> makes a private fly: watchable by " +
    "anyone, advanceable only by whoever holds that key. The page says which kind you are looking " +
    "at, and it keeps the buttons grey when your wallet is the wrong key, with the reason.",

  "guide.trust.heading": "Why you do not have to trust the page",
  "guide.trust.body":
    "Every number on the page comes from the chain, and every action you click has to be " +
    "recomputed by a script on the chain before it is accepted. So if the page showed you " +
    "something wrong, the transaction would not go through; if your wallet signed something " +
    "else, there would be nothing to show for it. Addresses, transaction hashes and every " +
    "step's state can all be looked up on the chain. The connectome itself comes from FlyWire, " +
    "and the chain only pins its hash — that part is not verifiable from here.",
  "guide.back":
    "<strong>Back to the fly.</strong> <a href=\"./index.html\">The organism itself</a> is on the " +
    "front page — this one is only prose.",
};

const ZH = {
  "doc.title": "CKB 果蝇 —— 一只活在 Nervos CKB 上的果蝇",
  "lang.name": "中文",
  "lang.other": "English",

  "app.name": "CKB 果蝇",
  "app.standfirst":
    "<strong>这是一只果蝇的朝向回路，跑在 Nervos CKB 上：155 个神经元、6,522 条连接。</strong>" +
    "果蝇就是链上的一个 cell。每做一次动作，旧 cell 被花掉、新 cell 被创建，" +
    "链上的脚本会核对新 cell 是不是这次动作算出来的结果；对不上，整笔交易就不作数。",

  "world.heading": "世界",
  "world.countOne": "这条链上有 1 只生物",
  "world.count": "这条链上有 {n} 只生物",
  "world.caption":
    "<strong>这张表里是链上所有活着的果蝇，它们的 type script 都来自 flybrain 这段代码。</strong>" +
    "每只果蝇的 type script 都不一样，所以查一次就能把它们全列出来。" +
    "它们彼此的区别在 args 里那 8 个字节的 instance；没有它，这里就只有一行。点一行看那一只。",

  "ring.heading": "环形",
  "ring.headingAtStep": "第 {step} 步时的环",
  "ring.caption":
    "<strong>外圈是椭球体的十六个楔区，编号 0–15；里面的细胞是没有楔区的 Δ7。</strong>" +
    "一个圆点就是一个神经元：颜色是它的膜电位（暖＝去极化或刚放电，冷＝超极化，灰＝静息），" +
    "大小是它离静息有多远。" +
    "环外的橙色弧长是那个楔区的朝向历史，填色的那一格是它此刻朝向的楔区，" +
    "中间的箭头是整圈的方向向量——果蝇就是沿它走路的。",
  "ring.innerRing": "Δ7 · {n} 个细胞，无楔区",
  "ring.noHeading": "朝向为空——bump 已被打散",
  "ring.unpin": "回到实时",

  "life.heading": "生命",
  "life.step": "步数",
  "life.energy": "能量",
  "life.stepsOfLife": "{n} 步寿命",
  "life.alive": "存活",
  "life.yes": "是",
  "life.dead": "否 —— 此时只有 resurrect 有意义",
  "life.generation": "世代",
  "life.spikes": "脉冲",
  "life.spikesThisLife": "{total}（本次生命：{life}）",
  "life.bornBlock": "出生区块",
  "life.stimulus": "刺激",
  "life.orientation": "朝向",

  "backing.heading": "支撑",
  "backing.caption":
    "<strong>这只果蝇没有代币。</strong>它的容量就是它的身体加上剩下的寿命，这本账的两边必须相等——" +
    "type script 会比对。",
  "backing.perStep": "每步支撑",
  "backing.shannons": "{n} shannons",
  "backing.body": "身体",
  "backing.life": "寿命",
  "backing.required": "需要",
  "backing.held": "实际持有",
  "backing.notLiveCell": "—（不是当前存活的 cell）",

  "chronicle.heading": "编年史",
  "chronicle.caption":
    "<strong>这份记录由第二个 type script <code>flyworld</code> 保存——与它所描述的那次状态" +
    "转换写在同一笔交易里。</strong>它不被告知果蝇做了什么：它必须自己去看（而果蝇必须在场），" +
    "并如实记下看到的东西。这里没有任何一项是发交易的人提供的；这个 cell 自己的容量永不改变，" +
    "所以它也不能被用来藏钱。",
  "chronicle.record": "记录",
  "chronicle.none": "无 —— 这只果蝇在编年史存在之前就已部署",
  "chronicle.life": "生命",
  "chronicle.alive": "存活",
  "chronicle.dead": "已死亡 —— 此时只有 resurrect 有意义",
  "chronicle.generation": "世代",
  "chronicle.bornAtStep": "出生步数",
  "chronicle.diedAtStep": "死亡步数",
  "chronicle.lastSighting": "最近一次目击",
  "chronicle.lastSightingValue": "第 {step} 步，能量 {energy}",
  "chronicle.sightings": "目击次数",
  "chronicle.fed": "投入",
  "chronicle.released": "释放",
  "chronicle.net": "净额",
  "chronicle.stateHash": "状态哈希",

  "walk.heading": "行走",
  "walk.caption": "果蝇去过的地方，单位是 1/256 个 cell。",
  "walk.captionAt": "位于 ({x}, {y})，单位 1/256 个 cell。路径上还有 {n} 个更早的位置。",

  "identity.typeScript": "type script",
  "identity.params": "参数集",
  "identity.economics": "经济模型",
  "identity.connectome": "连接组",
  "identity.neurons": "神经元",
  "identity.neuronsValue": "{n} 个 · {wedges} 个楔区",
  "identity.chain": "链",

  "roster.step": "第 {n} 步",
  "roster.life": "{state} · {generation} 代",
  "roster.alive": "存活",
  "roster.dead": "死亡",
  "roster.spikes": "{n} 脉冲",
  "roster.sightings": "{n} 次目击",
  "roster.noChronicle": "无编年史",
  "roster.key": "可驱动",
  "roster.keyTitle": "你的钱包可以推进这只生物",

  "stimulus.none": "无",
  "stimulus.cue": "线索",
  "stimulus.turnLeft": "左转",
  "stimulus.turnRight": "右转",
  "stimulus.shock": "电击",
  "stimulus.active": "{name}，强度 {strength}，持续到第 {until} 步",

  "action.genesis": "创世",
  "action.genesisDetail": "没有花掉任何果蝇 —— 一只新生物",
  "action.tick": "推进",
  "action.tickDetail": "{n} 步",
  "action.stimulate": "刺激",
  "action.stimulateDetail": "{name}，参数 {param}，强度 {strength}，{n} 步",
  "action.feed": "投喂",
  "action.feedDetail": "买下 {n} 步寿命",
  "action.resurrect": "复活",
  "action.resurrectDetail": "{n} 步，出生区块 {block}",

  "timeline.heading": "迄今为止",
  "timeline.caption":
    "<strong>这只果蝇走到今天的每一步。</strong>从上往下是从近到远：每一行都是一个状态 cell，" +
    "动作从那笔交易的 witness 里读出来，全部是链上原有的数据。",
  "timeline.block": "区块 {n}",
  "timeline.step": "第 {n} 步",

  "wallet.heading": "钱包",
  "wallet.address": "地址",
  "wallet.none": "—",
  "wallet.wallet": "钱包",
  "wallet.connectOpen": "连接钱包",
  "wallet.disconnect": "断开",
  "wallet.connected": "已连接 {address}…",
  "wallet.noteConnected":
    "<strong>你在驱动面板里点的动作，由这个钱包付费并签名。</strong>" +
    "页面负责拼交易，下一步的状态用 <code>flywasm</code> 在浏览器里算出来。页面上没有任何私钥。",
  "wallet.noteOffered":
    "<strong>点右上角的按钮选择钱包。</strong>" +
    "列表由 CCC 的连接器提供，CCC 支持的钱包都在里面；没装的那个在选中时会告诉你。" +
    "连上之后，你点这里的动作就由它付费、由它签名。",

  "drive.heading": "驱动",
  "drive.tick": "推进 {n} 步",
  "drive.feed": "投喂 {n} 步",
  "drive.cue": "线索，楔区 {wedge}",
  "drive.shock": "电击",
  "drive.turnLeft": "左转",
  "drive.turnRight": "右转",
  "drive.resurrect": "复活",
  "drive.subTurn": "消耗 {n} 步",
  "drive.subResurrect": "买到 {n} 步寿命",
  "drive.noteDead":
    "<strong>果蝇已经死了，这里只有复活有效。</strong>它的寿命走到了零。" +
    "复活会开始新的一生、代数加一；上一生没花完的寿命不会留下。",
  "drive.lifeLeft": "还剩 {n} 步寿命",
  "drive.subTick": "消耗 {n} 步寿命",
  "drive.subFeed": "补充 {n} 步寿命 · +{ckb} CKB",
  "drive.subCue": "保持一个路标 · 消耗 {n} 步",
  "drive.subShock": "厌恶刺激 · 消耗 {n} 步",
  "drive.noteWallet":
    "<strong>可以点击：每笔交易由你的钱包付手续费并签名。</strong>" +
    "页面负责把交易拼好（下一步的状态由 <code>flywasm</code> 在浏览器里算出来），私钥始终留在钱包里。",
  "drive.noteConnect":
    "<strong>现在点不了：需要有人为交易付手续费并签名。</strong>" +
    "在右上角连接一个钱包；如果它正好是这只果蝇的钥匙，按钮就会亮起来。",
  "drive.disabled": "已禁用：{reason}",
  "drive.asking": "正在请你的钱包为 {kind} 签名…",
  "drive.sent": "已发送 {tx} —— 由你的钱包签名并付费；下一次轮询会显示链上确认后的结果",

  "status.connecting": "正在连接…",
  "status.read": "已从链上读出 {n} 次状态转换 · 更新于 {time}",
  "status.nodeError": "节点报告：{error}",
  "status.watching": "正在观看 {instance}（{hash}…）",
  "status.cannotLoad": "无法加载 {tx}",

  "nav.home": "果蝇",
  "nav.about": "这是什么",
  "nav.guide": "怎么看",
  "doc.titleAbout": "CKB 果蝇 —— 这是什么",
  "doc.titleGuide": "CKB 果蝇 —— 页面怎么看",

  "about.title": "这是什么",
  "about.lead":
    "<strong>这是一只果蝇的朝向回路，跑在 Nervos CKB 上：155 个神经元、6,522 条连接、" +
    "45,961 个突触，连接组来自 FlyWire release 783。</strong>" +
    "它不是链下的模拟，也不是代币——这只果蝇就是链上的一个 cell，它的每一步都由链重新算一遍。",

  "about.why.heading": "为什么是环形吸引子",
  "about.why.body":
    "果蝇靠椭球体里的一圈神经元记住朝向。环上有一片活动最强的区域（bump），它在环上的位置就是" +
    "果蝇面朝的方向：地标把它拉到某个位置，转向让它沿着环滑动，整圈的合成向量就是它走路的方向。" +
    "这是少数几个用一张图就能讲清楚的脑回路，所以我们把它放上了链。",

  "about.exact.heading": "移植是逐位精确的，这正是重点",
  "about.exact.body":
    "它和 <code>MidTermDev/immortal-fruit-fly</code> 跑的是同一套回路，" +
    "那个版本用 Solidity 实现在 BNB Smart Chain 上。同样的动作序列会得到同样的 155 个膜电位、" +
    "同样的 engram、同样的 16 个朝向直方图格——这是对着主网上真实执行过的动作序列核对过的，" +
    "也在 CKB-VM 里重放过。",

  "about.cell.heading": "为什么放 CKB 上，以及为什么没有代币",
  "about.cell.body":
    "在 EVM 上，果蝇的状态存在 storage 槽里，每一步都要为改写的每个槽付费。" +
    "在这里，整个状态就是 1,213 字节的一个 cell：一步消费它、创建下一个，" +
    "守着它的脚本什么都不写——它按 witness 里的动作把结果重算一遍，对不上就拒绝。" +
    "手续费按交易大小收，不按计算量收，所以这里一步约 2,385 shannons（实测），" +
    "而同样的那一步在 BSC 上是 0.00034 BNB。\n\n" +
    "没有代币。一步寿命由锁在果蝇身体里的容量背书——每步 10,000 shannons——" +
    "而 type script 不允许销毁这具身体，所以这部分容量取不出来。",

  "about.immortal.heading": "「永生」在这里的准确含义",
  "about.immortal.body":
    "type script 要求：任何碰到这只果蝇的交易，都必须产出恰好一个同类型、同 lock 的输出 cell。" +
    "所以没有谁能删掉它——连部署者也不行——因为不存在一种「花掉它却不留下后继」的花法。" +
    "死亡不是例外：死是一种状态（寿命归零、停止活动），<code>resurrect</code> 会开始新的一生、把代数加一。" +
    "旁边那份记录是第二个 type script，<code>flyworld</code>，" +
    "它和它所描述的那次转换在同一笔交易里更新，而且不被告知发生了什么：它必须自己去看这只果蝇。",

  "about.server.heading": "这里没有服务器",
  "about.server.body":
    "这就是一个目录里的若干文件。页面用 JSON-RPC 直接读链，在你的浏览器里用 <code>flywasm</code> " +
    "算出下一步的状态（它就是链上验证器用的那段代码，编译成浏览器能跑的 wasm），交易也由页面自己拼。" +
    "连上钱包之后，你付费、你签名。没有运营方，也没有需要一直跑着的服务。",

  "about.not.heading": "它不是什么",
  "about.not.body":
    "这里跑的是果蝇的朝向回路，不是整只大脑。整只大脑目前放不到链上。\n\n" +
    "页面能显示多久的历史，取决于你连的节点还记得多久；想看得更早，自己跑一个 CKB 节点就行。\n\n" +
    "另外，lock 是 <code>flylock</code> 的果蝇谁都能驱动——这就是这里「公开」的意思。",

  "about.more":
    "接着看：<a href=\"./guide.html\">页面怎么看</a>——每个数字、每种颜色、每个按钮是什么意思。",
  "about.repo":
    "代码：<a href=\"https://github.com/tianlitao/ckbflybrain\">" +
    "github.com/tianlitao/ckbflybrain</a>。",

  "guide.title": "页面怎么看",
  "guide.lead":
    "<strong>页面上的一切都来自链。</strong>每个数字都是果蝇状态 cell 里的一个字段，" +
    "每种颜色都是一个膜电位，图形的排布用的是连接组自己的布局。" +
    "下面说的是每一部分是什么意思，以及每个按钮会做什么。",

  "guide.ring.heading": "环形图",
  "guide.ring.one":
    "<strong>一个圆点就是一个神经元。</strong>一共 155 个，它们的位置不是装饰：" +
    "连接组记录了每个细胞属于哪个楔区，所以外圈是椭球体的十六个楔区，" +
    "里面那一圈是完全不带楔区的细胞——42 个 Δ7。",
  "guide.ring.two":
    "<strong>颜色是膜电位。</strong>暖色是去极化，最亮的那些是上一步刚放电的；" +
    "冷色是被抑制压住的超极化；灰色是静息——环上大部分细胞在大部分时间都是这个状态。" +
    "圆点越大，离静息越远。",
  "guide.ring.three":
    "<strong>0–15 这些数字是楔区的名字</strong>，就是模型对这十六个扇区的叫法。" +
    "<code>cue</code> 指定的就是其中之一，它点亮哪个楔区，哪个楔区的细胞就会去极化。",
  "guide.ring.four":
    "<strong>填色的那一格是它此刻朝向的楔区</strong>，用的是模拟累加整圈时用的同一个朝向向量。",
  "guide.ring.five":
    "<strong>外圈的橙色弧是记忆。</strong>每个楔区的弧长表示它这一生有多少时间朝着这个方向——" +
    "那是状态里的朝向直方图，不是「最近发生了什么」的画法。",
  "guide.ring.six":
    "<strong>箭头是朝向</strong>：整圈的群体向量，也就是它走路的方向。电击会把它打回零，" +
    "箭头随之消失——这时画面会自己说明，而不是让读者以为图坏了。",

  "guide.state.heading": "面板里的那些数字",
  "guide.state.rows":
    "<tr><td><code>step</code></td><td>自创世以来模拟过的步数，只增不减——连死亡也不会让它回退</td></tr>" +
    "<tr><td><code>energy</code></td><td>还剩多少步寿命。一次 tick 每步花掉一格，" +
    "<code>feed</code> 把它买回来，归零即为死亡</td></tr>" +
    "<tr><td><code>generation</code></td><td>它活过几辈子；<code>resurrect</code> 加一</td></tr>" +
    "<tr><td><code>spikes</code></td><td>有神经元放电过多少次——一生累计，以及本世代累计；" +
    "复活之后这两个数会不一样</td></tr>" +
    "<tr><td><code>bornBlock</code></td><td>当前这一生开始于哪个区块</td></tr>" +
    "<tr><td><code>stimulus</code></td><td>哪个刺激通道被武装、强度多少、到哪一步失效。" +
    "果蝇靠它记住自己刚被转过</td></tr>" +
    "<tr><td><code>headX, headY</code></td><td>朝向向量，模型单位，画之前的样子</td></tr>" +
    "<tr><td><code>position</code></td><td>行走把它带到了哪里，单位 1/256 个 cell</td></tr>" +
    "<tr><td><code>backing</code></td><td>身体里锁着的容量，与它代表的寿命。" +
    "这本账两边必须相等，type script 会比对</td></tr>" +
    "<tr><td><code>sightings</code></td><td>那份记录 cell 看过它多少次、写下了多少次</td></tr>",

  "guide.moves.heading": "每个按钮会做什么",
  "guide.moves.rows":
    "<tr><td><strong>推进 64 / 32 步</strong></td><td>把神经系统跑这么多步。" +
    "一次 tick 可能把它跑死，这是正确行为而不是边界情况</td>" +
    "<td>你付手续费，并拿回那些寿命对应的容量——推进 64 步是 0.0064 CKB。" +
    "<strong>推进是赚钱的</strong></td></tr>" +
    "<tr><td><strong>投喂 10,000 步</strong></td><td>买到 10,000 步寿命，别的什么都不动：" +
    "步数和放电计数一动不动</td><td>你花 1 CKB 容量，它被永久锁进这具身体</td></tr>" +
    "<tr><td><strong>线索，楔区 4</strong></td><td>在楔区 4 点亮一个地标，然后跑 32 步。" +
    "这一步会让它走起来：线索把包推过去，包的向量变成朝向</td>" +
    "<td>手续费，加上果蝇的 544 步寿命——32 步真的跑了，512 步是刺激本身的价钱</td></tr>" +
    "<tr><td><strong>左转 / 右转</strong></td><td>驱动一侧的 PEN 神经元（角速度），跑 32 步。" +
    "包会沿着环滑动，这和真实果蝇转弯时它做的是一回事</td><td>同上：544 步寿命</td></tr>" +
    "<tr><td><strong>电击</strong></td><td>同时驱动全部 42 个 Δ7 神经元，把包打散。" +
    "朝向归零，果蝇停止行走</td><td>544 步寿命</td></tr>" +
    "<tr><td><strong>复活</strong></td><td>只在它死掉之后才出现：开始新的一生、代数加一。" +
    "上一生的步数和放电计数会留下当历史，上一生没花完的寿命不会</td>" +
    "<td>你买新的一生，外加手续费</td></tr>",

  "guide.money.heading": "钱怎么动",
  "guide.money.body":
    "每一笔交易都由签名它的那个钱包付费，手续费约 2,385 shannons——0.00002385 CKB——" +
    "这是在 preview testnet 上实测的。它跟着交易大小走，而不是跟着脚本做了多少计算走，" +
    "所以推进 64 步和推进 1 步的发送成本一样。\n\n" +
    "推进是唯一一种「付钱给做这件事的人」的动作。状态 cell 必须恰好缩小掉那些被消耗的寿命" +
    "所背书的容量——每步 10,000 shannons——而这些容量必须出现在同一笔交易的某个地方，" +
    "于是它进了发送者的找零。驱动公共果蝇是净赚的：实测两次推进 64 步，" +
    "访客余额多了 0.0127523 CKB，而部署者一分未动，因为部署者根本不在交易里。\n\n" +
    "投喂是镜像方向，也是唯一纯粹利他的动作：容量进入身体，而 type script 禁止销毁身体，" +
    "所以它再也出不来。",

  "guide.locks.heading": "公开果蝇与私有果蝇",
  "guide.locks.body":
    "果蝇的 lock 在创世时选定一次，之后 type script 会把它钉死一生" +
    "（<code>output.lock == input.lock</code>），所以既换不掉也抢不走。\n\n" +
    "<strong><code>flylock</code></strong> 是那个来者不拒的：它接受每一笔交易。" +
    "这就是「公开」的含义——谁都能推进它，驱动面板上的按钮对任何钱包都会亮。\n\n" +
    "<strong><code>secp256k1_blake160</code> 锁</strong>则是一只私有果蝇：" +
    "谁都能看，只有拿着那把钥匙的人能推进。页面会告诉你正在看的是哪一种，" +
    "如果连上的钱包不是对应的钥匙，它会保持按钮为灰并说明原因。",

  "guide.trust.heading": "为什么你不必相信这个页面",
  "guide.trust.body":
    "页面上的每个数字都来自链上，你点的每个动作也要由链上的脚本重新算一遍才会被接受。" +
    "也就是说：页面显示错了，交易就不会成功；钱包签了别的东西，链上也不会有结果。" +
    "想核对的话，地址、交易哈希、每一步的状态都可以在链上查。" +
    "连接组本身来自 FlyWire，链上只钉住了它的哈希，这一点没法从这个页面验证。",
  "guide.back":
    "<strong>回到果蝇。</strong><a href=\"./index.html\">它本身</a>在首页——这一页只是说明。",
};

const DICTS = { en: EN, zh: ZH };

/**
 * Which language this browser would rather read.
 *
 * `navigator.languages` first (a reader who has `zh-CN` after `en` means it), then the
 * document's own language as the fallback that always exists.
 */
function preferred() {
  const tags =
    typeof navigator !== "undefined" && navigator.languages?.length
      ? navigator.languages
      : [typeof navigator !== "undefined" ? navigator.language : "en"];
  for (const tag of tags) {
    if (/^zh\b/i.test(tag ?? "")) {
      return "zh";
    }
  }
  return "en";
}

let current = preferred();

/** The language now in use: `"en"` or `"zh"`. */
export function lang() {
  return current;
}

/** The locale to format numbers and dates with, so they follow the page. */
export function locale() {
  return current === "zh" ? "zh-CN" : "en-US";
}

/**
 * Translate.
 *
 * `{name}` in the string is replaced by `params.name`; the substituted value is never translated.
 * A key missing from the chosen language falls back to English, and a key missing from both
 * returns **the key itself** — visible on the page, which is the only way a missing translation
 * gets noticed by whoever is looking at the other language.
 */
export function t(key, params) {
  const text = DICTS[current][key] ?? EN[key] ?? key;
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    params[name] === undefined ? whole : String(params[name]),
  );
}

/** Keys present in one language and not the other. Used by the test, and by nothing else. */
export function missingKeys() {
  const en = new Set(Object.keys(EN));
  const zh = new Set(Object.keys(ZH));
  return {
    inEnglishOnly: [...en].filter((k) => !zh.has(k)),
    inChineseOnly: [...zh].filter((k) => !en.has(k)),
  };
}

/** Switch language, and tell the caller to redraw. The caller owns the DOM, not this module. */
export function setLang(next) {
  if (next !== "en" && next !== "zh") {
    throw new Error(`unknown language ${next}`);
  }
  current = next;
}

export { EN, ZH };
