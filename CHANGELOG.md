# Changelog

## 3.6.0 (2026-10-08)

No public API removals or renames. One behavioral change is called out
because code may rely on the old return value.

### Behavioral fixes (read these)

- **A Bitcoin broadcast with no definite answer throws
  `BtcBroadcastUnknownError`.** `sendBtc` and `broadcastTransaction` used to
  report a network error, timeout or error status the same way as a refusal
  (`null` / `success: false`), which reads as "not sent" even when the
  transaction reached the network; sending again could then pay twice. Once
  the request has gone out, those cases now throw `BtcBroadcastUnknownError`
  carrying `txid` and `signedTxHex`. Re-broadcast that same transaction
  rather than building a new one. A refusal from the node (codes -22, -25,
  -26) and a request turned away before reaching a node (4xx other than 400)
  are unchanged. Failures before the broadcast are unchanged.
- **`broadcastTransaction` is safe to repeat.** A transaction the network
  already has (`-27`, already in the mempool) is reported as accepted with its
  txid. The returned txid is computed from the signed transaction. The request
  times out after 30 seconds (unknown outcome).

### Added

- `BtcBroadcastUnknownError`, exported from the package root and the `btc`
  namespace.
- `BtcClient.checkBroadcast(signedTxHex)` (and
  `TransactionService.checkBroadcast`): `found`, `absent` (not seen, inputs
  unspent), `conflicted` (an input spent by another transaction, so it can
  never confirm) or `unresolved`.

## 3.5.0 (2026-10-08)

No public API removals or renames. Two behavioral changes are called out
because code may rely on the old errors.

### Behavioral fixes (read these)

- **vBTC V2 sends throw `TransactionDispatchError` when the outcome is
  unknown.** `transferVbtc`, `createVbtcToken`, `requestWithdrawal` (the
  request transaction), `recordWithdrawalCompletion`, `cancelWithdrawal` and
  the single-contract path of `transferVbtcMulti` now match `sendCoin`: once
  the signed send request has gone out, a lost response, timeout or error
  status throws `TransactionDispatchError` carrying the prepared hash, instead
  of a plain error that read as "not sent". Check the chain for the hash
  before resending. Failures before the send, and an explicit
  `success: false` response, are unchanged.
- **A withdrawal whose Bitcoin broadcast request fails is no longer reported
  as resumable.** A lost response, timeout or error status from the
  broadcast used to surface from `requestWithdrawal` as
  `VbtcWithdrawalIncompleteError`, whose advice (resume with
  `completeWithdrawal`) re-signs the withdrawal even if the first transaction
  went out. It now throws `VbtcWithdrawalUnrecordedError` with the txid and
  the signed transaction: look the txid up, re-broadcast the same
  transaction if it is absent, then call `recordWithdrawalCompletion`. A
  refusal in a successful response stays resumable.

### Added

- `VbtcWithdrawalUnrecordedError.signedBtcTxHex`: the signed Bitcoin
  transaction when the broadcast outcome is unknown, otherwise `null`.

## 3.4.1 (2026-10-05)

### Changed

- **Node.js 20 or newer is required** (`engines.node` is now `>=20`, was
  `>=18.13.0`). Node 18 does not expose `globalThis.crypto` without a flag, so
  `generatePrivateKey()` and every vBTC flow have thrown "no cryptographically
  secure random source available" on it since 3.1.0; this makes the floor
  match reality. Node 18 reached end of life in April 2025. Browsers are
  unaffected.
- CI now tests on Node 20 and 22 (it ran on 18.13 and had been failing on that
  error since 3.1.0).

## 3.4.0 (2026-10-05)

External signing, fungible tokens, reserve (vault) accounts, multi-contract
vBTC transfers and domain management. No public API removals or renames; the
`privateKey` parameters that became optional are called out below because
TypeScript will now accept an options object that omits them.

### Added

- **`Signer` — sign with a key the SDK never sees.** Every signing path
  (`sendCoin`, `buyVfxDomain`, `buyBtcDomain`, the six vBTC flows, and the
  new token methods) accepts a `Signer` in place of a `Keypair`. The SDK hands
  the signer the SHA-256 digest of the message; the signer returns a plain
  DER-encoded secp256k1 ECDSA signature (bytes, hex or base64), which is what a
  KMS or HSM emits natively. The SDK assembles the network's
  `base64(DER).base58(publicKey)` string and normalises high-s signatures, so
  AWS KMS-style signers need no wrapper. The signer's address is verified
  against its public key on the client's network before any request is made.
  `vfxSignatureFromDer(der, publicKey)` is exported for callers that drive the
  raw API themselves.
- **`addressFromPublic(publicKeyHex)`** on `VfxClient` and `KeypairService`:
  the address for an HSM-held key.
- **Fungible tokens (VFX20).** `deployToken`, `mintToken`, `transferToken`,
  `burnToken`, `toggleTokenPause`, `banTokenAddress`,
  `transferTokenOwnership`, `createTokenVoteTopic`, `castTokenVote`, and the
  reads `listFungibleTokens`, `getFungibleToken`, `getFungibleTokenBalances`,
  `listTokenVotingTopics`, `getTokenVotingTopic`. Payloads mirror the web
  wallet field-for-field. Pause is exposed as a toggle because the node flips
  the state whatever is requested; the transaction still carries the state it
  produces, read from Spyglass first, because explorers and wallets display it; ban is permanent on the network.
- `RawTransactionService` accepts `signer` (or a `Signer` as `keypair`) and
  fails at construction on a key/address mismatch, and takes an `unlockTime`.
- **Reserve (vault) accounts.** Key derivation that is byte-compatible with
  the web wallet and the CLI: `reserveKeypairFromPrivateKey` (the vault the
  wallet pairs with a main key), `reserveKeypairFromReservePrivateKey`,
  `reserveKeypairFromRestoreCode`, `generateReserveKeypair`,
  `reserveAddressFromPublic`. Operations: `registerReserveAccount`,
  `sendCoin(..., { unlockHours })`, `callBackReserveTransaction`,
  `recoverReserveAccount`. Every token method accepts `unlockHours` for
  sends from a vault; deploy and domain purchases refuse a vault signer, as
  the network does. `VfxAddress` gains `deactivated`. Golden vectors for the
  derivation were captured from the wallet's compiled keygen and
  `scripts/verify-wallet-compat.js` cross-checks it live.
- **`transferVbtcMulti`** — one `TransferVBTCMultiV2()` drawing from several
  vBTC contracts, allocated with the CLI's rule from Spyglass's
  `available_balances` (now on `VbtcV2Token`) or from caller-supplied
  inputs; single-contract cases fall back to `transferVbtc`.
  `allocateVbtcInputs` and `vbtcMultiTransferData` are exported.
- **Domain management.** `transferVfxDomain`, `deleteVfxDomain`,
  `transferBtcDomain`, `deleteBtcDomain` (5 VFX each), completing the
  domain API alongside the existing purchases.

### Changed

- vBTC flows: `privateKey` is now optional in the params object and `signer`
  is accepted instead. Exactly one must be given — passing both, or neither,
  throws before any request is made. Behaviour with `privateKey` alone is
  unchanged.

## 3.3.0 (2026-09-11)

Tracks the mainnet network upgrade (multi-input vBTC withdrawals). No public
API removals or renames. A single-input withdrawal sends a byte-identical
payload to 3.2.0, so this version also works against nodes that have not
upgraded yet.

### Added

- **Multi-input withdrawal signing.** `completeWithdrawal` now signs every
  start message the FROST prepare step returns — one per vault UTXO the
  Bitcoin transaction spends — and sends the extra signatures in
  `start_signatures[]` (input 0 keeps riding `start_signature`). Against an
  upgraded node, earlier SDK versions fail any withdrawal that needs more than
  one vault UTXO with `InputCountMismatch`; upgrade to fix that.
- **Structured FROST failure diagnostics.** A failed withdrawal-completion
  job now reports `failure_code`, `retryable`, `session_id`, `input_index` and
  `validator_failures`. They reach `onProgress` ticks unchanged (`data` on
  the `frost_polling` phase). When the ceremony fails with `retryable: true`,
  the thrown error names the failure code and says to wait ~60 seconds
  (validator-side cooldown), then call `completeWithdrawal` again. Each retry
  is a fresh ceremony; sessions are never reused.

## 3.2.0 (2026-08-01)

vBTC withdrawal recovery. No public API removals or renames; one behavioral
change is called out below because code may rely on the old return value.

### Behavioral fixes (read these)

- **`RawTransactionService.process()` throws `TransactionDispatchError`
  when the send itself fails.** Previously every failure returned `null`,
  which told the caller "definitely not sent" even when a dropped connection
  or timeout left it unknown whether the node accepted the transaction — and
  a caller that resent could spend twice. `null` is unchanged for pre-dispatch
  validation failures and explicit node rejections; only the ambiguous case
  now throws, carrying the transaction hash so the caller can check the chain
  before resending.
- **A post-broadcast withdrawal failure no longer tells you to resume with
  `completeWithdrawal`.** Once the Bitcoin transaction is broadcast, re-running
  the ceremony re-selects UTXOs and can pay the destination twice. That state
  now throws `VbtcWithdrawalUnrecordedError` (carrying the BTC txid) with
  instructions to call `recordWithdrawalCompletion` instead. Failures before
  the broadcast still throw `VbtcWithdrawalIncompleteError` and remain
  resumable.

### Added

- **`recordWithdrawalCompletion`** — records an already-broadcast Bitcoin
  withdrawal (the Type 28 completion) without re-running the FROST ceremony.
  It needs no session state, so it is safe from a fresh process after a
  crash, reload or device switch, provided the caller persisted the txid.
  `completeWithdrawal` uses it for its final step.
- **`VbtcWithdrawalStatus`** widened to
  `'requested' | 'pending_btc' | 'completed' | 'cancelled' | 'cancellation_requested'`
  (Spyglass's lowercase values). `pending_btc` means a signed Bitcoin
  transaction exists — the state where re-running a withdrawal can pay twice —
  and only appears for ceremonies run through Spyglass; see the doc comment
  on the type for the caveats.

### Fixes

- **FROST status polling rides out job-registration lag.** The first polls
  after execute can report failure for a job that is not registered yet; the
  SDK now tolerates up to six consecutive early failures (as the Flutter
  wallet does) instead of abandoning a withdrawal whose request is already
  committed on chain.

## 3.1.1 (2026-08-01)

### Fixes

- **A failed withdrawal completion is resumable.** When `requestWithdrawal`
  commits the request on chain but completion fails, the rejection is now
  `VbtcWithdrawalIncompleteError` carrying `withdrawalRequestHash` and the
  underlying error, so the caller can hand it straight to
  `completeWithdrawal`. Previously the hash was lost with the rejection,
  stranding a request the chain refuses to re-issue while it stands.

## 3.1.0 (2026-07-07)

Security-and-correctness release. No public API removals or renames; two
behavioral fixes are called out below because code may unknowingly rely on
the old (broken) behavior.

### Security

- **`generatePrivateKey()` now uses the platform CSPRNG** (`crypto.getRandomValues`)
  in both Node and browser builds. Previously it drew from crypto-js 3.x's
  `WordArray.random`, a Math.random-seeded PRNG that must not produce key
  material. Key format is unchanged (`00` + 64 hex). If no secure random
  source exists the SDK now throws instead of silently degrading.
  **If you hold funds on keys generated by earlier SDK versions' `generatePrivateKey()`
  (not mnemonic/email-derived), consider migrating them to fresh keys.**
- **Browser `getSignature` works again.** The 3.0.0 browser bundles threw
  `hashes.sha256 not set` (a `@noble/secp256k1` v3 breakage). Browser
  signing/derivation now delegates to the same implementation as Node and is
  byte-identical to it (RFC6979 deterministic, verified).

### Behavioral fixes (read these)

- **Browser mnemonic/email derivation is now BIP32** (`m/0'/0'/index'`),
  identical to Node/CLI/web wallet. The browser-only `privateKeyFromMnemonic`
  previously used an incompatible SHA256 hack, so the same phrase produced
  different keys in the browser than everywhere else. If you stored funds on
  addresses created by the OLD browser method, recover them with
  `privateKeyFromMnemonicLegacyBrowser` / `privateKeyFromEmailPasswordLegacyBrowser`
  (the old derivations, preserved verbatim and pinned by tests).
- **vBTC flows now throw on a `dryRun` client.** `transferVbtc`,
  `createVbtcToken`, `requestWithdrawal`, `completeWithdrawal` and
  `cancelWithdrawal` previously *ignored* `dryRun=true` and moved real funds.
  They now fail immediately with a clear error before any network call.

### Fixes

- **BTC `createTransaction`**: errors on insufficient funds instead of
  building an underfunded transaction; folds sub-dust change (< 546 sats)
  into the fee instead of emitting a dust output; no longer force-overrides
  the caller's `feeRate` to 5 sat/vB on testnet; rejects non-positive amounts.
- **BTC message signatures are canonical DER.** The previous hand-rolled
  encoding was invalid DER for ~50% of signatures (high-bit r). Verified
  against the VerifiedX node's vendored NBitcoin verifier: canonical DER is
  accepted in all cases; already-valid signatures encode identically.
- **Short private keys are handled.** Keys with leading zero bytes emitted
  unpadded (as the web wallet's `generate()` does, ~1/256 keys) previously
  made `getSignature` throw; `normalizePrivateKey` now left-pads to 64 chars.
- `isValidPrivateKey` rejects zero and compares against the curve order
  numerically.
- Library `console.log` noise removed from clients/services.

### Added

- **Endpoint overrides**: `new VfxClient(network, { baseUrl })` and
  `new BtcClient(network, { apiBaseUrl })` — point at a self-hosted node,
  a replacement testnet, or a different mempool instance without an SDK
  release. The historical boolean `dryRun` second argument still works.
- **`VfxApiError`** thrown for non-2xx responses, carrying `status`, `url`
  and response `body` (message keeps the `HTTP error! status: X` prefix).
- **Request timeouts**: JSON/text API calls default to 30s
  (`{ timeoutMs }` to change, `0` to disable); uploads are exempt.
- **Strict mode**: `getAddressDetails` / `domainAvailable` / `lookupDomain`
  accept `{ strict: true }` to distinguish "not found" from API outages.
  Domain purchase flows use strict checks internally, so an outage can no
  longer read as "domain available".
- `privateKeyFromMnemonic` — correctly-spelled alias for
  `privateKeyFromMneumonic` (which remains).
- `MediaApiClient` exported from the package entrypoint.
- Golden-vector compatibility suite (`src/__tests__/compat`) pinning
  key/address/signature derivation against the VFX web wallet, plus
  `scripts/verify-wallet-compat.js` to re-verify against the wallet bundle.
- `npm run test:integration` — live-network checks, opt-in and
  shape-asserting so testnet resets don't break CI. The default `npm test`
  is fully offline and no longer requires `test.env`.

### Build / dependencies

- Native `secp256k1` module dropped (no more node-gyp on install); VFX
  signing uses `elliptic` with RFC6979 canonical DER — verified
  byte-identical to the previous output (pinned vectors + 300-sample
  differential). BIP32 uses `@bitcoinerlab/secp256k1` (pure JS).
- Removed unused/broken dependencies: `@noble/secp256k1`, `@noble/hashes`,
  `hdkey`, `browser-crypto`, `tiny-secp256k1` (16 → 10 runtime deps).
- Removed the `postinstall` script that patched `math-intrinsics` inside
  consumers' `node_modules`.
- Browser bundles minified: 2.2 MB → 1.0 MB.
