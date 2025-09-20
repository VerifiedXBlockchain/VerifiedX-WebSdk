# Code Snippets

This section provides focused code examples for common tasks using the VerifiedX Web SDK. These snippets are designed to be copy-paste ready for your applications.

## VFX Examples

### Quick Wallet Setup

```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

// Create client
const client = new VfxClient(Network.Testnet);

// Generate wallet
const privateKey = client.generatePrivateKey();
const keypair = {
  private: privateKey,
  public: client.publicFromPrivate(privateKey),
  address: client.addressFromPrivate(privateKey)
};

console.log('VFX Address:', keypair.address);
```

### Send VFX Transaction

```typescript
async function sendVfx(client, fromKeypair, toAddress, amount) {
  try {
    // Check balance first
    const details = await client.getAddressDetails(fromKeypair.address);
    if (details.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Send transaction
    const result = await client.sendCoin(fromKeypair, toAddress, amount);
    console.log('Transaction sent:', result.txHash);
    return result.txHash;
  } catch (error) {
    console.error('Transaction failed:', error.message);
    throw error;
  }
}
```

### Check Address Balance

```typescript
async function checkBalance(client, address) {
  try {
    const details = await client.getAddressDetails(address);
    console.log(`Balance: ${details.balance} VFX`);
    console.log(`Transactions: ${details.txCount}`);
    if (details.adnr) {
      console.log(`Domain: ${details.adnr}`);
    }
    return details;
  } catch (error) {
    console.error('Failed to fetch balance:', error.message);
    return null;
  }
}
```

### Domain Operations

```typescript
// Check domain availability
async function checkDomain(client, domain) {
  const available = await client.domainAvailable(domain);
  console.log(`${domain} is ${available ? 'available' : 'taken'}`);
  return available;
}

// Purchase domain
async function buyDomain(client, keypair, domain) {
  try {
    const available = await client.domainAvailable(domain);
    if (!available) {
      throw new Error('Domain not available');
    }

    const result = await client.buyVfxDomain(keypair, domain);
    console.log('Domain purchased:', result);
    return result;
  } catch (error) {
    console.error('Domain purchase failed:', error.message);
    throw error;
  }
}

// Lookup domain
async function lookupDomain(client, domain) {
  try {
    const address = await client.lookupDomain(domain);
    console.log(`${domain} → ${address}`);
    return address;
  } catch (error) {
    console.log(`${domain} not found`);
    return null;
  }
}
```

### Mnemonic Wallet Recovery

```typescript
function restoreVfxWallet(client, mnemonic, index = 0) {
  try {
    const privateKey = client.privateKeyFromMneumonic(mnemonic, index);
    const keypair = {
      private: privateKey,
      public: client.publicFromPrivate(privateKey),
      address: client.addressFromPrivate(privateKey)
    };

    console.log('Wallet restored:', keypair.address);
    return keypair;
  } catch (error) {
    console.error('Failed to restore wallet:', error.message);
    throw error;
  }
}
```

## Bitcoin Examples

### Quick Bitcoin Wallet

```typescript
import { btc } from 'vfx-web-sdk';

// Create client
const client = new btc.BtcClient('testnet');

// Generate wallet with all address types
const wallet = client.generatePrivateKey();
console.log('Bitcoin Addresses:');
console.log('Default (bech32):', wallet.address);
console.log('Legacy:', wallet.addresses.p2pkh);
console.log('SegWit:', wallet.addresses.bech32);
console.log('Taproot:', wallet.addresses.bech32m);
```

### Send Bitcoin Transaction

```typescript
async function sendBitcoin(client, wif, toAddress, amountSats, feeRate = 20) {
  try {
    console.log(`Sending ${amountSats} sats to ${toAddress}`);

    const txId = await client.sendBtc(wif, toAddress, amountSats, feeRate);
    console.log('Transaction sent:', txId);
    return txId;
  } catch (error) {
    console.error('Bitcoin transaction failed:', error.message);
    throw error;
  }
}
```

### Check Bitcoin Balance

```typescript
async function checkBitcoinBalance(client, address) {
  try {
    const info = await client.getAddressInfo(address);
    console.log(`Balance: ${info.balance} satoshis`);
    console.log(`BTC: ${info.balance / 100000000} BTC`);
    console.log(`Transactions: ${info.txCount}`);
    return info;
  } catch (error) {
    console.error('Failed to fetch Bitcoin balance:', error.message);
    return null;
  }
}
```

### Get Fee Estimates

```typescript
async function getFeeEstimates(client) {
  try {
    const fees = await client.getFeeRates();
    if (fees) {
      console.log('Fee rates (sat/vB):');
      console.log(`Fastest: ${fees.fastestFee}`);
      console.log(`Half hour: ${fees.halfHourFee}`);
      console.log(`One hour: ${fees.hourFee}`);
      console.log(`Economy: ${fees.economyFee}`);
      return fees;
    }
  } catch (error) {
    console.error('Failed to get fee rates:', error.message);
    return null;
  }
}
```

### Mnemonic Bitcoin Wallet

```typescript
// Generate with mnemonic
function createBitcoinWallet(client) {
  const wallet = client.generateMnemonic();
  console.log('Mnemonic:', wallet.mnemonic);
  console.log('Address:', wallet.address);
  return wallet;
}

// Restore from mnemonic
function restoreBitcoinWallet(client, mnemonic, index = 0) {
  const wallet = client.privateKeyFromMnemonic(mnemonic, index);
  console.log('Restored address:', wallet.address);
  return wallet;
}
```

### Sign Bitcoin Messages

```typescript
function signBitcoinMessage(client, message, wif) {
  try {
    const signature = client.getSignatureFromWif(message, wif);
    console.log('Message signature:', signature);
    return signature;
  } catch (error) {
    console.error('Failed to sign message:', error.message);
    throw error;
  }
}
```

## Cross-Chain Examples

### Unified Mnemonic Wallet

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

function createUnifiedWallet(network = 'testnet') {
  const vfxClient = new VfxClient(
    network === 'mainnet' ? Network.Mainnet : Network.Testnet
  );
  const btcClient = new btc.BtcClient(network);

  // Generate shared mnemonic
  const mnemonic = vfxClient.generateMnemonic(12);

  // Create VFX wallet
  const vfxPrivateKey = vfxClient.privateKeyFromMneumonic(mnemonic, 0);
  const vfxWallet = {
    private: vfxPrivateKey,
    public: vfxClient.publicFromPrivate(vfxPrivateKey),
    address: vfxClient.addressFromPrivate(vfxPrivateKey)
  };

  // Create Bitcoin wallet
  const btcWallet = btcClient.privateKeyFromMnemonic(mnemonic, 0);

  return {
    mnemonic,
    vfx: vfxWallet,
    btc: btcWallet
  };
}
```

### Cross-Chain Balance Check

```typescript
async function checkAllBalances(vfxClient, btcClient, vfxAddress, btcAddress) {
  try {
    const [vfxDetails, btcInfo] = await Promise.allSettled([
      vfxClient.getAddressDetails(vfxAddress),
      btcClient.getAddressInfo(btcAddress)
    ]);

    const balances = {
      vfx: 0,
      btc: 0,
      btcSats: 0
    };

    if (vfxDetails.status === 'fulfilled') {
      balances.vfx = vfxDetails.value.balance;
    }

    if (btcInfo.status === 'fulfilled') {
      balances.btcSats = btcInfo.value.balance;
      balances.btc = btcInfo.value.balance / 100000000;
    }

    console.log('Balances:', balances);
    return balances;
  } catch (error) {
    console.error('Failed to fetch balances:', error.message);
    return null;
  }
}
```

### Dual Chain Message Signing

```typescript
function signOnBothChains(vfxClient, btcClient, message, vfxPrivateKey, btcWif) {
  try {
    const signatures = {
      vfx: vfxClient.getSignature(message, vfxPrivateKey),
      btc: btcClient.getSignatureFromWif(message, btcWif)
    };

    console.log('Signatures:', signatures);
    return signatures;
  } catch (error) {
    console.error('Failed to sign message:', error.message);
    throw error;
  }
}
```

## Utility Functions

### Address Validation

```typescript
function isValidVfxAddress(address) {
  return address && typeof address === 'string' && address.startsWith('VFX');
}

function isValidBitcoinAddress(address, network = 'testnet') {
  if (!address || typeof address !== 'string') return false;

  if (network === 'mainnet') {
    return address.startsWith('1') ||
           address.startsWith('3') ||
           address.startsWith('bc1');
  } else {
    return address.startsWith('m') ||
           address.startsWith('n') ||
           address.startsWith('2') ||
           address.startsWith('tb1');
  }
}
```

### Amount Formatting

```typescript
function formatVfxAmount(amount) {
  return `${amount.toLocaleString()} VFX`;
}

function formatBtcAmount(satoshis) {
  const btc = satoshis / 100000000;
  return {
    satoshis: satoshis.toLocaleString(),
    btc: btc.toFixed(8),
    formatted: `${btc.toFixed(8)} BTC`
  };
}
```

### Error Handling Wrapper

```typescript
function withErrorHandling(asyncFn) {
  return async (...args) => {
    try {
      return await asyncFn(...args);
    } catch (error) {
      console.error(`Operation failed: ${error.message}`);
      return null;
    }
  };
}

// Usage
const safeCheckBalance = withErrorHandling(checkBalance);
const safeGetFees = withErrorHandling(getFeeEstimates);
```

### Retry Logic

```typescript
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      console.log(`Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

// Usage
const balanceWithRetry = () => withRetry(() =>
  client.getAddressDetails(address)
);
```

## React Integration Examples

### VFX Balance Hook

```typescript
import { useState, useEffect } from 'react';
import { VfxClient, Network } from 'vfx-web-sdk';

function useVfxBalance(address, network = Network.Testnet) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address) return;

    const client = new VfxClient(network);
    setLoading(true);

    client.getAddressDetails(address)
      .then(details => {
        setBalance(details.balance);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setBalance(null);
      })
      .finally(() => setLoading(false));
  }, [address, network]);

  return { balance, loading, error };
}
```

### Bitcoin Transaction Hook

```typescript
import { useState } from 'react';
import { btc } from 'vfx-web-sdk';

function useBitcoinTransaction(network = 'testnet') {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const sendTransaction = async (wif, toAddress, amount, feeRate) => {
    setSending(true);
    setError(null);

    try {
      const client = new btc.BtcClient(network);
      const txId = await client.sendBtc(wif, toAddress, amount, feeRate);
      return txId;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSending(false);
    }
  };

  return { sendTransaction, sending, error };
}
```

## Node.js Examples

### Environment Setup

```typescript
// For Node.js applications
import { VfxClient, btc, Network } from 'vfx-web-sdk';
import * as dotenv from 'dotenv';

dotenv.config();

const network = process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet';
const vfxClient = new VfxClient(
  network === 'mainnet' ? Network.Mainnet : Network.Testnet
);
const btcClient = new btc.BtcClient(network);
```

### Secure Key Storage

```typescript
import * as crypto from 'crypto';

function encryptPrivateKey(privateKey, password) {
  const cipher = crypto.createCipher('aes-256-cbc', password);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decryptPrivateKey(encryptedKey, password) {
  const decipher = crypto.createDecipher('aes-256-cbc', password);
  let decrypted = decipher.update(encryptedKey, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Batch Operations

```typescript
async function batchCheckBalances(client, addresses) {
  const promises = addresses.map(address =>
    client.getAddressDetails(address)
      .catch(error => ({ address, error: error.message }))
  );

  const results = await Promise.all(promises);
  return results;
}
```

## Testing Examples

### Mock Clients

```typescript
// Mock VFX client for testing
class MockVfxClient {
  generatePrivateKey() {
    return 'mock-private-key';
  }

  addressFromPrivate(privateKey) {
    return 'VFX_MOCK_ADDRESS';
  }

  async getAddressDetails(address) {
    return { balance: 1000, txCount: 5 };
  }

  async sendCoin(keypair, toAddress, amount) {
    return { txHash: 'mock-tx-hash' };
  }
}
```

### Unit Test Example

```typescript
describe('VFX Operations', () => {
  let client;

  beforeEach(() => {
    client = new MockVfxClient();
  });

  test('should generate wallet', () => {
    const privateKey = client.generatePrivateKey();
    const address = client.addressFromPrivate(privateKey);

    expect(privateKey).toBeDefined();
    expect(address).toMatch(/^VFX/);
  });

  test('should check balance', async () => {
    const details = await client.getAddressDetails('VFX_TEST_ADDRESS');

    expect(details.balance).toBeGreaterThanOrEqual(0);
    expect(details.txCount).toBeGreaterThanOrEqual(0);
  });
});
```

These snippets provide practical, copy-paste ready code for common operations. For complete applications and more complex examples, see [Complete Applications](./applications.md).