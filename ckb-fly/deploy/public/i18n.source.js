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
  "app.standfirst":
    "A Drosophila head-direction ring attractor — 155 neurons, 6,522 connections — running as an " +
    "organism on Nervos CKB. The fly is a cell. Every tick consumes it and creates its successor, " +
    "and the type script refuses anything that is not the exact result of the action the witness " +
    "declares.",

  "world.heading": "The world",
  "world.countOne": "1 organism on this chain",
  "world.count": "{n} organisms on this chain",
  "world.caption":
    "Every organism on this chain, found by asking for cells that wear the flybrain code — each " +
    "fly has a different type script, so there is no single script to look up. The eight-byte " +
    "instance in the args is what makes two flies with the same genome two organisms; without it " +
    "they would share a type script and this list would have one row. Click one to watch it.",

  "ring.heading": "The ring",
  "ring.headingAtStep": "The ring at step {step}",
  "ring.caption":
    "Compass cells sit on the outer ring, one arc per wedge of the ellipsoid body; the rest fill " +
    "the inside. A neuron that fired on the last step is drawn bright.",
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
    "The fly has no token. Its capacity is its body and its remaining life, and the two sides of " +
    "this ledger have to be equal — the type script compares them.",
  "backing.perStep": "backing / step",
  "backing.shannons": "{n} shannons",
  "backing.body": "body",
  "backing.life": "life",
  "backing.required": "required",
  "backing.held": "held",
  "backing.notLiveCell": "— (not the live cell)",

  "chronicle.heading": "Chronicle",
  "chronicle.caption":
    "A second type script, <code>flyworld</code>, keeps this record — and updates it in the same " +
    "transaction as the transition it describes. It is not told what the fly did: it is required " +
    "to look at the fly, which must be present, and to record exactly what it finds. Nothing " +
    "here was supplied by whoever sent the transaction, and the cell's own capacity never " +
    "changes, so it cannot be used to hide value either.",
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
  "roster.key": "key",
  "roster.keyTitle": "this server holds the key for this organism",

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
    "CKB has no event log. This is not a log — it is the fly's chain of state cells, walked " +
    "backwards from the current one, with each action read out of the witness the type script " +
    "validated. Nothing here was emitted, and nothing here can be edited.",
  "timeline.block": "block {n}",
  "timeline.step": "step {n}",

  "wallet.heading": "Wallet",
  "wallet.address": "address",
  "wallet.signsWith": "signs with",
  "wallet.balance": "balance",
  "wallet.none": "—",
  "wallet.wallet": "wallet",
  "wallet.connect": "connect {name}",
  "wallet.disconnect": "disconnect",
  "wallet.noWallet": "no wallet in this browser",
  "wallet.asking": "asking {name} for an account…",
  "wallet.connected": "connected {address}…",
  "wallet.noteConnected":
    "Clicks in the Drive panel are signed by this wallet and paid for from its balance. The " +
    "server builds the transaction — the successor state is the Rust simulation's — but it " +
    "signs nothing and needs no key of its own.",
  "wallet.noteOffered":
    "Connect from the button at the top right of this page. Offered by this browser: {names}. " +
    "Connecting one lets it pay for and sign a transition; the server never sees the key.",
  "wallet.noteNone":
    "No wallet found in this browser — look for the control at the top right. UTXO Global is a " +
    "browser extension; JoyID needs no extension, so it should be offered here. If nothing is, " +
    "this browser is refusing to run the connectors at all (a WebView or a private-mode window " +
    "will do that).",

  "drive.heading": "Drive",
  "drive.tick": "tick {n}",
  "drive.feed": "feed {n}",
  "drive.cue": "cue, wedge {wedge}",
  "drive.shock": "shock",
  "drive.noteWallet":
    "Enabled: your wallet signs and pays. The server builds the transaction — the successor " +
    "state is the Rust planner's — and holds no key for it.",
  "drive.notePublic":
    "These sign a transaction with the key this server was started with. Only sensible on a " +
    "chain where that key is worthless. This organism is public: flylock accepts every " +
    "transaction, so anyone may advance it.",
  "drive.notePrivate":
    "These sign a transaction with the key this server was started with. This organism is " +
    "private — its lock is this server's own secp256k1 lock — so these buttons are the only " +
    "thing that can advance it without that key in hand.",
  "drive.noteNoDrive":
    "Disabled. This server was started without INDEXER_ALLOW_DRIVE, so it will not sign with its " +
    "own key — but connecting a wallet (top right) does not need that key at all, and will " +
    "enable these buttons if the organism is public.",
  "drive.disabled": "Disabled: {reason}",
  "drive.asking": "asking your wallet to sign {kind}…",
  "drive.sent":
    "sent {tx} — signed and paid by your wallet; the indexer picks it up once the node commits it",
  "drive.submitting":
    "submitting {kind} — waiting for the node to commit (this can take a while on testnet)…",
  "drive.duplicate": "already on its way — {reason}",
  "drive.raced": "raced: {reason}",
  "drive.accepted": "accepted {tx}",
  "drive.refused": "refused: {reason}",

  "status.connecting": "connecting…",
  "status.indexed": "{n} transitions indexed · updated {time}",
  "status.nodeError": "the node reported: {error}",
  "status.streamDropped": "the event stream dropped; reconnecting…",
  "status.watching": "watching {instance} ({hash}…)",
  "status.indexerError": "the indexer answered {status}",
  "status.cannotLoad": "cannot load {tx}",
};

const ZH = {
  "doc.title": "CKB 果蝇 —— 一只活在 Nervos CKB 上的果蝇",
  "lang.name": "中文",
  "lang.other": "English",

  "app.name": "CKB 果蝇",
  "app.standfirst":
    "果蝇头朝向环形吸引子——155 个神经元、6,522 条连接——作为一只生物跑在 Nervos CKB 上。" +
    "这只果蝇就是一个 cell：每次 tick 花掉它、并造出它的后继，而 type script 拒绝任何不是" +
    "「witness 声明的动作的精确结果」的东西。",

  "world.heading": "世界",
  "world.countOne": "这条链上有 1 只生物",
  "world.count": "这条链上有 {n} 只生物",
  "world.caption":
    "这条链上的每一只生物，都是靠「找戴着 flybrain 这段代码的 cell」找出来的——每只果蝇的 " +
    "type script 都不同，所以没有唯一一个脚本可查。args 里那 8 个字节的 instance 就是" +
    "「同一个基因组的两只果蝇算两只生物」的原因；没有它，两只果蝇会共用一个 type script，" +
    "这张表也就只剩一行。点一行即可观看它。",

  "ring.heading": "环形",
  "ring.headingAtStep": "第 {step} 步时的环",
  "ring.caption":
    "罗盘细胞坐在外环上，椭球体的每个楔区一段弧；其余神经元填在内部。上一步发放过的神经元画得更亮。",
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
    "这只果蝇没有代币。它的容量就是它的身体加上剩下的寿命，这本账的两边必须相等——type script 会比对。",
  "backing.perStep": "每步支撑",
  "backing.shannons": "{n} shannons",
  "backing.body": "身体",
  "backing.life": "寿命",
  "backing.required": "需要",
  "backing.held": "实际持有",
  "backing.notLiveCell": "—（不是当前存活的 cell）",

  "chronicle.heading": "编年史",
  "chronicle.caption":
    "第二个 type script——<code>flyworld</code>——保存这份记录，并且与它所描述的这次状态转换" +
    "写在同一笔交易里。它不被告知果蝇做了什么：它被要求自己去看，而果蝇必须在场，" +
    "它要把看到的东西原样记下。这里没有任何一项是发交易的人提供的；这个 cell 自己的容量" +
    "永不改变，所以它也不能被用来藏钱。",
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
  "roster.key": "钥匙",
  "roster.keyTitle": "本服务器持有这只生物的钥匙",

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
    "CKB 没有事件日志。这不是日志——它是果蝇的状态 cell 链，从当前这只往回走，" +
    "每一次动作都是从那笔被 type script 验证过的 witness 里读出来的。这里没有任何东西是被" +
    "「发出」的，也没有任何东西可以被修改。",
  "timeline.block": "区块 {n}",
  "timeline.step": "第 {n} 步",

  "wallet.heading": "钱包",
  "wallet.address": "地址",
  "wallet.signsWith": "签名方式",
  "wallet.balance": "余额",
  "wallet.none": "—",
  "wallet.wallet": "钱包",
  "wallet.connect": "连接 {name}",
  "wallet.disconnect": "断开",
  "wallet.noWallet": "这个浏览器里没有钱包",
  "wallet.asking": "正在向 {name} 请求一个账户…",
  "wallet.connected": "已连接 {address}…",
  "wallet.noteConnected":
    "在「驱动」面板里点击，由这个钱包签名、并从它的余额付费。交易由服务器组装——后继状态来自 " +
    "Rust 模拟——但服务器不签名，也不需要任何自己的钥匙。",
  "wallet.noteOffered":
    "请用本页右上角的按钮连接。这个浏览器提供：{names}。连上之后它就能为一次状态转换付费并签名；" +
    "服务器永远看不到私钥。",
  "wallet.noteNone":
    "这个浏览器里没找到钱包——请看右上角的控件。UTXO Global 是浏览器扩展；JoyID 不需要装任何东西，" +
    "所以这里本该列出它。如果一个都没有，说明这个浏览器根本不让连接器运行（WebView 或无痕窗口会这样）。",

  "drive.heading": "驱动",
  "drive.tick": "推进 {n} 步",
  "drive.feed": "投喂 {n} 步",
  "drive.cue": "线索，楔区 {wedge}",
  "drive.shock": "电击",
  "drive.noteWallet":
    "可用：由你的钱包签名并付费。交易由服务器组装——后继状态来自 Rust planner——它不持有这把钥匙。",
  "drive.notePublic":
    "这些按钮用本服务器启动时的那把钥匙签名。只在这把钥匙不值钱的链上才合理。这只生物是公开的：" +
    "flylock 接受任何交易，所以谁都可以推进它。",
  "drive.notePrivate":
    "这些按钮用本服务器启动时的那把钥匙签名。这只生物是私有的——它的锁就是本服务器自己的 " +
    "secp256k1 锁——所以手上没有那把钥匙的话，只有这些按钮能推进它。",
  "drive.noteNoDrive":
    "已禁用。本服务器启动时没有开 INDEXER_ALLOW_DRIVE，所以它不会用自己的钥匙签名——" +
    "但连接一个钱包（右上角）完全不需要那把钥匙，只要这只生物是公开的，这些按钮就会亮起来。",
  "drive.disabled": "已禁用：{reason}",
  "drive.asking": "正在请你的钱包为 {kind} 签名…",
  "drive.sent": "已发送 {tx} —— 由你的钱包签名并付费；节点确认后索引器会把它收录进来",
  "drive.submitting": "正在提交 {kind} —— 等待节点确认（测试网上可能要等一会儿）…",
  "drive.duplicate": "已经在路上了 —— {reason}",
  "drive.raced": "被抢先了：{reason}",
  "drive.accepted": "已接受 {tx}",
  "drive.refused": "被拒绝：{reason}",

  "status.connecting": "正在连接…",
  "status.indexed": "已索引 {n} 次状态转换 · 更新于 {time}",
  "status.nodeError": "节点报告：{error}",
  "status.streamDropped": "事件流断开了，正在重连…",
  "status.watching": "正在观看 {instance}（{hash}…）",
  "status.indexerError": "索引器返回了 {status}",
  "status.cannotLoad": "无法加载 {tx}",
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
