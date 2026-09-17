/**
 * The page's copy of the deployment, as a value.
 *
 * # Why the page needs a file, when it reads everything else from the chain
 *
 * A page can discover a fly: every organism is a live cell wearing the `flybrain` code, so "find
 * them all" is one query. What it cannot discover is *which code to look for*. A code cell's hash
 * is a fact about a binary somebody deployed, and nothing on the chain says "this is the CKB Fly
 * build" — so the page has to be told, once, and it has to be told the same thing the deployer
 * recorded.
 *
 * # Why it is a function of the record rather than a file somebody edits
 *
 * Because it is a *copy*, and a copy that is maintained by hand is a copy that drifts. The record
 * is the authoritative description of a deployment; this emits the subset a page needs, with the
 * same field names the page will see in a snapshot. `test/public-config.test.js` fails when the
 * published file and the record disagree, so a stale copy is caught rather than shipped.
 *
 * # What it deliberately does not carry
 *
 * No key material, and nothing about the deployer. The record has none either; this is a reminder
 * that the *output* is published, so anything added here becomes public. The test asserts the
 * exact field list, which is what stops a future field from arriving quietly.
 *
 * @module public-config
 */

/**
 * @param {object} record a deployment record, as `readDeployment()` returns one
 * @param {string} rpc the endpoint the page should read and the wallet should sign against
 * @returns {object} the published config
 */
export function publicConfig(record, rpc) {
  return {
    // The RPC endpoint, which is what `snap.network` has always meant: the page shows it as
    // "chain", and the wallet is pointed at it so that signing and reading cannot disagree.
    network: rpc,
    params: record.params,
    economics: record.economics,
    codeCells: record.codeCells,
    // The organism the page opens on. Not a constraint — the roster lets a reader move to any
    // live one — but a page has to start somewhere, and the fly the deployer made is the one
    // whose history is worth opening with.
    fly: {
      instance: record.fly.instance,
      typeHash: record.fly.typeHash,
      typeScript: record.fly.typeScript,
      lockScript: record.fly.lockScript,
    },
  };
}

/** The fields a page may be told about, in order. Anything else is a leak waiting to happen. */
export const PUBLIC_FIELDS = ["network", "params", "economics", "codeCells", "fly"];
