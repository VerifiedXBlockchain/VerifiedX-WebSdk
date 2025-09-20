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

## Transaction Methods

### `sendCoin(keypair, toAddress, amount)`

Sends VFX tokens to another address.

**Parameters:**
- `keypair` (Keypair): Object containing private key, public key, and address
- `toAddress` (string): The recipient's VFX address
- `amount` (number): The amount of VFX to send

**Returns:** `Promise<any>` - Transaction result object

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