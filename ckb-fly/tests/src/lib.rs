//! Integration test support for the CKB Fly contracts.
//!
//! Two jobs:
//!
//! 1. **Locate the built RISC-V binaries.** They live in `build/{release,debug}/` after
//!    `make build`. The `MODE` environment variable selects which, defaulting to release
//!    so that `make test-integration` needs no extra configuration.
//! 2. **Decide what to do when they are missing.** `cargo test` at the workspace root
//!    runs this crate's tests too, and someone who only wants to iterate on `flycore`
//!    should not be blocked by a missing RISC-V build. So the loader is *pull*-based: it
//!    returns `None` rather than panicking, and each test decides. A test that needs the
//!    contracts calls [`require_contracts`], which skips loudly by default and fails hard
//!    when `FLY_REQUIRE_CONTRACT=1`.
//!
//! That last part matters. Silently skipping is how a CI job ends up green while testing
//! nothing, so `make test-integration` sets the variable and turns the skip into a
//! failure.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

use ckb_testtool::ckb_types::{bytes::Bytes, core::Cycle};
use ckb_testtool::context::Context;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod world;

/// Environment variable selecting `build/{release,debug}`.
const TEST_ENV_VAR: &str = "MODE";

/// When set to a non-empty value, a missing contract binary fails the test instead of
/// skipping it.
pub const REQUIRE_ENV_VAR: &str = "FLY_REQUIRE_CONTRACT";

/// Which build of the contracts to load.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestEnv {
    /// `build/debug/`
    Debug,
    /// `build/release/`
    Release,
}

impl FromStr for TestEnv {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "debug" => Ok(TestEnv::Debug),
            "release" => Ok(TestEnv::Release),
            _ => Err("MODE must be `debug` or `release`"),
        }
    }
}

/// Locates the compiled contract binaries.
#[derive(Debug, Clone)]
pub struct Loader(PathBuf);

impl Default for Loader {
    fn default() -> Self {
        let env = match env::var(TEST_ENV_VAR) {
            Ok(val) => val.parse().expect("MODE"),
            Err(_) => TestEnv::Release,
        };
        Self::with_test_env(env)
    }
}

impl Loader {
    /// A loader for a specific build.
    pub fn with_test_env(env: TestEnv) -> Self {
        let leaf = match env {
            TestEnv::Debug => "debug",
            TestEnv::Release => "release",
        };

        // `TOP` is exported by the workspace Makefile. Without it, `cargo test` may run
        // from either the workspace root or the crate directory, so try both.
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(top) = env::var("TOP") {
            candidates.push(PathBuf::from(top).join("build"));
        }
        candidates.push(PathBuf::from("build"));
        candidates.push(PathBuf::from("..").join("build"));
        candidates.push(PathBuf::from("../..").join("build"));

        let base = candidates
            .into_iter()
            .find(|p| p.is_dir())
            .unwrap_or_else(|| PathBuf::from("build"));

        Loader(base.join(leaf))
    }

    /// The directory the loader reads from.
    pub fn dir(&self) -> &PathBuf {
        &self.0
    }

    /// Read a contract binary, or `None` if it has not been built.
    pub fn try_load_binary(&self, name: &str) -> Option<Bytes> {
        fs::read(self.0.join(name)).ok().map(Bytes::from)
    }
}

/// Read a set of contract binaries, skipping the calling test (loudly) if any is missing.
///
/// # Panics
///
/// Panics with an actionable message when `FLY_REQUIRE_CONTRACT` is set, so a CI job that
/// believes it is running the integration suite cannot pass by accident.
pub fn require_binaries(names: &[&str]) -> Option<(Context, Vec<Bytes>)> {
    let loader = Loader::default();
    let required = env::var(REQUIRE_ENV_VAR)
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    let mut binaries = Vec::new();
    for name in names {
        match loader.try_load_binary(name) {
            Some(b) => binaries.push(b),
            None => {
                let dir = loader.dir().display();
                if required {
                    panic!(
                        "contract binary `{name}` is missing from {dir}. \
                         Run `make build` first ({REQUIRE_ENV_VAR} is set, so skipping is not allowed)."
                    );
                }
                eprintln!(
                    "SKIPPED: contract binary `{name}` is missing from {dir}; \
                     run `make build` to enable this test."
                );
                return None;
            }
        }
    }

    Some((Context::default(), binaries))
}

/// The fly itself: `flybrain` and the lock its state cell wears.
pub fn require_contracts() -> Option<(Context, Bytes, Bytes)> {
    let (ctx, binaries) = require_binaries(&["flybrain", "flylock"])?;
    let mut it = binaries.into_iter();
    let flybrain = it.next().unwrap();
    let flylock = it.next().unwrap();
    Some((ctx, flybrain, flylock))
}

/// The fly, plus the world that keeps its chronicle.
pub fn require_world_contracts() -> Option<(Context, Bytes, Bytes, Bytes)> {
    let (ctx, binaries) = require_binaries(&["flybrain", "flylock", "flyworld"])?;
    let mut it = binaries.into_iter();
    let flybrain = it.next().unwrap();
    let flylock = it.next().unwrap();
    let flyworld = it.next().unwrap();
    Some((ctx, flybrain, flylock, flyworld))
}

/// Maximum cycles a single transaction may consume in these tests.
///
/// This is the node's default `max_tx_verify_cycles` policy value. Asserting against it
/// rather than against a made-up number keeps the tests honest about what a node would
/// actually accept.
pub const MAX_TX_VERIFY_CYCLES: u64 = 70_000_000;

/// Convenience alias so tests read clearly.
pub type Cycles = Cycle;
