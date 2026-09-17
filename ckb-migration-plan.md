# Immortal Fruit Fly → Nervos CKB 迁移方案

> 版本 v0.1 · 2026-09-15
> 上游项目：[MidTermDev/immortal-fruit-fly](https://github.com/MidTermDev/immortal-fruit-fly)（BSC 主网，MIT）
> 本方案中的所有 CKB 参数均来自链上实测或官方 RFC / 源码，标注见附录 A。

---

## 0. 结论先行

**可以实现，而且在几个关键维度上 CKB 是比 BSC 更合适的基底。**

| 判断 | 结论 |
|---|---|
| 链上脉冲神经网络能否移植 | ✅ 能，且逻辑更干净（脚本是纯校验器，状态靠 cell 重写） |
| 成本 | ✅ 单次 tick 手续费从约 0.00034 BNB 降到近似为 0；代价是一次性押约 1,354 CKB 容量 |
| 确定性 / 可重放 | ✅ 保留，而且**更强**（CKB 脚本默认拿不到区块数据，想作弊都没接口） |
| "永生"语义 | ✅ 从"代码里自觉维护"升级为"共识层结构性保证"（type script 强制同 type cell 有且仅有一个，谁也删不掉） |
| 前端 | ✅ Next.js + Three.js 基本不动，换掉链交互层即可 |
| 代币经济 | ⚠️ 需要重设计：xUDT 没有 approve/transferFrom；且 CKB 的 DeFi 深度远小于 BSC |
| 事件 / 历史回放 | ⚠️ **最大的一块硬骨头**：CKB 没有 EVM 式 event log，前端回放和"EEG 直播"要重新设计 |
| 全脑（139k 神经元）上链 | ⚠️ 仍然做不到"实时"，但 CKB 的 cycle 预算第一次让**可争议验证**变得现实 |

**一句话**：技术迁移的难点不在神经网络，在"状态怎么放、历史怎么读、代币怎么动"这三件 CKB 特有的工程事。

---

## 1. 为什么 CKB 反而更适合这个负载

### 1.1 EVM 里这个负载 90% 的成本是 SSTORE，CKB 里没有这笔账

`FlyBrain.sol` 每个 tick 要写 155 个膜电位、155 个突触输入、155 个 engram、罗盘直方图、位置、能量、步数……在 EVM 里这是几十个 SSTORE 槽的重写，成本被 20,000 gas/槽的冷写主导。

CKB 的模型完全不同：

- **脚本（Script）不写状态**，脚本只是纯校验器；
- 状态通过"消费旧 cell → 创建新 cell"整体重写，**不按字节收计算费**；
- 手续费只按**交易序列化后的大小**计（`min_fee_rate = 1000 shannons/KB`，实测于节点默认配置）；
- `cycles` 不是费用，是**区块级容量闸门**（`max_block_cycles = 3,500,000,000`），并且**对单笔交易、单个脚本没有共识层上限**。

这意味着：一次 tick 的链上成本几乎等于"把 1.3KB 的状态写进一笔交易"的成本，而不是"155 次状态写入"的成本。

### 1.2 cycle 预算比 EVM 的 gas 预算大一到两个数量级

| | BSC / EVM | CKB |
|---|---|---|
| 区块级执行预算 | ~140M gas（实测 16 步 tick 用 6.9M） | 3.5e9 cycles |
| 单笔交易政策上限 | 无（受区块限制） | 70M cycles（节点默认 `max_tx_verify_cycles`，策略非共识） |

按第 5 节的估算，155 神经元跑 16 步约 **1.2M cycles**。也就是说 70M 的单笔预算还能再塞进 **约 50 倍**的计算量——这正好对应原项目 ROADMAP 的 Phase 2（巨型纤维逃逸回路 + 下行转向）和 Phase 3（蘑菇体学习区），在 BSC 上是想都不敢想的。

### 1.3 "永生"在 Cell 模型里是结构性的

EVM 里"果蝇不会死透"靠的是合约没写 selfdestruct。CKB 里可以**强制**：type script 要求本脚本组内有且仅有一个同 type 的输出 cell。任何试图销毁果蝇的交易直接校验失败。

---

## 2. 逐项映射表

| 概念 | BSC 实现 | CKB 实现 | 难度 |
|---|---|---|---|
| 神经动力学 | `FlyBrain.sol` `_step()`，内联汇编 | `flybrain` **type script**（Rust → `riscv64imac-unknown-none-elf`） | 中 |
| 大脑状态 | 合约 storage（`uint256[16] _v` 等打包槽） | 一个 **state cell** 的 data 字段，约 1,248 字节 | 低 |
| 电路表（15,065 B） | SSTORE2 数据合约 | 一个 **dep cell**，通过 `cell_deps` 引用 | 低 |
| 身份 / 可验证性 | immutable bytecode + `circuitHash` | type script args 里的 32 字节 ID + 电路表 dep cell 的哈希校验 | 低 |
| `tick(steps)` | 一笔交易改 storage | 消费 state cell → 重建 state cell | 中 |
| 事件（Ticked/Fed/…） | EVM logs | **无原生 event**，见第 6 节 | **高** |
| 燃烧投喂 | `transfer` 到 `0xdEaD` | 消费 xUDT cell 后**不重建**（sUDT 规则 `Σin ≥ Σout`，天然允许销毁） | 低 |
| 代币 | BEP-20（实际链上是 Flap 税币克隆） | **xUDT** | 中 |
| permit / approve | EIP-2612 + `transferFrom` | 无对应物；改成"一笔交易里同时带 UDT cell + 签名 witness" | 中 |
| 死亡 / 复活 | `lineage` 数组 + `resurrect()` | 同一 state cell 的状态机 + append-only lineage cell | 低 |
| 全脑 checkpoint | `FlyWorld.sol`，operator 自报 | world type script + `header_deps` 时间锚 + 挑战窗口 | 中 |
| 前端 | ethers.js v6 | **CCC**（`@ckb-ccc/core` / `@ckb-ccc/connector`） | 低 |
| 钱包 | MetaMask | **JoyID**（passkey，体验最好）/ UniSat / OKX / Neuron | 低 |
| 测试 | Foundry + `Differential.t.sol` | **ckb-testtool**（`verify_tx(&tx, cycles)` 可测 cycles） | 低 |
| 构建 | forge + `via_ir` | `ckb-script-templates` + cargo-generate + docker 可复现构建 | 低 |
| 部署 | forge script | `offckb` / 自写部署脚本 | 低 |

---

## 3. 核心设计

### 3.1 状态 cell 布局

一个**单例 cell** 承载果蝇的全部状态。建议用 Molecule 定义固定布局（便于脚本零拷贝解析）：

```rust
// 建议布局，总计 1,248 字节 data
struct BrainState {
    version:        u8,          // 1     布局版本
    flags:          u8,          // 1     bit0 = alive
    generation:     u32,         // 4
    step:           u64,         // 8     累计仿真步数
    energy:         u64,         // 8     剩余生命步数
    total_spikes:   u64,         // 8
    life_steps:     u64,         // 8
    life_spikes:    u64,         // 8
    born_tx:        [u8; 32],    // 32    本世代诞生交易哈希（替代 bornBlock）
    pos_x:          i64,         // 8
    pos_y:          i64,         // 8
    head_x:         i32,         // 4
    head_y:         i32,         // 4
    stim_channel:   u8,          // 1
    stim_param:     u8,          // 1
    stim_strength:  u16,         // 2
    stim_until:     u64,         // 8
    total_burned:   u128,        // 16
    history_root:   [u8; 32],    // 32    滚动历史累加器（见 6.3）
    heading_hist:   [u16; 16],   // 32
    v:              [i16; 155],  // 310   膜电位
    inp:            [i32; 155],  // 620   待处理突触输入（v2 语义）
    bias:           [i8; 155],   // 155   engram
}
```

**容量计算**（CKB 规则：1 字节 = 1 CKB = 1e8 shannons）

| 组成 | 字节 |
|---|---|
| capacity 字段 | 8 |
| lock script（`code_hash` 32 + `hash_type` 1 + args 0） | 33 |
| type script（`code_hash` 32 + `hash_type` 1 + args 32） | 65 |
| data | 1,248 |
| **合计** | **1,354** |

→ **1,354 CKB** 的一次性容量押金，按 2026-09-12 的 CKB 价格（约 $0.0011）折算约 **$1.5**。

> 注意这是**押金不是费用**：只要果蝇活着，这笔容量就一直锁在那个 cell 里。果蝇"永生"意味着这笔押金事实上永久锁定。

### 3.2 lock 设计（这里有个坑）

state cell 的 lock **必须是 anyone-can-spend**，否则没人能 tick。

但这就带来一个攻击：如果 type script 不限制输出 cell 的 lock，ticker 可以 tick 完把输出 cell 锁到自己名下，**直接把果蝇偷走**。

所以 type script 必须强制：

1. `output.lock == input.lock`（lock 不可变，永远是 anyone-can-spend）
2. 本脚本组内**有且仅有一个**输出 cell
3. `output.type.args == input.type.args`（身份不变）

这三条一起，才构成正确的单例 + 不可销毁语义。**这是整个迁移里最容易写错的地方，建议第一条就写进测试。**

### 3.3 电路表的引用方式

不要把 15KB 电路表放进 script args——args 属于 cell 的一部分，每次 tick 重建 state cell 时都要带上这 15KB，容量和交易体积都会爆。

推荐做法：**type script args 里只放电路表的哈希**，ticker 通过 `cell_deps` 提供表 cell，脚本加载后用 blake2b syscall 校验哈希是否匹配 args。

- 校验成本：`500 + 15,065 × 0.25 ≈ 4,266 cycles`，可以忽略
- 好处：换了电路表就是"新物种"，args 一变即天然隔离；且与上游的 `circuitHash` 设计一脉相承
- 建议用 **blake2b**（CKB 原生 syscall）而非 keccak256

### 3.4 tick 交易结构

见随本方案输出的示意图。要点：

- **输入**：当前 state cell + ticker 自己的 CKB cell（付手续费）
- **输出**：新的 state cell（同 capacity / 同 lock / 同 type args）+ ticker 找零
- **CellDeps**：`flybrain` 脚本 code cell、电路表 cell
- **Witness**：本次 tick 的参数（步数、刺激通道）+ 供索引器读的事件摘要（见 6.1）
- **type script 的工作**：从输入 cell 读出旧状态，用电路表重跑 `steps` 步 LIF，逐字段比对输出 cell 的 data；同时校验能量守恒、燃烧量对应、单例约束

> ⚠️ **并发问题**：state cell 是 UTXO，**同一版本只能被消费一次**。两个 ticker 同时提交会有一个失败。EVM 上 `tick()` 是幂等的（都只是推进步数），CKB 上不是。需要给 keeper 加重试逻辑，或指定单一 keeper（更现实）。

---

## 4. 关键取舍：验证还是信任

| 方案 | type script 做什么 | 单次 tick cycles | 信任假设 |
|---|---|---|---|
| **A. 完全验证**（推荐） | 完整重跑 LIF 仿真并逐字段比对 | ~1.2M | 无（与 EVM 版等价） |
| B. 轻验证 | 只校验能量递减、步数递增、范围合法 | < 100k | 信任 ticker 算得对 |
| C. 乐观 + 挑战 | 先接受，N 块内可被挑战重放 | 正常 ~50k / 挑战 ~1.2M | 至少一个诚实验证者在线 |

**推荐 A。** 理由很直接：1.2M cycles 相对 70M 的单笔政策上限只占 1.7%，而 CKB 的手续费按大小算，方案 A 比方案 B 的**链上成本差异几乎为零**。用几乎不存在的成本换掉全部信任假设，没有理由选 B。

方案 C 留给第 7 节的全脑场景——那里单次重放的成本才真的高。

---

## 5. 成本模型

### 5.1 cycles 估算（依据 RFC-0014 的指令成本表）

指令成本：普通指令 1、分支 3、`LW/LH/LB/SW` 3、`LD/SD` 2、`MUL` 5、`DIV/REM` 32、`ECALL` 500 + 0.25/字节。

**单个神经元单步**（release 构建，编译器把 `/1024`、`/128`、`/16` 优化成移位）：

```
LW v[i]            3      MUL v*leak         5      SRAI /1024   1
LW inp[i]          3      ADD                1      LW rnd       3
SRLI+ANDI+ADDI     3      MUL nz*noise       5      SRAI /128    1
ADD                1      LB bias[i]         3      MUL bias*gBias 5
ADD                1      SW inp[i]=0        3      BLT clamp    3
BLT thresh         3      SW v[i]            3      循环开销      4
                                              ≈ 56 cycles（放电时 +15）
```

**单条突触传递**：`LBU×2(6) + LW inp(3) + MUL(5) + SRAI(1) + ADD(1) + SW(3) + 循环(4) ≈ 23 cycles`

**一次 16 步 tick**（尖峰数取 BSC 主网实测：88,961 spikes / 1,648 steps ≈ 864 spikes/16 步；平均出度 6,522/155 ≈ 42）：

| 项 | 计算 | cycles |
|---|---|---|
| 神经元更新 | 155 × 16 × 56 | 138,880 |
| 突触传递 | 864 × 42 × 23 | 834,624 |
| 尖峰簿记 | 864 × 16 | 13,824 |
| engram 可塑性 | 155 × 14 | 2,170 |
| 行走 + 整数 sqrt | — | ~250 |
| 噪声（**廉价 PRNG**） | 96 × ~7 | ~700 |
| 读电路表 dep cell | 500 + 15,065 × 0.25 | 4,266 |
| 读写 state cell | ~1,600 B | ~1,600 |
| 脚本固定开销（入口、解析、遍历 cell） | — | ~100,000 |
| **合计** | | **≈ 1.10M** |

> **如果保留 keccak256 做噪声源**（与 BSC 版 bit-exact）：96 次 keccak-f 置换约 +400k cycles，合计 **≈ 1.5M**。
> 建议换成 **blake2b syscall + 廉价 PRNG 展开**（省 99% 的噪声成本），代价是噪声序列变了，**必须用上游现成的 `sim/calibrate.py` 重新标定参数**（`params.json` 那 12 个值）。这是本次迁移里唯一需要重做的"科学工作"，工作量不大但要老实做。

**结论：单次 16 步 tick ≈ 1.1M ~ 1.5M cycles**，占单笔政策上限（70M）的 1.6% ~ 2.1%。

### 5.2 手续费

tick 交易约 1.5 KB（1.25KB 的 state cell data 会完整出现在 output 里）。

按节点默认最低费率 1000 shannons/KB：

```
1.5 KB × 1000 shannons/KB ≈ 1,500 shannons ≈ 0.000015 CKB
```

即使按 10 倍费率，也约 **0.00015 CKB**（按 $0.0011 折合 **约 $1.7e-7**）。

对比 BSC 实测：**16 步 tick = 6.9M gas @ 0.05 gwei = 0.00034 BNB**。

> 量级差异是 4 个数量级以上。**CKB 上 tick 的边际链上成本基本可以当成 0**，真正的成本转移到"keeper 的机器"和"那 1,354 CKB 的押金"上。

### 5.3 一次性部署成本

| 项 | 大小 | 容量押金 |
|---|---|---|
| `flybrain` type script code cell | ~20–40 KB | 20,000–40,000 CKB |
| 电路表 cell | 15,065 B | 15,065 CKB |
| state cell（创世） | 1,354 B | 1,354 CKB |
| xUDT code cell（复用官方） | 0（用已部署的） | 0 |
| **合计** | | **≈ 36,000 – 56,000 CKB ≈ $40 – $62** |

全部是**押金**，理论上可退还（除了果蝇永远活着的那部分）。相比 BSC 上"花掉就没了"的部署 gas，这是完全不同的成本结构。

---

## 6. 事件层：CKB 上最容易踩坑的地方

CKB **没有 EVM 的 event log**。上游项目重度依赖事件：

- 前端靠 `Ticked` / `Fed` / `Stimulated` / `Died` / `Resurrected` 回放动画
- ROADMAP 里"每次尖峰实时直播（公共 EEG）"直接建立在事件流上

### 6.1 方案 A：witness 承载事件摘要（推荐，主方案）

把每次 tick 的摘要写进 **witness**：

```rust
struct TickWitness {
    steps: u16, spikes: u32, head_x: i32, head_y: i32,
    pos_x: i64, pos_y: i64, energy_left: u64, from_step: u64,
}
```

- witness 会随交易永久上链，可用 `get_transaction` 查到
- **额外容量成本为 0**（只是交易大小增加约 64 字节 → 手续费增加约 64 shannons，可忽略）
- 关键优势：**type script 可以校验 witness 内容与它自己算出来的结果一致**——这让 witness 从"不可信的自述"变成"可验证的事件"

### 6.2 方案 B：环形 log cell（做"实时 EEG"）

一个固定容量的"最近 N 次 tick"环形缓冲 cell，每次 tick 消费并重建：

- 容量固定（例如 64 条 × 48 字节 ≈ 3,072 CKB），不会无限增长
- 前端只需读一个 cell 就能渲染"最近发生了什么"
- 代价：每次 tick 多消费/重建一个 cell

### 6.3 方案 C：滚动历史累加器（做可验证历史）

state cell 里放一个 32 字节的 `history_root`：

```
history_root' = blake2b(history_root || tick_digest)
```

成本几乎为零（32 字节 + 1 次 syscall），但让"历史上某一时刻的状态"可以被证明，为第 7 节的挑战机制打底。

### 6.4 完整历史查询

需要自建一个小索引器：从创世 state cell 出发，沿 outpoint 链反复查"谁消费了它"，把每笔交易的 witness 摘出来。CKB 的 `get_transaction` + `ckb-indexer` 足够支撑，但**这活儿上游项目没有**（BSC 上直接用 logs 就行），要新写。

> **不建议**的做法：每次 tick 生成一个独立 log cell。100 万次 tick × 100 字节 = 100 万 CKB 押金，经济上不可行。

**推荐组合：A（主）+ B（实时视图）+ C（可验证性），历史索引器自建。**

---

## 7. 全脑那一层

上游现状：`brain/` 跑 139,248 神经元的 Numba LIF 仿真，`FlyWorld` 里只有 operator 能 `checkpoint()` / `reportDeath()`，**没有任何争议机制**。这是项目里最弱的一环（叙事和实现落差最大的地方）。

### 7.1 CKB 上的数量级

全脑单步：`139,248 × 56 ≈ 7.8M cycles`，加突触传递约 `9M cycles/step`。

| 场景 | cycles | 可行性 |
|---|---|---|
| 单步全脑 | ~9M | ✅ 单笔 70M 内 |
| 7 步窗口 | ~63M | ✅ 单笔 70M 内 |
| 100 步窗口（10 ms 生物时间） | ~900M | ⚠️ 超单笔政策上限，占区块 26% |
| 1 秒生物时间（10,000 步） | 9e10 | ❌ 需要 26 个区块 |

**结论：全脑"实时上链"仍然不可能；但"可争议验证"第一次变得现实。**

### 7.2 建议设计：把信任问题变成挑战游戏

1. **checkpoint cell**：operator 定期提交大脑状态哈希，用 `header_deps` 绑定真实区块高度与时间（CKB 脚本可以读 header，所以时间戳无法伪造）
2. **挑战窗口**：任何人在 N 个区块内可提交一笔"重放窗口"交易，从一个已确认的 checkpoint 出发重跑 W 步，与下一个 checkpoint 比对
3. **窗口大小**：W = 7 步时约 63M cycles，**恰好卡在单笔 70M 政策上限内**——这个数字很关键，意味着挑战不需要矿工改配置
4. **经济**：挑战成功则没收 operator 的保证金（放在 world cell 里）

> 一个非常漂亮的长期可能性：**CKB-VM 本身就是 RISC-V，而 SP1 / RISC Zero / Jolt 这些 zkVM 也是 RISC-V**。理论上可以用 RISC-V zkVM 为 CKB-VM 的执行生成证明，把"挑战"变成"零知识证明"，彻底消掉对在线挑战者的依赖。这是 CKB 相对 EVM 的独有优势，值得写进路线图的最后一段。

---

## 8. 路线图

### Phase 0 — 脚手架与工具链（1 周）
- `cargo generate gh:nervosnetwork/ckb-script-templates workspace`
- `rustup target add riscv64imac-unknown-none-elf`，clang 18+
- 在 devnet（`offckb`）上跑通一个 hello-world type script + `ckb-testtool` 测试
- 产出：可用的本地开发闭环

### Phase 1 — 移植神经动力学，保持 bit-exact（2 周）
- 把 `FlyBrain.sol` 的 `_step` / `_plasticity` / `_walk` 用 Rust 重写
- **保留 keccak256 噪声源**，把上游 `Differential.t.sol` 的期望值原样搬成 ckb-testtool 的断言：
  - `tick(64)` → 0 spikes
  - `stimulate(CUE,4,4)+tick` → 279 spikes, headX −2446, headY 11821, pos(−103, 501)
  - 后续 → 533 / 533 / 816 spikes，energy 1,009,808
- 用 `verify_tx` 实测 cycles，校准第 5 节的估算
- **验收标准：与 BSC 版逐字段一致，且实测 cycles 在估算的 ±40% 内**

### Phase 2 — state cell 状态机（2 周）
- 定义 Molecule 布局，实现单例 + 不可销毁 + lock 不可变三条约束
- 实现 `tick` 交易构造（Rust 侧 + TypeScript 侧各一套）
- 边界测试：销毁尝试、偷 cell 尝试、非法步数、死亡后再 tick、并发消费
- 产出：devnet 上果蝇能连续存活并行走

### Phase 3 — 噪声源替换 + 重新标定（1 周）
- 把 keccak 换成 blake2b + 廉价 PRNG
- 用上游 `sim/calibrate.py` 重跑参数标定（bump 稳定、PEN 驱动能转、Δ7 能压塌）
- 产出：新的 `params.json`，并保留旧参数作为"考古模式"

### Phase 4 — xUDT 与经济闭环（2 周）
- 发行 xUDT（复用官方已部署的 code cell）
- `feed`：脚本遍历本组内的 $FLY xUDT cell，算出销毁量，校验 `energy` 增量
- `stimulate`：校验通道合法性 + 扣费
- `resurrect`：状态机从 dead → alive，`generation += 1`，lineage cell 追加
- **顺手修掉上游的两个陷阱**：给死果蝇喂食必须 revert；`resurrect(0)` 必须拒绝
- 产出：主网（或 preview）上跑通的完整经济闭环

### Phase 5 — 前端与事件层（2–3 周）
- 链交互层从 ethers.js 换成 CCC
- 钱包接入 JoyID（passkey，无种子词，体验最好）+ UniSat/OKX
- witness 事件层 + 环形 log cell + 自建历史索引器
- Three.js 脑渲染基本不动
- 产出：可用的 dapp

### Phase 6 — world / 全脑可争议验证（3–4 周）
- world type script + checkpoint cell + `header_deps` 时间锚
- 挑战交易（7 步窗口 ≈ 63M cycles）
- 链下全脑仿真器改成"可产出 checkpoint 证明"的形态
- 产出：从"自报"升级为"可挑战"

### Phase 7 — 扩展（对齐上游 ROADMAP 的 Phase 2/3/4）
- 巨型纤维逃逸回路 + 下行转向（CKB 的 cycle 预算允许）
- 蘑菇体多巴胺门控可塑性
- `FlyFactory`：每只果蝇一个 state cell，共享 world
- **这一阶段在 BSC 上基本不可行，是 CKB 迁移真正的技术红利**

---

## 9. 风险清单

| 风险 | 等级 | 说明 | 缓解 |
|---|---|---|---|
| 事件层重设计 | **高** | 没有 event log，前端回放和 EEG 直播要重写 | Phase 5 提前做技术验证，别留到最后 |
| 代币经济不适配 | **高** | CKB DeFi 深度远小于 BSC；无 approve/transferFrom；**未找到 Flap 的对等发射台** | 见第 10 节决策点 |
| 并发消费 | 中 | state cell 是 UTXO，同版本只能消费一次 | 单一 keeper + 重试；或把 tick 设计成可合并 |
| 参数重标定 | 中 | 换噪声源后必须重跑 `calibrate.py` | 上游有现成工具，但别跳过 |
| lock/type 约束写错 | 中 | 漏掉"lock 不可变"就会被人把果蝇偷走 | 写成第一条测试 |
| Rust → RISC-V 工具链 | 低 | `ckb-std` + `riscv64imac-unknown-none-elf`，成熟 | 用官方模板 |
| cycle 估算偏差 | 低 | 第 5 节是静态估算，未实测 | Phase 1 用 `verify_tx` 实测校准 |
| 全脑上链 | 低（长期） | 仍不可实时 | 走可争议验证 + RISC-V zkVM 路线 |
| 上游代码是单次快照 | 低 | 无 git 历史，无法追溯 | 不依赖上游演进 |

---

## 10. 需要你拍板的决策点

1. **代币怎么办？**
   - (a) 原样发 xUDT + 找现有 CKB DEX 建池（最省事，但流动性薄）
   - (b) 用 type script 原生实现联合曲线（像 Flap 的 BondingCurve 状态），完全链上发行（更优雅，工作量 +3 周）
   - (c) 先不发代币，只做技术演示，用测试币驱动
2. **保 bit-exact 还是接受重标定？**
   - 保 bit-exact → 保留 keccak，cycles 约 1.5M，能直接复用上游差分测试
   - 接受重标定 → 换 blake2b + 廉价 PRNG，cycles 约 1.1M，更省但要多做一周标定
3. **范围到哪？** 只做 Phase 1–5（等价于上游现状），还是一路做到 Phase 7（CKB 独有红利）？
4. **主网还是 preview？** 建议 preview testnet 全程验证后再上主网。

---

## 附录 A：本方案引用的关键参数（均经实测或官方来源核对）

| 参数 | 值 | 来源 |
|---|---|---|
| `max_block_cycles` | 3,500,000,000 | CKB 官方文档 / RFC-0014 |
| `max_tx_verify_cycles` | 70,000,000（节点默认策略） | `resource/ckb.toml` |
| `min_fee_rate` | 1,000 shannons/KB（按大小计费） | `resource/ckb.toml` |
| 容量规则 | 1 字节 = 1 CKB = 1e8 shannons | CCC 官方文档 |
| 普通 cell 最低容量 | 61 CKB | CCC 官方文档 |
| 指令成本 | 普通 1 / 分支 3 / LW·SW 3 / LD·SD 2 / MUL 5 / DIV·REM 32 | RFC-0014 |
| syscall 成本 | 500 + 0.25/字节 | RFC-0014 |
| ELF 加载 | 0.25 cycles/字节 | RFC-0014 |
| 平均出块间隔 | 7.84 s（近 1000 块）/ 8.64 s（近 20000 块） | 主网实测 2026-09-15 |
| 主网链高 | 20,460,767 @ 2026-09-15T08:01Z | 主网实测 |
| CKB 价格 | ≈ $0.0011 | 2026-09-12 行情 |
| Rust target | `riscv64imac-unknown-none-elf` | ckb-script-templates |
| 代币标准 | sUDT / xUDT，规则 `Σinputs ≥ Σoutputs`（天然允许销毁） | CKB 官方 sUDT 教程 |
| 参考前端 SDK | `@ckb-ccc/core`、`@ckb-ccc/connector` | CCC 文档 |

## 附录 B：上游项目实测数据（用于对比）

| 项 | 值 |
|---|---|
| 电路规模 | 155 神经元 / 6,522 连接 / 45,961 突触 |
| `circuitHash` | `0xffbe0e7f28e1f0dd2cfaa01d1d221c502bf41c1fd519ebfe8d9b8203e7cedfc2`（链上 = 本地 keccak256 一致） |
| 单次 16 步 tick | 6.9M gas @ 0.05 gwei = 0.00034 BNB |
| 尖峰密度 | 88,961 spikes / 1,648 steps ≈ 54 spikes/step |
| 主网状态快照 | step 3,168 / energy 1,047,832 / generation 0 / totalBurned 95,000 FLY |
