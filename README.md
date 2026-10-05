# VerifiedX Web SDK

A comprehensive TypeScript/JavaScript SDK for VerifiedX blockchain and Bitcoin sidechain integration. This SDK provides unified access to both VFX blockchain operations and Bitcoin functionality, enabling seamless cross-chain interactions for decentralized applications.

## Features

- **Dual Blockchain Support**: Native support for both VerifiedX (VFX) and Bitcoin networks
- **Cross-Chain Operations**: Built-in support for Bitcoin sidechain interactions
- **Universal Compatibility**: Works in Node.js, browsers, and modern bundlers
- **TypeScript First**: Full type safety with comprehensive TypeScript definitions
- **Multiple Build Targets**: CommonJS, ES Modules, and browser-ready bundles
- **External Signing**: Every signing path accepts a `Signer` so keys can stay in an HSM or MPC service
- **Fungible Tokens (VFX20)**: Deploy, mint, transfer, burn, pause, ban, ownership, and holder voting

## Installation

```bash
npm install vfx-web-sdk
```

> **Upgrading to 3.1.0?** See [CHANGELOG.md](CHANGELOG.md) — it fixes insecure
> key generation and broken browser signing, and changes two behaviors you may
> rely on (browser mnemonic derivation is now BIP32 with a legacy escape hatch,
> and vBTC flows throw on a `dryRun` client instead of silently sending).

### Client options

Both clients keep their historical `(network, dryRun)` signature and also
accept an options object:

```typescript
// Point at a self-hosted node / replacement testnet without an SDK release:
const vfx = new VfxClient('testnet', { baseUrl: 'https://my-node.example.com/api', timeoutMs: 15000 });

// Same for the Bitcoin side (mempool.space-compatible API):
const btcClient = new btc.BtcClient('testnet', { apiBaseUrl: 'https://mempool.space/testnet4/api' });

// Distinguish "not found" from an API outage where it matters:
const available = await vfx.domainAvailable('name.vfx', { strict: true }); // throws VfxApiError on outage
```

### Signing with an HSM or MPC service

Every method that signs — `sendCoin`, the domain purchases, the vBTC flows and
the token methods — accepts either a `Keypair` or a `Signer`. A `Signer` never
exposes the private key: the SDK hands it the SHA-256 digest of what needs
signing and takes back a plain DER-encoded secp256k1 ECDSA signature, which is
what a KMS or HSM produces natively. The SDK assembles the network's signature
format itself and normalises high-s signatures, so a signer that does not
canonicalise (AWS KMS, for one) works unchanged.

```typescript
import { VfxClient, Signer } from 'vfx-web-sdk';

const client = new VfxClient('mainnet');

const publicKey = await hsm.getPublicKeyHex(); // uncompressed secp256k1, 04-prefixed or not
const signer: Signer = {
  address: client.addressFromPublic(publicKey),
  publicKey,
  // digestHex is the 32-byte SHA-256 digest as hex; return DER bytes, hex, or base64.
  signDigest: (digestHex) => hsm.signDigest(digestHex),
};

await client.sendCoin(signer, 'recipient-address', 10);
await client.transferVbtc({ scIdentifier, fromAddress: signer.address, toAddress, amount: 0.5, signer });
await client.mintToken(signer, { scIdentifier: tokenId, amount: 1000 });
```

The signer's `address` is checked against its public key on the client's
network before anything is built, so a wrong key or a testnet address on a
mainnet client fails immediately rather than at the node. Flows that take
`privateKey` in an options object take `signer` in its place; passing both is
an error.

## Quick Start

### VFX Operations

```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

// Initialize client
const vfxClient = new VfxClient(Network.Testnet);

// Generate keypair
const privateKey = vfxClient.generatePrivateKey();
const address = vfxClient.addressFromPrivate(privateKey);

// Send transaction
const result = await vfxClient.sendCoin({
  privateKey,
  publicKey: vfxClient.publicFromPrivate(privateKey),
  address,
}, 'recipient-address', 1000);
```

### Bitcoin Operations

```typescript
import { btc } from 'vfx-web-sdk';

// Initialize Bitcoin client
const btcClient = new btc.BtcClient('testnet');

// Generate Bitcoin keypair
const keypair = btcClient.generatePrivateKey();

// Get account information
const accountInfo = await btcClient.getAddressInfo(keypair.address);
```

### Cross-Chain Integration

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

// Initialize both clients
const vfxClient = new VfxClient(Network.Testnet);
const btcClient = new btc.BtcClient('testnet');

// Generate email-based keypair for cross-platform compatibility
const email = "user@example.com";
const password = "secure-password";
const btcKeypair = btcClient.generateEmailKeypair(email, password, 0);
```

## API Reference

### VFX Client

The `VfxClient` provides access to VerifiedX blockchain functionality:

#### Constructor

```typescript
new VfxClient(network: Network | string, dryRun?: boolean)
```

#### Keypair Management

```typescript
// Generate new private key
generatePrivateKey(): string

// Generate mnemonic phrase
generateMnemonic(words?: 12 | 24): string

// Derive private key from mnemonic
privateKeyFromMneumonic(mnemonic: string, index: number): string

// Get public key from private key
publicFromPrivate(privateKey: string): string

// Get address from private key
addressFromPrivate(privateKey: string): string
```

#### Transactions

```typescript
// Send VFX. Resolves to the transaction hash, or null if it never reached the node.
sendCoin(keypair: Keypair | Signer, toAddress: string, amount: number): Promise<string | null>

// Purchase VFX domain
buyVfxDomain(keypair: Keypair | Signer, domain: string): Promise<string | null>

// Address for an external signer's public key (the SDK never sees the private key)
addressFromPublic(publicKeyHex: string): string
```

#### Fungible Tokens (VFX20)

Every mutating method returns the transaction hash, or `null` when the
transaction never reached the node (the `sendCoin` contract), and honours
`dryRun`. The signer's address is the acting address: the owner for mint,
pause, ban, ownership change and topic creation; the holder for transfer, burn
and votes. Token operations pay the ordinary network fee in VFX.

```typescript
// Deploy a token contract owned by the signer. Returns the contract id
// (scIdentifier) every later call is addressed to — even in dryRun.
deployToken(signer, {
  name, ticker,                      // ticker ≤ 20 chars, stored upper-case
  description?,                      // defaults to name
  decimalPlaces?,                    // 1–18, default 8
  initialSupply?,                    // whole tokens minted to the deployer; must be 0 when mintable
  mintable?, burnable?, voting?,     // default false
  image?: { url, name?, extension?, fileSize?, thumbnailBase64? }, // url must be publicly fetchable
}): Promise<{ transactionHash: string; scIdentifier: string } | null>

mintToken(signer, { scIdentifier, amount, ticker?, name? })            // owner; token must be mintable
transferToken(signer, { scIdentifier, toAddress, amount, ticker?, name? })
burnToken(signer, { scIdentifier, amount, ticker?, name? })            // holder's own balance; token must be burnable
toggleTokenPause(signer, { scIdentifier })                             // owner; flips paused ↔ active (see below)
banTokenAddress(signer, { scIdentifier, address })                     // owner; permanent — the network cannot unban
transferTokenOwnership(signer, { scIdentifier, toAddress })            // owner
createTokenVoteTopic(signer, { scIdentifier, name, description, votingDays, minimumVoteRequirement, blockHeight? })
castTokenVote(signer, { scIdentifier, topicUid, vote, ownerAddress? })

// Reads (Spyglass)
listFungibleTokens(page?, limit?): Promise<PaginatedResponse<FungibleToken>>
getFungibleToken(scIdentifier): Promise<{ token: FungibleToken; holders: Record<string, number> }>
getFungibleTokenBalances(address): Promise<Array<{ token: FungibleToken; balance: number }>>
listTokenVotingTopics(scIdentifier, page?, limit?)
getTokenVotingTopic(topicId)
```

Two behaviours worth knowing before wiring these into anything automated:

- **Pause is a toggle.** The node flips the current state whatever the
  transaction asks for, so never send `toggleTokenPause` twice for one
  intended change. The SDK reads `is_paused` from Spyglass and labels the
  transaction with the state it produces, which is what explorers and wallets
  display.
- **Ban cannot be undone**, and a banned address can still receive. Treat it as
  permanent.

`ticker` and `name` ride in every token transaction for indexers and wallets;
pass them to skip the Spyglass lookup the SDK otherwise makes.

#### Address Operations

```typescript
// Get address details
getAddressDetails(address: string): Promise<VfxAddress>

// Check domain availability
domainAvailable(domain: string): Promise<boolean>

// Lookup domain
lookupDomain(domain: string): Promise<string>

// Lookup Bitcoin domain
lookupBtcDomain(domain: string): Promise<string>
```

### Bitcoin Client

The `btc` namespace provides comprehensive Bitcoin functionality through the `BtcClient`:

```typescript
// Initialize Bitcoin client
const btcClient = new btc.BtcClient(network?: 'mainnet' | 'testnet', dryRun?: boolean)

// Keypair generation methods
generatePrivateKey(): IBtcKeypair
generateMnemonic(): IBtcKeypair
privateKeyFromMnemonic(mnemonic: string, index?: number): IBtcKeypair
publicFromPrivate(privateKey: string): IBtcKeypair
addressFromPrivate(privateKey: string): IBtcKeypair
addressFromWif(wif: string): IBtcKeypair
generateEmailKeypair(email: string, password: string, index?: number): IBtcKeypair

// Signing methods
getSignature(message: string, privateKey: string): string
getSignatureFromWif(message: string, wif: string): string

// Account information
getAddressInfo(address: string, inSatoshis?: boolean): Promise<IAccountInfo>
getTransactions(address: string, limit?: number, before?: number | null): Promise<ITransaction[]>

// Transaction operations
getFeeRates(): Promise<IFeeRates | null>
createTransaction(senderWif: string, recipientAddress: string, amount: number, feeRate?: number): Promise<ICreateTxResponse>
broadcastTransaction(transactionHex: string): Promise<IBroadcastTxResponse>
sendBtc(senderWif: string, recipientAddress: string, amount: number, feeRate?: number): Promise<string | null>

// Utility methods
getRawTransaction(txId: string): Promise<Buffer>
```


## Browser Usage

### Script Tag

```html
<script src="node_modules/vfx-web-sdk/lib/browser.js"></script>
<script>
  // VFX operations
  const vfxClient = new window.vfx.VfxClient('testnet');

  // Bitcoin operations
  const btcClient = new window.btc.BtcClient('testnet');
</script>
```

### ES Modules

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';
```

### CommonJS

```javascript
const { VfxClient, btc, Network } = require('vfx-web-sdk');
```

## Network Configuration

### VerifiedX Networks

```typescript
import { Network } from 'vfx-web-sdk';

// Mainnet
const mainnetClient = new VfxClient(Network.Mainnet);

// Testnet
const testnetClient = new VfxClient(Network.Testnet);
```

### Bitcoin Networks

```typescript
// Mainnet
const btcMainnet = new btc.BtcClient('mainnet');

// Testnet
const btcTestnet = new btc.BtcClient('testnet');
```

## TypeScript Support

The SDK provides comprehensive TypeScript definitions:

```typescript
import type {
  Keypair,
  Signer,
  VfxAddress,
  Transaction,
  PaginatedResponse,
  FungibleToken,
  FungibleTokenBalance,
  DeployTokenParams,
  DeployTokenResult,
} from 'vfx-web-sdk';

import type {
  IBtcKeypair,
  IBtcAddresses,
  IAccountInfo,
  ITransaction,
  ICreateTxResponse,
  IBroadcastTxResponse,
  IFeeRates
} from 'vfx-web-sdk';
```

## Error Handling

```typescript
try {
  const result = await vfxClient.sendCoin(keypair, toAddress, amount);
  console.log('Transaction successful:', result);
} catch (error) {
  console.error('Transaction failed:', error.message);
}
```

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build all targets
npm run build

# Build specific targets
npm run build:cjs    # CommonJS
npm run build:esm    # ES Modules
npm run build:browser # Browser bundle
```

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testNamePattern="VFX"
npm test -- --testNamePattern="BTC"
```

### Environment Variables

Create a `.env` file for testing:

```bash
PRIVATE_KEY=your-test-private-key
FROM_ADDRESS=your-test-address
TO_ADDRESS=recipient-test-address
```

## Examples

### Complete VFX Workflow

```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

async function vfxExample() {
  const client = new VfxClient(Network.Testnet);

  // Generate wallet
  const mnemonic = client.generateMnemonic(12);
  const privateKey = client.privateKeyFromMneumonic(mnemonic, 0);
  const address = client.addressFromPrivate(privateKey);

  // Check balance
  const addressDetails = await client.getAddressDetails(address);
  console.log('Balance:', addressDetails.balance);

  // Send transaction
  const keypair = {
    private: privateKey,
    public: client.publicFromPrivate(privateKey),
    address: address
  };

  const result = await client.sendCoin(keypair, 'recipient-address', 1000);
  console.log('Transaction:', result);
}
```

### Complete Bitcoin Workflow

```typescript
import { btc } from 'vfx-web-sdk';

async function bitcoinExample() {
  const client = new btc.BtcClient('testnet');

  // Generate wallet
  const keypair = client.generatePrivateKey();
  console.log('Bitcoin address:', keypair.address);
  console.log('All address formats:', keypair.addresses);

  // Check balance
  const accountInfo = await client.getAddressInfo(keypair.address);
  console.log('Balance:', accountInfo.balance, 'satoshis');

  // Get transaction history
  const transactions = await client.getTransactions(keypair.address);
  console.log('Transaction count:', transactions.length);

  // Send transaction (if sufficient balance)
  if (accountInfo.balance > 10000) {
    const result = await client.sendBtc(
      keypair.wif,
      'recipient-address',
      5000 // satoshis
    );
    console.log('Transaction ID:', result);
  }
}
```

### Cross-Chain Email Keypair

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

async function crossChainExample() {
  const email = "user@example.com";
  const password = "secure-password";

  // Generate VFX keypair
  const vfxClient = new VfxClient(Network.Testnet);
  const vfxPrivateKey = vfxClient.generatePrivateKey();

  // Generate Bitcoin keypair from VFX key (for cross-platform compatibility)
  const btcClient = new btc.BtcClient('testnet');
  const btcKeypair = btcClient.generateEmailKeypair(email, password, 0);

  console.log('VFX Address:', vfxClient.addressFromPrivate(vfxPrivateKey));
  console.log('BTC Address:', btcKeypair.address);

  // Both keypairs can be recreated on any platform using the same email/password
}
```

## Package Information

- **Version**: 3.3.0
- **License**: MIT
- **Repository**: [VerifiedX-WebSdk](https://github.com/VerifiedXBlockchain/VerifiedX-WebSdk)
- **Documentation**: See inline TypeScript definitions for detailed API documentation

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to the main repository.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Support

For questions, issues, or feature requests, please visit our [GitHub Issues](https://github.com/VerifiedXBlockchain/VerifiedX-WebSdk/issues) page.