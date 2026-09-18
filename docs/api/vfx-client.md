# VfxClient API Reference

The `VfxClient` is the main interface for interacting with the VerifiedX blockchain. It provides methods for wallet management, transactions, and address operations.

## Constructor

### `new VfxClient(network, dryRun?)`

Creates a new VfxClient instance.

**Parameters:**
- `network` (Network | string): The network to connect to (`Network.Mainnet`, `Network.Testnet`, or string equivalent)
- `dryRun` (boolean, optional): If true, transactions will not be broadcast (default: false)

**Example:**
```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

const client = new VfxClient(Network.Testnet);
const dryRunClient = new VfxClient('mainnet', true);
```

## Keypair Management

### `generatePrivateKey()`

Generates a new random private key.

**Returns:** `string` - A hexadecimal private key

**Example:**
```typescript
const privateKey = client.generatePrivateKey();
console.log(privateKey); // "a1b2c3d4e5f6..."
```

### `generateMnemonic(words?)`

Generates a BIP39 mnemonic phrase.

**Parameters:**
- `words` (12 | 24, optional): Number of words in the mnemonic (default: 12)

**Returns:** `string` - A space-separated mnemonic phrase

**Example:**
```typescript
const mnemonic12 = client.generateMnemonic(12);
const mnemonic24 = client.generateMnemonic(24);
console.log(mnemonic12); // "word1 word2 word3 ..."
```

### `privateKeyFromMneumonic(mnemonic, index)`

Derives a private key from a mnemonic phrase.

**Parameters:**
- `mnemonic` (string): The BIP39 mnemonic phrase
- `index` (number): The derivation index (typically 0 for the first account)

**Returns:** `string` - The derived private key

**Example:**
```typescript
const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const privateKey = client.privateKeyFromMneumonic(mnemonic, 0);
```

### `publicFromPrivate(privateKey)`

Derives the public key from a private key.

**Parameters:**
- `privateKey` (string): The private key in hexadecimal format

**Returns:** `string` - The corresponding public key

**Example:**
```typescript
const privateKey = client.generatePrivateKey();
const publicKey = client.publicFromPrivate(privateKey);
```

### `addressFromPrivate(privateKey)`

Derives the VFX address from a private key.

**Parameters:**
- `privateKey` (string): The private key in hexadecimal format

**Returns:** `string` - The VFX address

**Example:**
```typescript
const privateKey = client.generatePrivateKey();
const address = client.addressFromPrivate(privateKey);
console.log(address); // "VFX..."
```

### `getSignature(message, privateKey)`

Signs a message with a private key.

**Parameters:**
- `message` (string): The message to sign
- `privateKey` (string): The private key to sign with

**Returns:** `string` - The signature

**Example:**
```typescript
const signature = client.getSignature("Hello, VerifiedX!", privateKey);
```

## External Signing

Every method that signs accepts a `Keypair` or a `Signer`. A `Signer` keeps the
private key elsewhere (HSM, MPC service, hardware wallet):

```typescript
interface Signer {
  address: string;     // the VFX address the signature is verified against
  publicKey: string;   // uncompressed secp256k1 public key, hex, 04 prefix optional
  // digestHex: 32-byte SHA-256 digest of the message, as hex.
  // Return the DER-encoded ECDSA signature as bytes, hex, or base64.
  signDigest(digestHex: string): Promise<Uint8Array | string> | Uint8Array | string;
}
```

The SDK builds the network signature (`base64(DER).base58(publicKey)`) from
the DER it receives and forces low-s, so signers that return high-s
signatures (AWS KMS) need no wrapper. The address is verified against the
public key on the client's network before any request is made.

### `addressFromPublic(publicKeyHex)`

Derives the network address for an uncompressed public key. Use it to obtain
the address of an HSM-held key.

```typescript
const address = client.addressFromPublic(await hsm.getPublicKeyHex());
```

## Transaction Methods

### `sendCoin(keypair, toAddress, amount)`

Sends VFX tokens to another address.

**Parameters:**
- `keypair` (Keypair | Signer): A local keypair, or a Signer (see External Signing)
- `toAddress` (string): The recipient's VFX address
- `amount` (number): The amount of VFX to send

**Returns:** `Promise<string | null>` - The transaction hash, or `null` when the transaction never reached the node. A send whose outcome is unknown (the request went out but no response came back) throws `TransactionDispatchError` carrying the hash.

**Example:**
```typescript
const keypair = {
  private: privateKey,
  public: client.publicFromPrivate(privateKey),
  address: client.addressFromPrivate(privateKey)
};

const result = await client.sendCoin(keypair, "VFX_RECIPIENT_ADDRESS", 100);
console.log(result.txHash);
```

### `buyVfxDomain(keypair, domain)`

Purchases a VFX domain name.

**Parameters:**
- `keypair` (Keypair): The buyer's keypair
- `domain` (string): The domain name to purchase (e.g., "myapp.vfx")

**Returns:** `Promise<any>` - Transaction result object

**Example:**
```typescript
const result = await client.buyVfxDomain(keypair, "myawesomeapp.vfx");
```

**Requirements:**
- Domain must be available
- Address must not already own a domain
- Sufficient VFX balance for domain cost

### `transferVfxDomain(keypair, toAddress)`

Hands the signer's .vfx domain to `toAddress`. Costs 5 VFX. The owned name is
read from Spyglass and the recipient is checked for an existing domain, both
strictly: an API outage fails the call rather than reading as "no domain".

### `deleteVfxDomain(keypair)`

Releases the signer's .vfx domain. Costs 5 VFX.

### `transferBtcDomain(keypair, { btcFromAddress, btcToAddress, vfxToAddress })`

Moves a .btc domain to another Bitcoin address, managed by `vfxToAddress`
from then on. Costs 5 VFX. The signer must be the VFX account that currently
manages the domain for `btcFromAddress`; the node checks that pairing and that
`btcToAddress` has no domain. No Bitcoin signature is needed.

### `deleteBtcDomain(keypair, { btcFromAddress })`

Releases the .btc domain on `btcFromAddress`, managed by the signer. Costs 5 VFX.

The network refuses every domain operation from a reserve (xRBX) account.

## vBTC Multi-Contract Transfer

### `transferVbtcMulti({ toAddress, totalAmount, privateKey | signer, inputs? })`

Sends `totalAmount` vBTC in one transaction drawn from several V2 contracts
the signer holds spendable balance on. Without `inputs`, balances come from
Spyglass's `available_balances` (the address's balance minus its open
withdrawal requests) and are allocated the way the CLI does: largest first,
ties by contract id, greedy, in whole satoshis so the inputs sum to the total
exactly. A transfer that one contract can cover goes through `transferVbtc`
instead, as the wallet does. The node caps a transfer at 25 contracts and
refuses it from a reserve account or to a shielded address.

**Returns:** `Promise<{ transactionHash: string; inputs: Array<{ scIdentifier: string; amount: number }> }>`

`allocateVbtcInputs(balances, total)` and `vbtcMultiTransferData(...)` are
exported for callers that fetch balances or choose contracts themselves.

## Fungible Token Methods (VFX20)

Every mutating method returns `Promise<string | null>` with the `sendCoin`
contract, honours `dryRun`, and pays the ordinary network fee from the signer's
VFX balance. The signer's address is the acting address: the owner for mint,
pause, ban, ownership change and topic creation; the holder for transfer, burn
and votes.

### `deployToken(signer, params)`

Deploys a fungible token contract owned by the signer. The payload is compiled
on the node through Spyglass; the resulting Type 17 deploy is sent from the
signer's address.

**Parameters** (`DeployTokenParams`):
- `name` (string)
- `ticker` (string): at most 20 characters; stored upper-case
- `description` (string, optional): defaults to `name`
- `decimalPlaces` (number, optional): 1–18, default 8
- `initialSupply` (number, optional): whole tokens minted to the deployer at creation. Must be `0` for a mintable token — mint the opening balance with `mintToken` after deploy. A non-mintable token needs a positive supply.
- `mintable`, `burnable`, `voting` (boolean, optional): default `false`
- `image` (`TokenImage`, optional): `url` must be publicly fetchable — Spyglass downloads it onto the node as the contract's primary asset. `thumbnailBase64` is the small inline image wallets show; without it the node uses its default token image.

**Returns:** `Promise<{ transactionHash: string; scIdentifier: string } | null>` — the contract id is known before the send, so it is returned in `dryRun` too.

```typescript
const deployed = await client.deployToken(signer, {
  name: 'Acme Fund I',
  ticker: 'ACME1',
  description: 'Units of Acme Fund I',
  mintable: true,
  burnable: true,
});
// deployed.scIdentifier is what every later call is addressed to
```

### `mintToken(signer, { scIdentifier, amount, ticker?, name? })`

Owner only; the token must be mintable. Tokens are credited to the signer.

### `transferToken(signer, { scIdentifier, toAddress, amount, ticker?, name? })`

Moves `amount` from the signer to `toAddress`.

### `burnToken(signer, { scIdentifier, amount, ticker?, name? })`

Burns from the signer's own balance; the token must be burnable. Only a holder
can burn its own tokens — there is no issuer-side burn.

### `toggleTokenPause(signer, { scIdentifier })`

Owner only. Flips the token between paused (no transfers) and active. The node
toggles whatever the current state is, so never send this twice for one
intended change. The SDK reads the current `is_paused` from Spyglass first and
sends the resulting state in the transaction's `Pause` field, as the node's own
endpoint does; explorers and wallets display that field. It throws if the
current state cannot be read.

### `banTokenAddress(signer, { scIdentifier, address })`

Owner only. Stops `address` from sending the token. It can still receive, and
the network has no way to lift a ban.

### `transferTokenOwnership(signer, { scIdentifier, toAddress })`

Owner only. Hands the owner role to `toAddress`.

### `createTokenVoteTopic(signer, { scIdentifier, name, description, votingDays, minimumVoteRequirement, blockHeight? })`

Owner only; the token must have voting enabled. Opens a yes/no topic for
`votingDays` days, anchored to the current block height (fetched from Spyglass
unless `blockHeight` is given).

### `castTokenVote(signer, { scIdentifier, topicUid, vote, ownerAddress? })`

Casts the signer's vote. The transaction is addressed to the token owner,
looked up from Spyglass unless supplied.

### Token reads

- `listFungibleTokens(page?, limit?)` → `PaginatedResponse<FungibleToken>`
- `getFungibleToken(scIdentifier)` → `{ token: FungibleToken; holders: Record<string, number> }`
- `getFungibleTokenBalances(address)` → `FungibleTokenBalance[]` (an address Spyglass has never seen yields `[]`)
- `listTokenVotingTopics(scIdentifier, page?, limit?)` → `PaginatedResponse<TokenVotingTopic>`
- `getTokenVotingTopic(topicId)` → `TokenVotingTopic`

`ticker` and `name` travel in every token transaction for indexers and
wallets; when omitted the SDK reads them from Spyglass first.

## Reserve (Vault) Account Methods

A reserve account is an `xRBX…` address on the same key material as an
ordinary address, with a different version prefix. Sends from it wait behind
an unlock time (24 hours minimum) and can be called back until they settle;
a recovery key can sweep the vault. The node applies the delay to VFX, vBTC
and NFT sends; a fungible-token transfer from a vault carries the unlock time
but settles at once.

### Keys

- `reserveKeypairFromPrivateKey(mainPrivateKey)` → `ReserveKeypair` — the vault the web wallet pairs with a main account, derived the same way (seed from the first 32 hex characters plus a counter, retried until the address is `xRBX`; recovery key seeded from the vault key). Pinned against the wallet's keygen bundle by the compat tests.
- `reserveKeypairFromReservePrivateKey(reservePrivateKey)` — from the vault key alone; the recovery key is derived from it.
- `reserveKeypairFromRestoreCode(code)` — from `base64("<privateKey>//<recoveryPrivateKey>")`, the code the CLI prints and the wallet backs up. The recovery key in the code is used as-is.
- `generateReserveKeypair()` — a standalone vault on a fresh key.
- `reserveAddressFromPublic(publicKeyHex)` — the `xRBX` address of a public key, for HSM-held vault keys.

Sign with the `ReserveKeypair` object itself. Its private key on its own
resolves to the key's ordinary address. A `Signer` whose `address` is the
`xRBX` form is verified against `reserveAddressFromPublic` and signs for the
vault.

### `registerReserveAccount(signer, { recoveryAddress? })`

Activates a funded vault with a 4 VFX `Register()` naming the recovery
address. The vault must already hold the 4 VFX plus the fee plus the 0.5 VFX
floor the node keeps on reserve accounts (5 VFX is the wallet's funding
amount). `recoveryAddress` comes from a `ReserveKeypair`; a `Signer` must
supply it, and it must be an ordinary account.

### `sendCoin(keypair, toAddress, amount, { unlockHours? })`

From a vault the send settles after `unlockHours` (default 24, the network
minimum) and can be called back before then. Asking for less than 24 hours,
or setting `unlockHours` from an ordinary account, throws before any request.
Every token method accepts the same `unlockHours` for sends from a vault.

### `callBackReserveTransaction(signer, { hash })`

Cancels a pending send from the vault before its unlock time. `hash` is the
hash of the send. The node refuses once it has settled, and only the vault
that sent it can call it back.

### `recoverReserveAccount(signer, { recoverySigner?, recoveryAddress? })`

Sweeps the vault to its recovery address: pending sends are reversed and the
balance moves. Two signatures are needed. The vault key signs the
transaction; the recovery key signs `${SignatureTime}${recoveryAddress}`. A
`ReserveKeypair` carries both. With a `Signer` for the vault, pass
`recoverySigner` (a keypair or another `Signer`) for the recovery key. The
node accepts the recovery signature for ten minutes.

### Not available from a vault

`deployToken`, `buyVfxDomain` and `buyBtcDomain` throw when signed by a
vault: the network only allows those transaction types from an ordinary
account.

### Reading vault state

`getAddressDetails` on the `xRBX` address returns `activated` (a `Register()`
has been sent), `deactivated` (a `Recover()` has been sent) and
`balanceLocked` (sends still waiting to settle). `listTransactionsForAddress`
shows each pending send's `unlock_time` and any `callback_details`.

## Address Operations

### `getAddressDetails(address)`

Retrieves detailed information about a VFX address.

**Parameters:**
- `address` (string): The VFX address to query

**Returns:** `Promise<VfxAddress>` - Address details object

**Response Object:**
```typescript
{
  address: string;
  balance: number;
  txCount: number;
  adnr?: string; // Domain name if owned
}
```

**Example:**
```typescript
const details = await client.getAddressDetails("VFX_ADDRESS");
console.log(`Balance: ${details.balance} VFX`);
console.log(`Transactions: ${details.txCount}`);
console.log(`Domain: ${details.adnr || 'None'}`);
```

### `domainAvailable(domain)`

Checks if a domain name is available for purchase.

**Parameters:**
- `domain` (string): The domain name to check

**Returns:** `Promise<boolean>` - True if available, false if taken

**Example:**
```typescript
const isAvailable = await client.domainAvailable("myapp.vfx");
if (isAvailable) {
  console.log("Domain is available!");
} else {
  console.log("Domain is already taken");
}
```

### `lookupDomain(domain)`

Resolves a domain name to its VFX address.

**Parameters:**
- `domain` (string): The domain name to resolve

**Returns:** `Promise<string>` - The VFX address associated with the domain

**Example:**
```typescript
try {
  const address = await client.lookupDomain("example.vfx");
  console.log(`example.vfx resolves to: ${address}`);
} catch (error) {
  console.log("Domain not found");
}
```

### `lookupBtcDomain(domain)`

Resolves a domain name to its associated Bitcoin address.

**Parameters:**
- `domain` (string): The domain name to resolve

**Returns:** `Promise<string>` - The Bitcoin address associated with the domain

**Example:**
```typescript
try {
  const btcAddress = await client.lookupBtcDomain("example.vfx");
  console.log(`Bitcoin address: ${btcAddress}`);
} catch (error) {
  console.log("No Bitcoin address associated with domain");
}
```

### `listTransactionsForAddress(address, page?, limit?)`

Retrieves transaction history for an address.

**Parameters:**
- `address` (string): The VFX address to query
- `page` (number, optional): Page number for pagination (default: 1)
- `limit` (number, optional): Number of transactions per page (default: 10)

**Returns:** `Promise<PaginatedResponse<Transaction>>` - Paginated transaction list

**Example:**
```typescript
const transactions = await client.listTransactionsForAddress(
  "VFX_ADDRESS",
  1,  // page
  20  // limit
);

console.log(`Found ${transactions.data.length} transactions`);
transactions.data.forEach(tx => {
  console.log(`TX: ${tx.hash}, Amount: ${tx.amount}`);
});
```

## Types

### Keypair

```typescript
interface Keypair {
  private: string;
  public: string;
  address: string;
}
```

### Signer

```typescript
interface Signer {
  address: string;
  publicKey: string;
  signDigest(digestHex: string): Promise<Uint8Array | string> | Uint8Array | string;
}
```

### ReserveKeypair

```typescript
interface ReserveKeypair extends Keypair {
  recoveryPrivateKey: string;
  recoveryPublicKey: string;
  recoveryAddress: string;
  restoreCode: string;   // base64("<privateKey>//<recoveryPrivateKey>")
}
```

### FungibleToken

```typescript
interface FungibleToken {
  sc_identifier: string;
  name: string;
  ticker: string;
  description: string | null;
  owner_address: string;
  can_mint: boolean;
  can_burn: boolean;
  can_vote: boolean;
  created_at: string;
  initial_supply: number;
  circulating_supply: number;
  decimal_places: number;
  image_url: string | null;
  is_paused: boolean;
  banned_addresses: string[];
  nsfw: boolean;
}
```

### VfxAddress

```typescript
interface VfxAddress {
  address: string;
  balance: number;
  txCount: number;
  adnr?: string;
}
```

### Transaction

```typescript
interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  fee: number;
  timestamp: number;
  blockHeight?: number;
  status: 'pending' | 'confirmed' | 'failed';
}
```

### PaginatedResponse

```typescript
interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}
```

## Error Handling

All async methods can throw errors. Common error scenarios:

### Network Errors
```typescript
try {
  const details = await client.getAddressDetails(address);
} catch (error) {
  if (error.message.includes('Network')) {
    console.log('Network connectivity issue');
  }
}
```

### Insufficient Balance
```typescript
try {
  await client.sendCoin(keypair, toAddress, amount);
} catch (error) {
  if (error.message.includes('insufficient')) {
    console.log('Not enough VFX balance');
  }
}
```

### Domain Errors
```typescript
try {
  await client.buyVfxDomain(keypair, domain);
} catch (error) {
  if (error.message.includes('already exists')) {
    console.log('Domain is already taken');
  } else if (error.message.includes('already has')) {
    console.log('Address already owns a domain');
  }
}
```

## Constants

### Networks

```typescript
enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet'
}
```

### Transaction Types

```typescript
enum TxType {
  Transfer = 'transfer',
  Adnr = 'adnr'
}
```

## Best Practices

### Security
- Never log or expose private keys
- Validate addresses before sending transactions
- Use dry run mode for testing

### Performance
- Cache address details when possible
- Use pagination for large transaction lists
- Handle network timeouts gracefully

### Error Handling
- Always wrap async calls in try-catch
- Provide meaningful error messages to users
- Retry failed requests with exponential backoff

## Examples

### Complete Wallet Implementation

```typescript
class VfxWallet {
  private client: VfxClient;
  private keypair: Keypair | null = null;

  constructor(network: Network) {
    this.client = new VfxClient(network);
  }

  async createWallet(): Promise<{ mnemonic: string; address: string }> {
    const mnemonic = this.client.generateMnemonic(12);
    const privateKey = this.client.privateKeyFromMneumonic(mnemonic, 0);

    this.keypair = {
      private: privateKey,
      public: this.client.publicFromPrivate(privateKey),
      address: this.client.addressFromPrivate(privateKey)
    };

    return {
      mnemonic,
      address: this.keypair.address
    };
  }

  async getBalance(): Promise<number> {
    if (!this.keypair) throw new Error('Wallet not initialized');

    const details = await this.client.getAddressDetails(this.keypair.address);
    return details.balance;
  }

  async send(toAddress: string, amount: number) {
    if (!this.keypair) throw new Error('Wallet not initialized');

    return await this.client.sendCoin(this.keypair, toAddress, amount);
  }
}
```

## Migration Notes

### From v1.x to v2.x

- Constructor now requires explicit network parameter
- `btc` namespace added for Bitcoin functionality
- New transaction list method with pagination
- Enhanced error messages and types