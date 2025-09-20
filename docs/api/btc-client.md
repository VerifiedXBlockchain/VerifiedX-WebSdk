# BtcClient API Reference

The `BtcClient` provides comprehensive Bitcoin functionality including wallet management, transactions, and mempool interactions through the Mempool.space API.

## Constructor

### `new btc.BtcClient(network)`

Creates a new BtcClient instance.

**Parameters:**
- `network` ('mainnet' | 'testnet'): The Bitcoin network to connect to

**Example:**
```typescript
import { btc } from 'vfx-web-sdk';

const client = new btc.BtcClient('testnet');
const mainnetClient = new btc.BtcClient('mainnet');
```

## Wallet Generation

### `generatePrivateKey()`

Generates a new random Bitcoin wallet with all address types.

**Returns:** `BtcKeypair` - Complete keypair with multiple address formats

**Response Object:**
```typescript
{
  privateKey: string;
  publicKey: string;
  wif: string;
  address: string; // Default address (bech32)
  addresses: {
    p2pkh: string;    // Legacy (starts with 1)
    p2sh: string;     // Nested SegWit (starts with 3)
    bech32: string;   // Native SegWit (starts with bc1/tb1)
    bech32m: string;  // Taproot (starts with bc1p/tb1p)
  };
}
```

**Example:**
```typescript
const keypair = client.generatePrivateKey();
console.log('Default address:', keypair.address);
console.log('Legacy address:', keypair.addresses.p2pkh);
console.log('SegWit address:', keypair.addresses.bech32);
console.log('Taproot address:', keypair.addresses.bech32m);
```

### `generateMnemonic()`

Generates a new wallet with BIP39 mnemonic phrase.

**Returns:** `BtcMnemonicKeypair` - Keypair with mnemonic for recovery

**Response Object:**
```typescript
{
  mnemonic: string;
  privateKey: string;
  publicKey: string;
  wif: string;
  address: string;
  addresses: {
    p2pkh: string;
    p2sh: string;
    bech32: string;
    bech32m: string;
  };
}
```

**Example:**
```typescript
const wallet = client.generateMnemonic();
console.log('Mnemonic:', wallet.mnemonic);
console.log('Address:', wallet.address);
```

### `privateKeyFromMnemonic(mnemonic, index)`

Derives a private key from a mnemonic phrase.

**Parameters:**
- `mnemonic` (string): The BIP39 mnemonic phrase
- `index` (number): The derivation index (typically 0)

**Returns:** `BtcKeypair` - Derived keypair

**Example:**
```typescript
const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const restoredWallet = client.privateKeyFromMnemonic(mnemonic, 0);
console.log('Restored address:', restoredWallet.address);
```

### `publicFromPrivate(privateKey)`

Derives public key and addresses from a private key.

**Parameters:**
- `privateKey` (string): The private key in hexadecimal format

**Returns:** `BtcKeypair` - Complete keypair derived from private key

**Example:**
```typescript
const privateKey = "your-private-key-hex";
const keypair = client.publicFromPrivate(privateKey);
```

### `addressFromWif(wif)`

Imports a wallet from Wallet Import Format (WIF).

**Parameters:**
- `wif` (string): The WIF string

**Returns:** `BtcKeypair` - Keypair imported from WIF

**Example:**
```typescript
const wif = "your-wif-string";
const importedWallet = client.addressFromWif(wif);
```

### `generateEmailKeypair(email, password, index)`

Generates a deterministic wallet from email and password.

**Parameters:**
- `email` (string): Email address
- `password` (string): Password
- `index` (number): Derivation index

**Returns:** `BtcKeypair` - Deterministic keypair

**Example:**
```typescript
const emailWallet = client.generateEmailKeypair(
  "user@example.com",
  "secure-password",
  0
);
```

## Address Information

### `getAddressInfo(address)`

Retrieves detailed information about a Bitcoin address.

**Parameters:**
- `address` (string): The Bitcoin address to query

**Returns:** `Promise<BtcAddressInfo>` - Address information

**Response Object:**
```typescript
{
  address: string;
  balance: number;        // Balance in satoshis
  totalRecieved: number;  // Total received in satoshis
  totalSent: number;      // Total sent in satoshis
  txCount: number;        // Number of transactions
}
```

**Example:**
```typescript
const addressInfo = await client.getAddressInfo("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
console.log(`Balance: ${addressInfo.balance} satoshis`);
console.log(`BTC Balance: ${addressInfo.balance / 100000000} BTC`);
```

### `getTransactions(address)`

Retrieves transaction history for an address.

**Parameters:**
- `address` (string): The Bitcoin address to query

**Returns:** `Promise<BtcTransaction[]>` - Array of transactions

**Transaction Object:**
```typescript
{
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout?: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}
```

**Example:**
```typescript
const transactions = await client.getTransactions(address);
transactions.forEach(tx => {
  console.log(`TX: ${tx.txid}`);
  console.log(`Confirmed: ${tx.status.confirmed}`);
  console.log(`Fee: ${tx.fee} satoshis`);
});
```

## Transaction Operations

### `sendBtc(wif, toAddress, amountSats, feeRate?)`

Sends Bitcoin to another address (simplified method).

**Parameters:**
- `wif` (string): Sender's Wallet Import Format key
- `toAddress` (string): Recipient's Bitcoin address
- `amountSats` (number): Amount to send in satoshis
- `feeRate` (number, optional): Fee rate in sat/vB (uses network estimate if not provided)

**Returns:** `Promise<string>` - Transaction ID

**Example:**
```typescript
const txId = await client.sendBtc(
  wallet.wif,
  "bc1qrecipient...",
  50000,  // 0.0005 BTC
  20      // 20 sat/vB fee rate
);
console.log('Transaction sent:', txId);
```

### `createTransaction(wif, toAddress, amountSats, feeRate?)`

Creates a Bitcoin transaction without broadcasting.

**Parameters:**
- `wif` (string): Sender's WIF
- `toAddress` (string): Recipient's address
- `amountSats` (number): Amount in satoshis
- `feeRate` (number, optional): Fee rate in sat/vB

**Returns:** `Promise<TransactionResult>` - Transaction creation result

**Response Object:**
```typescript
{
  success: boolean;
  result?: string;  // Raw transaction hex
  error?: string;   // Error message if failed
}
```

**Example:**
```typescript
const result = await client.createTransaction(
  wallet.wif,
  "bc1qrecipient...",
  100000,
  15
);

if (result.success) {
  console.log('Transaction created:', result.result);
} else {
  console.error('Failed:', result.error);
}
```

### `broadcastTransaction(rawTransaction)`

Broadcasts a raw transaction to the Bitcoin network.

**Parameters:**
- `rawTransaction` (string): Raw transaction hex

**Returns:** `Promise<TransactionResult>` - Broadcast result

**Example:**
```typescript
const broadcastResult = await client.broadcastTransaction(rawTransaction);
if (broadcastResult.success) {
  console.log('Transaction ID:', broadcastResult.result);
}
```

## Network Information

### `getFeeRates()`

Retrieves current network fee rates.

**Returns:** `Promise<BtcFeeRates | null>` - Current fee rates or null if unavailable

**Response Object:**
```typescript
{
  fastestFee: number;    // Fastest confirmation (sat/vB)
  halfHourFee: number;   // ~30 minutes (sat/vB)
  hourFee: number;       // ~1 hour (sat/vB)
  economyFee: number;    // Economic rate (sat/vB)
  minimumFee: number;    // Minimum fee (sat/vB)
}
```

**Example:**
```typescript
const fees = await client.getFeeRates();
if (fees) {
  console.log('Fast fee:', fees.fastestFee, 'sat/vB');
  console.log('Standard fee:', fees.hourFee, 'sat/vB');
  console.log('Economy fee:', fees.economyFee, 'sat/vB');
}
```

## Message Signing

### `getSignature(message, privateKey)`

Signs a message with a private key.

**Parameters:**
- `message` (string): The message to sign
- `privateKey` (string): The private key in hex format

**Returns:** `string` - Message signature

**Example:**
```typescript
const signature = client.getSignature("Hello Bitcoin!", privateKey);
console.log('Signature:', signature);
```

### `getSignatureFromWif(message, wif)`

Signs a message using a WIF key.

**Parameters:**
- `message` (string): The message to sign
- `wif` (string): The WIF key

**Returns:** `string` - Message signature

**Example:**
```typescript
const signature = client.getSignatureFromWif("Hello Bitcoin!", wallet.wif);
```

## Types

### BtcKeypair

```typescript
interface BtcKeypair {
  privateKey: string;
  publicKey: string;
  wif: string;
  address: string;
  addresses: {
    p2pkh: string;
    p2sh: string;
    bech32: string;
    bech32m: string;
  };
}
```

### BtcMnemonicKeypair

```typescript
interface BtcMnemonicKeypair extends BtcKeypair {
  mnemonic: string;
}
```

### BtcAddressInfo

```typescript
interface BtcAddressInfo {
  address: string;
  balance: number;
  totalRecieved: number;
  totalSent: number;
  txCount: number;
}
```

### TransactionResult

```typescript
interface TransactionResult {
  success: boolean;
  result?: string;
  error?: string;
}
```

### BtcFeeRates

```typescript
interface BtcFeeRates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}
```

## Error Handling

Bitcoin operations can fail for various reasons. Always wrap async calls in try-catch blocks:

### Insufficient Balance
```typescript
try {
  await client.sendBtc(wif, toAddress, amount);
} catch (error) {
  if (error.message.includes('insufficient')) {
    console.log('Not enough Bitcoin balance');
  }
}
```

### Invalid Address
```typescript
try {
  await client.getAddressInfo(address);
} catch (error) {
  if (error.message.includes('address')) {
    console.log('Invalid Bitcoin address format');
  }
}
```

### Network Errors
```typescript
try {
  const fees = await client.getFeeRates();
} catch (error) {
  console.log('Network connectivity issue');
  // Fallback to default fee rates
}
```

## Best Practices

### Security
- **Secure WIF storage**: WIF keys provide full control over funds
- **Validate addresses**: Always verify recipient addresses before sending
- **Use appropriate fee rates**: Balance between speed and cost

### Performance
- **Cache fee rates**: Don't fetch fees for every transaction
- **Batch address lookups**: Group multiple address queries when possible
- **Handle rate limits**: Mempool.space API has rate limiting

### Address Types
- **Use bech32 for new applications**: Lower fees and better support
- **Support multiple formats**: For maximum compatibility
- **Default to bech32**: Unless specific requirements dictate otherwise

## Constants

### Conversion Constants
```typescript
const BTC_TO_SATOSHI_MULTIPLIER = 100000000;
const SATOSHI_TO_BTC_MULTIPLIER = 0.00000001;
```

### Networks
The client automatically configures the correct Bitcoin network based on the constructor parameter:
- `'mainnet'`: Bitcoin mainnet
- `'testnet'`: Bitcoin testnet

## Examples

### Complete Bitcoin Wallet Implementation

```typescript
import { btc } from 'vfx-web-sdk';

class BitcoinWallet {
  private client: btc.BtcClient;
  private keypair: btc.BtcKeypair | null = null;

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.client = new btc.BtcClient(network);
  }

  createWallet(): { mnemonic: string; address: string } {
    const wallet = this.client.generateMnemonic();
    this.keypair = wallet;

    return {
      mnemonic: wallet.mnemonic,
      address: wallet.address
    };
  }

  restoreWallet(mnemonic: string, index: number = 0): string {
    this.keypair = this.client.privateKeyFromMnemonic(mnemonic, index);
    return this.keypair.address;
  }

  async getBalance(): Promise<number> {
    if (!this.keypair) throw new Error('Wallet not initialized');

    const info = await this.client.getAddressInfo(this.keypair.address);
    return info.balance;
  }

  async getBalanceBTC(): Promise<number> {
    const satoshis = await this.getBalance();
    return satoshis / 100000000;
  }

  async send(toAddress: string, amountSats: number, feeRate?: number): Promise<string> {
    if (!this.keypair) throw new Error('Wallet not initialized');

    return await this.client.sendBtc(
      this.keypair.wif,
      toAddress,
      amountSats,
      feeRate
    );
  }

  async getTransactionHistory(): Promise<btc.BtcTransaction[]> {
    if (!this.keypair) throw new Error('Wallet not initialized');

    return await this.client.getTransactions(this.keypair.address);
  }

  signMessage(message: string): string {
    if (!this.keypair) throw new Error('Wallet not initialized');

    return this.client.getSignatureFromWif(message, this.keypair.wif);
  }
}
```

## Migration Notes

### From Direct vfx-btc-js Usage

If migrating from direct vfx-btc-js usage:

```typescript
// Old way
import BtcClient from 'vfx-btc-js';
const client = new BtcClient('testnet');

// New way
import { btc } from 'vfx-web-sdk';
const client = new btc.BtcClient('testnet');
```

### API Compatibility

The BtcClient maintains full compatibility with the original vfx-btc-js API while being integrated into the unified SDK.

## Integration with VFX

For cross-chain applications combining Bitcoin and VFX functionality, see the [Cross-Chain Integration Guide](../getting-started/cross-chain.md).