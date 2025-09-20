# Types & Interfaces

This document provides comprehensive TypeScript type definitions for the VerifiedX Web SDK.

## VFX Types

### Core Types

```typescript
// Network enumeration
enum Network {
  Mainnet = 'mainnet',
  Testnet = 'testnet'
}

// Transaction type enumeration
enum TxType {
  Transfer = 'transfer',
  Adnr = 'adnr'
}
```

### Keypair Interface

```typescript
interface Keypair {
  private: string;   // Private key in hexadecimal format
  public: string;    // Public key in hexadecimal format
  address: string;   // VFX address
}
```

### VFX Address Information

```typescript
interface VfxAddress {
  address: string;        // The VFX address
  balance: number;        // Balance in VFX tokens
  txCount: number;        // Number of transactions
  adnr?: string;         // Associated domain name (if any)
}
```

### Transaction Interface

```typescript
interface Transaction {
  hash: string;                                    // Transaction hash
  from: string;                                   // Sender address
  to: string;                                     // Recipient address
  amount: number;                                 // Amount transferred
  fee: number;                                    // Transaction fee
  timestamp: number;                              // Unix timestamp
  blockHeight?: number;                           // Block height (if confirmed)
  status: 'pending' | 'confirmed' | 'failed';    // Transaction status
}
```

### Paginated Response

```typescript
interface PaginatedResponse<T> {
  data: T[];           // Array of items
  total: number;       // Total number of items
  page: number;        // Current page number
  limit: number;       // Items per page
  hasNext: boolean;    // Whether there are more pages
  hasPrev: boolean;    // Whether there are previous pages
}
```

## Bitcoin Types

### Bitcoin Keypair Types

```typescript
// Basic Bitcoin keypair
interface BtcKeypair {
  privateKey: string;    // Private key in hexadecimal format
  publicKey: string;     // Public key in hexadecimal format
  wif: string;          // Wallet Import Format
  address: string;      // Default address (bech32)
  addresses: {
    p2pkh: string;      // Legacy address (starts with 1/m)
    p2sh: string;       // Nested SegWit (starts with 3/2)
    bech32: string;     // Native SegWit (starts with bc1/tb1)
    bech32m: string;    // Taproot (starts with bc1p/tb1p)
  };
}

// Bitcoin keypair with mnemonic
interface BtcMnemonicKeypair extends BtcKeypair {
  mnemonic: string;     // BIP39 mnemonic phrase
}
```

### Bitcoin Address Information

```typescript
interface BtcAddressInfo {
  address: string;         // Bitcoin address
  balance: number;         // Balance in satoshis
  totalRecieved: number;   // Total received in satoshis
  totalSent: number;       // Total sent in satoshis
  txCount: number;         // Number of transactions
}
```

### Bitcoin Transaction Types

```typescript
// Transaction input
interface BtcTransactionInput {
  txid: string;            // Previous transaction ID
  vout: number;            // Output index
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
}

// Transaction output
interface BtcTransactionOutput {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number;           // Value in satoshis
}

// Transaction status
interface BtcTransactionStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

// Complete Bitcoin transaction
interface BtcTransaction {
  txid: string;                      // Transaction ID
  version: number;                   // Transaction version
  locktime: number;                  // Lock time
  vin: BtcTransactionInput[];        // Transaction inputs
  vout: BtcTransactionOutput[];      // Transaction outputs
  size: number;                      // Transaction size in bytes
  weight: number;                    // Transaction weight
  fee: number;                       // Transaction fee in satoshis
  status: BtcTransactionStatus;      // Transaction status
}
```

### Bitcoin Fee Rates

```typescript
interface BtcFeeRates {
  fastestFee: number;     // Fastest confirmation fee (sat/vB)
  halfHourFee: number;    // ~30 minute confirmation fee (sat/vB)
  hourFee: number;        // ~1 hour confirmation fee (sat/vB)
  economyFee: number;     // Economy fee rate (sat/vB)
  minimumFee: number;     // Minimum fee rate (sat/vB)
}
```

### Transaction Result Types

```typescript
// Generic transaction result
interface TransactionResult {
  success: boolean;
  result?: string;        // Transaction ID or raw transaction
  error?: string;         // Error message if failed
}

// Bitcoin transaction creation result
interface BtcTransactionCreateResult extends TransactionResult {
  result?: string;        // Raw transaction hex
}

// Bitcoin transaction broadcast result
interface BtcTransactionBroadcastResult extends TransactionResult {
  result?: string;        // Transaction ID
}
```

## Utility Types

### Network Types

```typescript
// Supported networks
type NetworkType = 'mainnet' | 'testnet';

// VFX Network enumeration values
type VfxNetworkType = Network.Mainnet | Network.Testnet;
```

### Address Types

```typescript
// VFX address (starts with 'VFX')
type VfxAddressString = string;

// Bitcoin address types
type BitcoinLegacyAddress = string;      // P2PKH (1... or m/n...)
type BitcoinSegWitAddress = string;      // P2SH (3... or 2...)
type BitcoinBech32Address = string;      // Native SegWit (bc1... or tb1...)
type BitcoinTaprootAddress = string;     // Taproot (bc1p... or tb1p...)

type BitcoinAddress =
  | BitcoinLegacyAddress
  | BitcoinSegWitAddress
  | BitcoinBech32Address
  | BitcoinTaprootAddress;
```

### Key Types

```typescript
// Private key in hexadecimal format
type PrivateKey = string;

// Public key in hexadecimal format
type PublicKey = string;

// Wallet Import Format
type WIF = string;

// BIP39 mnemonic phrase
type Mnemonic = string;
```

### Amount Types

```typescript
// VFX amount (integer)
type VfxAmount = number;

// Bitcoin amount in satoshis
type SatoshiAmount = number;

// Bitcoin amount in BTC
type BtcAmount = number;

// Fee rate in satoshis per virtual byte
type FeeRate = number;
```

## Error Types

### Base Error Types

```typescript
// Generic SDK error
interface SdkError extends Error {
  code?: string;
  details?: any;
}

// Network-related errors
interface NetworkError extends SdkError {
  code: 'NETWORK_ERROR';
  statusCode?: number;
}

// Validation errors
interface ValidationError extends SdkError {
  code: 'VALIDATION_ERROR';
  field?: string;
}

// Transaction errors
interface TransactionError extends SdkError {
  code: 'TRANSACTION_ERROR';
  txHash?: string;
}
```

### Specific Error Types

```typescript
// Insufficient balance error
interface InsufficientBalanceError extends TransactionError {
  code: 'INSUFFICIENT_BALANCE';
  required: number;
  available: number;
}

// Invalid address error
interface InvalidAddressError extends ValidationError {
  code: 'INVALID_ADDRESS';
  address: string;
}

// Domain errors
interface DomainError extends SdkError {
  code: 'DOMAIN_ERROR';
  domain: string;
}

interface DomainNotAvailableError extends DomainError {
  code: 'DOMAIN_NOT_AVAILABLE';
}

interface DomainNotFoundError extends DomainError {
  code: 'DOMAIN_NOT_FOUND';
}
```

## Constants and Enums

### Bitcoin Constants

```typescript
// Conversion constants
const BTC_TO_SATOSHI_MULTIPLIER = 100000000;
const SATOSHI_TO_BTC_MULTIPLIER = 0.00000001;

// Address type identifiers
enum BitcoinAddressType {
  P2PKH = 'p2pkh',        // Legacy
  P2SH = 'p2sh',          // Nested SegWit
  BECH32 = 'bech32',      // Native SegWit
  BECH32M = 'bech32m'     // Taproot
}
```

### Transaction Types

```typescript
// VFX transaction types
enum VfxTransactionType {
  TRANSFER = 'transfer',
  DOMAIN = 'adnr'
}

// Bitcoin transaction types
enum BtcTransactionType {
  P2PKH = 'p2pkh',
  P2SH = 'p2sh',
  P2WPKH = 'v0_p2wpkh',
  P2WSH = 'v0_p2wsh',
  P2TR = 'v1_p2tr'
}
```

## Advanced Types

### Generic Response Types

```typescript
// API response wrapper
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// Async operation result
type AsyncResult<T> = Promise<T>;

// Optional result (may be null)
type OptionalResult<T> = T | null;
```

### Configuration Types

```typescript
// Client configuration
interface ClientConfig {
  network: NetworkType;
  timeout?: number;
  retries?: number;
  apiKey?: string;
}

// VFX client configuration
interface VfxClientConfig extends ClientConfig {
  dryRun?: boolean;
}

// Bitcoin client configuration
interface BtcClientConfig extends ClientConfig {
  feeRate?: number;
  rbf?: boolean;  // Replace-by-fee
}
```

### Event Types

```typescript
// Transaction event
interface TransactionEvent {
  type: 'transaction';
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
}

// Balance change event
interface BalanceChangeEvent {
  type: 'balance_change';
  address: string;
  oldBalance: number;
  newBalance: number;
  timestamp: number;
}

// Domain event
interface DomainEvent {
  type: 'domain';
  action: 'purchased' | 'transferred';
  domain: string;
  address: string;
  timestamp: number;
}

type SdkEvent = TransactionEvent | BalanceChangeEvent | DomainEvent;
```

## Type Guards

### Utility type guards for runtime type checking

```typescript
// Check if value is a valid VFX address
function isVfxAddress(value: any): value is VfxAddressString {
  return typeof value === 'string' && value.startsWith('VFX');
}

// Check if value is a valid Bitcoin address
function isBitcoinAddress(value: any): value is BitcoinAddress {
  if (typeof value !== 'string') return false;

  // Simplified check - in practice, use proper validation
  return /^[13bc1tb1]/.test(value);
}

// Check if object is a valid keypair
function isKeypair(value: any): value is Keypair {
  return (
    typeof value === 'object' &&
    typeof value.private === 'string' &&
    typeof value.public === 'string' &&
    typeof value.address === 'string'
  );
}

// Check if object is a Bitcoin keypair
function isBtcKeypair(value: any): value is BtcKeypair {
  return (
    typeof value === 'object' &&
    typeof value.privateKey === 'string' &&
    typeof value.publicKey === 'string' &&
    typeof value.wif === 'string' &&
    typeof value.address === 'string' &&
    typeof value.addresses === 'object'
  );
}
```

## Module Exports

### Complete type exports from the SDK

```typescript
// VFX exports
export {
  VfxClient,
  Network,
  TxType,
  type Keypair,
  type VfxAddress,
  type Transaction,
  type PaginatedResponse
};

// Bitcoin exports
export namespace btc {
  export {
    BtcClient,
    type BtcKeypair,
    type BtcMnemonicKeypair,
    type BtcAddressInfo,
    type BtcTransaction,
    type BtcFeeRates,
    type TransactionResult
  };
}

// Utility exports
export {
  type NetworkType,
  type VfxNetworkType,
  type PrivateKey,
  type PublicKey,
  type WIF,
  type Mnemonic,
  type VfxAmount,
  type SatoshiAmount,
  type BtcAmount,
  type FeeRate
};
```

These type definitions provide complete TypeScript support for the VerifiedX Web SDK, enabling full type safety and IntelliSense support in your applications.