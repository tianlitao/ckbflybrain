# CKB Fly — build/test driver.
# Adapted from nervosnetwork/ckb-script-templates (MIT).
#
# `make`          -> build the RISC-V contract binaries, then run host tests
# `make test`     -> host-side tests only (fast; no RISC-V toolchain needed)
# `make build`    -> RISC-V contract binaries into build/{release,debug}/
# `make check`    -> cargo check the whole workspace
# `make clippy`   -> lint the whole workspace
# `make preflight-testnet` -> read-only: is the preview-testnet deploy path usable?
# `make build-front-end` -> bundle deploy/public/app.source.js into public/app.js
#
# The host crates (`flycore`, `flycircuit`, `tests`) build for the host; the two
# contracts build for `riscv64imac-unknown-none-elf`. Both live in one workspace so the
# integration tests exercise the exact `flycore` code the validator runs.

cur_dir = $(dir $(abspath $(firstword $(MAKEFILE_LIST))))
TOP := $(cur_dir)

CUSTOM_RUSTFLAGS := -C debug-assertions
# `+zba,+zbb,+zbc,+zbs` let the compiler use the RISC-V bit-manipulation extensions that
# CKB-VM implements, which matters for the hash and shift-heavy inner loop. They require
# LLVM 20+/clang 18+ to lower correctly; `-C passes=lower-atomic` handles the atomics
# that `bytes` (pulled in by molecule >= 0.8) emits even though CKB-VM has no atomics.
FULL_RUSTFLAGS := -C target-feature=+zba,+zbb,+zbc,+zbs -C passes=lower-atomic $(CUSTOM_RUSTFLAGS)
CARGO_ARGS :=
MODE := release
# Neither contract has a C dependency, so clang is not needed. If one is ever added, point
# CLANG at a clang 18+ binary; the upstream template ships scripts/find_clang for that.
CLANG ?= $(shell command -v clang 2>/dev/null)
AR ?= $(shell command -v llvm-ar 2>/dev/null)
# Used to strip debug info from the RISC-V ELF before it is copied into build/. The
# release profile keeps debug info — the upstream template does too, and it is genuinely
# useful when stepping through a contract inside CKB-VM — but a code cell's capacity has
# to cover the cell's size, and the unstripped binary is ~19 MB, which would cost
# 19,000,000 CKB. Stripped it is a few hundred kilobytes. The unstripped copy is left in
# target/ for debugging.
OBJCOPY := $(shell command -v llvm-objcopy 2>/dev/null \
	|| ls /opt/homebrew/opt/llvm/bin/llvm-objcopy 2>/dev/null \
	|| ls /usr/local/opt/llvm/bin/llvm-objcopy 2>/dev/null \
	|| true)
BUILD_DIR := build/$(MODE)
TARGET := riscv64imac-unknown-none-elf
CONTRACTS := flybrain flylock flyworld

ifeq (release,$(MODE))
	MODE_ARGS := --release
endif

default: build test

# ---------------------------------------------------------------- host tests
# `flycore` and `flycircuit` are plain crates whose tests run natively. They need no
# RISC-V toolchain, so this is the fast inner loop.
test:
	cargo test -p flycircuit -p flycore $(CARGO_ARGS)

# The ckb-testtool suite, which runs the real RISC-V binaries in CKB-VM. Depends on
# `build`, and sets FLY_REQUIRE_CONTRACT so a missing binary fails instead of silently
# skipping — a suite that skips everything still reports success, which is worse than a
# suite that fails.
test-integration: build
	MODE=$(MODE) TOP="$(TOP)" FLY_REQUIRE_CONTRACT=1 cargo test -p tests $(CARGO_ARGS)

# Everything.
test-all: build
	cargo test --workspace $(CARGO_ARGS)
	MODE=$(MODE) TOP="$(TOP)" FLY_REQUIRE_CONTRACT=1 cargo test -p tests $(CARGO_ARGS)

# ------------------------------------------------------------- RISC-V build
build:
	@mkdir -p $(BUILD_DIR)
	@set -eu; \
	for contract in $(CONTRACTS); do \
		echo "building $$contract for $(TARGET) ($(MODE))..."; \
		RUSTFLAGS="$(FULL_RUSTFLAGS)" TARGET_CC="$(CLANG)" TARGET_AR="$(AR)" \
			cargo build --target=$(TARGET) -p $$contract --features onchain $(MODE_ARGS) $(CARGO_ARGS); \
		cp target/$(TARGET)/$(MODE)/$$contract $(BUILD_DIR)/$$contract; \
		if [ -n "$(OBJCOPY)" ]; then \
			$(OBJCOPY) --strip-debug --strip-all $(BUILD_DIR)/$$contract; \
		else \
			echo "  warning: llvm-objcopy not found; keeping debug info, which will need a much larger code cell"; \
		fi; \
		echo "  -> $(BUILD_DIR)/$$contract ($$(wc -c < $(BUILD_DIR)/$$contract | tr -d ' ') bytes)"; \
	done

check:
	cargo check --workspace $(CARGO_ARGS)

# ------------------------------------------------------------- host planner
# `flyplan` is the transaction builder's oracle. A CKB transaction has to carry the exact
# successor state and the exact capacity the economics allows, and the only implementation
# of the dynamics allowed to be authoritative is `flycore` — the same crate the validator
# runs. So `deploy/` shells out to this binary instead of reimplementing the simulation in
# JavaScript, which would be a second source of truth for the one thing the port is about.
plan:
	cargo build -p flyplan

# The deployer's golden tests. They pin `deploy/src/fly.js` — the encoder the browser will
# need, which cannot shell out to Rust — against values produced by `flyplan`. Two
# implementations of one format is an invitation for them to disagree quietly.
test-deploy: plan
	@test -d deploy/node_modules || (echo "run \`npm install\` in deploy/ first" && exit 1)
	cd deploy && npm test

# Bundle the browser entry point. The source remains in deploy/public/app.source.js; the
# generated public/app.js is what serve.js sends. This target deliberately does not add a
# wallet: it makes the later UTXO Global/JoyID choice a one-line import rather than an import-map
# rewrite, while keeping today's page dependency-free at runtime.
build-front-end:
	@test -d deploy/node_modules || (echo "run \`npm install\` in deploy/ first" && exit 1)
	cd deploy && npm run build:front-end

# Read-only rehearsal of the one part of a real deployment that a dev chain never
# exercises. `makeClient` borrows CCC's published testnet script table on every network,
# but on a dev chain it *overwrites* the entries it cares about with out points read out
# of block 0. On preview testnet the published table is used verbatim — out points and all
# — so nothing checks that those out points still name live cells, and a table that has
# rotted fails after funding, mid-transaction. This resolves the table against the chain,
# expands each dep group and confirms every member is live.
#
# It reads the deployment key (to report which address would pay, and its balance), so run
# `node src/cli.js key` first on a network that has no key yet. It signs nothing and spends
# nothing, which is the point: run it before funding, not after.
preflight-testnet:
	cd deploy && CKB_RPC_URL=https://testnet.ckb.dev/ node preflight-testnet.mjs

clippy:
	cargo clippy --workspace --all-targets $(CARGO_ARGS)

fmt:
	cargo fmt --all

prepare:
	rustup target add $(TARGET)

clean:
	rm -rf build
	cargo clean

# SHA-256 of the built contracts, for reproducibility bookkeeping and for pinning the
# code hashes a deployment depends on.
checksum: build
	shasum -a 256 $(BUILD_DIR)/* | tee $(BUILD_DIR)/../checksums-$(MODE).txt

.PHONY: default test test-integration test-all build check clippy fmt prepare clean checksum plan test-deploy build-front-end preflight-testnet
