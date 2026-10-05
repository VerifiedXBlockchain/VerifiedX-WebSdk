# External Signing: HSM, KMS and MPC Keys

The VerifiedX Web SDK can sign every transaction with a key it never sees. Instead of a private key, pass a `Signer`: an object that knows its address and public key and can sign a digest. This is how an issuer keeps a treasury or token-owner key in an HSM, a cloud KMS, or an MPC service while still using the SDK to build and send transactions.

## Prerequisites

- `vfx-web-sdk` 3.4.0 or later
- A secp256k1 key held by the signing service (in AWS KMS, key spec `ECC_SECG_P256K1`)

## The Signer Contract

```typescript
import { Signer } from 'vfx-web-sdk';

interface Signer {
  address: string;   // the VFX address the signature is verified against
  publicKey: string; // uncompressed secp256k1 public key, hex, with or without the 04 prefix
  signDigest(digestHex: string): Promise<Uint8Array | string> | Uint8Array | string;
}
```

For every message that needs signing, the SDK computes its SHA-256 digest and calls `signDigest` with the 32-byte digest as 64 hex characters. The signer returns a plain DER-encoded ECDSA signature over that digest, as bytes, hex or base64. That is the format KMS and HSM products emit natively.

The SDK then:

- normalises a high-s signature to low-s, so signers that do not canonicalise (AWS KMS, for one) work without a wrapper;
- assembles the network's `base64(DER).base58(publicKey)` signature string;
- checks, before any request is made, that `address` really belongs to `publicKey` on the client's network. A wrong key, or a testnet address on a mainnet client, fails immediately instead of at the node.

## Where a Signer Is Accepted

Everywhere the SDK signs:

| Method | How to pass it |
|---|---|
| `sendCoin`, `buyVfxDomain`, `buyBtcDomain`, domain transfer and delete | first argument, in place of the keypair |
| All token methods (`deployToken`, `mintToken`, `transferToken`, …) | first argument |
| Reserve account methods (`registerReserveAccount`, `callBackReserveTransaction`, `recoverReserveAccount`) | first argument |
| vBTC flows (`transferVbtc`, `transferVbtcMulti`, `createVbtcToken`, withdrawals) | `signer` in the params object, in place of `privateKey` (passing both is an error) |
| `RawTransactionService` | `signer` option |

## Step 1: Derive the Address from the Public Key

```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

const client = new VfxClient(Network.Mainnet);

const publicKey = await hsm.getPublicKeyHex(); // uncompressed, 65 bytes as hex
const address = client.addressFromPublic(publicKey);
```

Fund this address like any other. For a reserve (vault) account held in an HSM, use `client.reserveAddressFromPublic(publicKey)` for the `xRBX…` address instead.

## Step 2: Build the Signer and Use It

```typescript
const signer: Signer = {
  address,
  publicKey,
  signDigest: (digestHex) => hsm.signDigest(digestHex), // returns DER
};

await client.sendCoin(signer, 'xRecipient...', 10);
await client.mintToken(signer, { scIdentifier, amount: 1000 });
await client.transferVbtc({ scIdentifier, fromAddress: signer.address, toAddress, amount: 0.5, signer });
```

## Example: AWS KMS

A sketch using the AWS SDK v3. KMS returns the public key as a DER `SubjectPublicKeyInfo`; for a secp256k1 key, the uncompressed point is its last 65 bytes. KMS signs a precomputed digest when `MessageType` is `DIGEST`, and returns a DER signature that may be high-s, which the SDK normalises.

```typescript
import { KMSClient, GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { VfxClient, Network, Signer } from 'vfx-web-sdk';

const kms = new KMSClient({ region: 'us-east-1' });
const KeyId = 'arn:aws:kms:...:key/...'; // key spec ECC_SECG_P256K1, usage SIGN_VERIFY

async function kmsSigner(client: VfxClient): Promise<Signer> {
  const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId }));
  const publicKey = Buffer.from(PublicKey!).subarray(-65).toString('hex');

  return {
    address: client.addressFromPublic(publicKey),
    publicKey,
    signDigest: async (digestHex) => {
      const { Signature } = await kms.send(
        new SignCommand({
          KeyId,
          Message: Buffer.from(digestHex, 'hex'),
          MessageType: 'DIGEST',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
      );
      return Signature!; // DER bytes
    },
  };
}

const client = new VfxClient(Network.Mainnet);
const signer = await kmsSigner(client);
await client.sendCoin(signer, 'xRecipient...', 1);
```

## Testing a Signer Without Spending

A `dryRun` client signs and has the node verify the transaction, then stops before sending. It is the quickest way to prove a new signer integration produces signatures the network accepts:

```typescript
const dry = new VfxClient(Network.Mainnet, true);
const hash = await dry.sendCoin(signer, 'xRecipient...', 0.01);
// a hash means the node verified the signature; nothing was broadcast
```

vBTC flows move real Bitcoin-backed value and refuse a `dryRun` client; test those on testnet.

## Raw Signatures

Callers that drive the raw transaction API themselves can turn a DER signature into the network format directly:

```typescript
import { vfxSignatureFromDer } from 'vfx-web-sdk';

const signature = vfxSignatureFromDer(derBytes, publicKey); // low-s normalised
```

## Common Issues

### `Signer address ... does not match its public key`
The `address` was derived from a different key or for the other network. Derive it with `addressFromPublic` on a client for the same network.

### Signature rejected by the node
Check that `signDigest` signs the digest it is given as-is. A service that hashes its input again (for example, KMS with `MessageType: 'RAW'`) produces a signature over the wrong message.

## What's Next?

- [Fungible Tokens](./fungible-tokens.md): issue and manage a VFX20 token with a signer as owner
- [Reserve Accounts](./reserve-accounts.md): vault accounts, including HSM-held vault and recovery keys
- [VfxClient API Reference](../api/vfx-client.md)
