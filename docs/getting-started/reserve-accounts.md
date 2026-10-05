# Reserve Accounts: Time-Delayed, Recoverable Vaults

A reserve account (also called a vault) is an `xRBX…` address whose outgoing sends wait behind an unlock time before they settle. Until then the owner can call a send back, and if the vault key is ever compromised, a separate recovery key can sweep everything in the vault to a safe address. This guide covers creating, using, and recovering a reserve account with the VerifiedX Web SDK.

## Prerequisites

- `vfx-web-sdk` 3.4.0 or later
- A funded ordinary VFX address to fund the vault from (5 VFX covers activation)

## How Reserve Accounts Work

- **Activation.** A vault becomes a reserve account by sending a `Register()` transaction: 4 VFX to `Reserve_Base`, naming its recovery address. At least 0.5 VFX must remain in the vault afterwards.
- **Delayed sends.** Every send from an activated vault carries an unlock time, at least 24 hours ahead. Until then the amount shows as locked: it has left the vault's spendable balance but has not reached the recipient.
- **Call back.** Before the unlock time, the vault can cancel a pending send and the funds return.
- **Recovery.** The recovery key signs a `Recover()` that sweeps the vault's balance to the recovery address and permanently deactivates the vault.
- **Scope.** The delay applies to VFX, vBTC and NFT sends. A fungible-token transfer from a vault carries the unlock time but settles immediately, so a vault protects treasury, not fund tokens. Domain operations, token deployment and multi-contract vBTC transfers are refused from a vault.

## Step 1: Derive the Vault Keys

The vault the VerifiedX web wallet pairs with an account is derived from that account's main key, so the SDK produces the same vault address and recovery key as the wallet.

```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

const client = new VfxClient(Network.Testnet);

const mainPrivateKey = process.env.VFX_PRIVATE_KEY!;
const main = {
  privateKey: mainPrivateKey,
  publicKey: client.publicFromPrivate(mainPrivateKey),
  address: client.addressFromPrivate(mainPrivateKey),
};

const vault = client.reserveKeypairFromPrivateKey(mainPrivateKey);
console.log(vault.address);         // xRBX...
console.log(vault.recoveryAddress); // ordinary x... address that receives a recovery sweep
console.log(vault.restoreCode);     // back this up: it restores both keys
```

Other ways to get a vault:

```typescript
client.reserveKeypairFromRestoreCode(code);          // a CLI or wallet restore code
client.reserveKeypairFromReservePrivateKey(key);     // from the vault key alone
client.generateReserveKeypair();                     // a standalone vault
client.reserveAddressFromPublic(publicKeyHex);       // the xRBX address of an HSM-held key
```

Always pass the `ReserveKeypair` object itself when signing. Its private key on its own resolves to that key's ordinary `x…` address, not the vault.

## Step 2: Fund and Register

```typescript
await client.sendCoin(main, vault.address, 5);   // fund the vault
// wait for it to confirm, then:
await client.registerReserveAccount(vault);      // 4 VFX Register()
```

Confirm activation before sending from the vault:

```typescript
const details = await client.getAddressDetails(vault.address);
// { address: 'xRBX...', balance: 1.49999273, balanceLocked: 0, activated: true, deactivated: false, ... }
```

## Step 3: Send from the Vault

```typescript
const hash = await client.sendCoin(vault, 'xRecipient...', 100);                       // settles in 24 hours
const later = await client.sendCoin(vault, 'xRecipient...', 100, { unlockHours: 72 }); // or later
```

The SDK enforces the 24-hour minimum (the network requires slightly less) and refuses `unlockHours` on an ordinary account. While a send is pending, `getAddressDetails` shows it in `balanceLocked`:

```typescript
// after sending 0.25 from a vault holding 1.5:
// { balance: 1.24998667, balanceTotal: 1.49998667, balanceLocked: 0.25, ... }
```

## Step 4: Call a Send Back

Before the unlock time passes, the vault can cancel the send:

```typescript
await client.callBackReserveTransaction(vault, { hash });
// once confirmed: balanceLocked returns to 0 and the amount is spendable again
```

## Step 5: Recover a Compromised Vault

If the vault key is exposed, the recovery key moves everything to the recovery address and deactivates the vault for good:

```typescript
await client.recoverReserveAccount(vault);
// vault: { balance: 0, activated: true, deactivated: true }
// recovery address: receives the vault's full balance
```

A `ReserveKeypair` carries its recovery key, so the call needs nothing else. The recovery signature is time-stamped and valid for 10 minutes, so send it promptly after building it.

## Keys in an HSM

Both the vault key and the recovery key can be held externally. The vault `Signer` presents the `xRBX` address; recovery takes its own signer (or keypair):

```typescript
const vaultSigner = {
  address: client.reserveAddressFromPublic(vaultPublicKey),
  publicKey: vaultPublicKey,
  signDigest: (digestHex) => hsm.sign('vault-key', digestHex),
};

await client.registerReserveAccount(vaultSigner, { recoveryAddress });
await client.sendCoin(vaultSigner, 'xRecipient...', 100);
await client.recoverReserveAccount(vaultSigner, { recoverySigner });
```

See [External Signing](./external-signing.md) for the `Signer` contract.

## Common Issues

### `A send from a reserve account must wait at least 24 hours`
The SDK's minimum is 24 hours, matching the wallet.

### `... cannot be sent from a reserve account`
Domain purchases and management, token deployment and multi-contract vBTC transfers are not allowed from a vault. Use an ordinary account.

### `Invalid Transaction` on register
The vault needs at least 4.5 VFX (4 for activation plus the 0.5 floor) and the funding transaction must be confirmed first.

### Signing produced the wrong address
A vault private key passed as a plain keypair or `privateKey` signs for that key's ordinary address. Pass the `ReserveKeypair` returned by the derivation helpers, or a `Signer` whose address is the `xRBX` form.

## What's Next?

- [External Signing](./external-signing.md): HSM-held vault and recovery keys
- [Fungible Tokens](./fungible-tokens.md)
- [VfxClient API Reference](../api/vfx-client.md): every reserve method and its parameters
