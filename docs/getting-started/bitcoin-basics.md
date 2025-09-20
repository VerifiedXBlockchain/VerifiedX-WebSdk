# Bitcoin Basics: Getting Started with Bitcoin Integration

This guide covers how to use the VerifiedX Web SDK for Bitcoin operations. The SDK provides a comprehensive Bitcoin client that supports wallet management, transactions, and mempool interactions through the Mempool.space API.

## Prerequisites

- Node.js 18+ or a modern browser
- Basic understanding of Bitcoin concepts
- `vfx-web-sdk` installed in your project

## Understanding Bitcoin Networks

The SDK supports both Bitcoin networks:

- **Mainnet**: The production Bitcoin network with real BTC
- **Testnet**: The test network with test BTC (recommended for development)

## Step 1: Initialize the Bitcoin Client

The `BtcClient` provides all Bitcoin functionality in a single interface:

```typescript
import { btc } from 'vfx-web-sdk';

// Initialize for testnet (recommended for development)
const client = new btc.BtcClient('testnet');

// For mainnet (production)
// const client = new btc.BtcClient('mainnet');
```

## Step 2: Generate Bitcoin Wallets

The SDK supports multiple ways to create Bitcoin wallets:

### Method 1: Generate Random Wallet

```typescript
// Generate a completely random wallet
const keypair = client.generatePrivateKey();

console.log('Bitcoin Addresses:');
console.log('- Legacy (P2PKH):', keypair.addresses.p2pkh);
console.log('- Nested SegWit (P2SH):', keypair.addresses.p2sh);
console.log('- Native SegWit (Bech32):', keypair.addresses.bech32);
console.log('- Taproot (Bech32m):', keypair.addresses.bech32m);
console.log('- Default Address:', keypair.address);
console.log('- WIF:', keypair.wif);
```

### Method 2: Generate from Mnemonic

```typescript
// Generate wallet with mnemonic for recovery
const mnemonicWallet = client.generateMnemonic();

console.log('Mnemonic Wallet:');
console.log('- Mnemonic:', mnemonicWallet.mnemonic);
console.log('- Address:', mnemonicWallet.address);
console.log('- WIF:', mnemonicWallet.wif);
```

### Method 3: Restore from Mnemonic

```typescript
// Restore an existing wallet from mnemonic
const restoredWallet = client.privateKeyFromMnemonic(
  'your twelve word mnemonic phrase goes here like this example',
  0 // account index
);

console.log('Restored wallet address:', restoredWallet.address);
```

### Method 4: Import from WIF or Private Key

```typescript
// Import from Wallet Import Format (WIF)
const wifWallet = client.addressFromWif('your-wif-string-here');

// Import from private key hex
const privateKeyWallet = client.publicFromPrivate('your-private-key-hex');
```

### Method 5: Email-Based Wallet (Cross-Platform)

For cross-platform compatibility with web wallets:

```typescript
// Generate deterministic wallet from email/password
const emailWallet = client.generateEmailKeypair(
  'user@example.com',
  'secure-password',
  0 // index
);

console.log('Email-based wallet:', emailWallet.address);
```

## Step 3: Check Account Information

Get detailed information about any Bitcoin address:

```typescript
async function getAccountInfo(address: string) {
  try {
    const info = await client.getAddressInfo(address);

    console.log('Account Information:');
    console.log('- Balance:', info.balance, 'satoshis');
    console.log('- Balance (BTC):', info.balance / 100000000, 'BTC');
    console.log('- Total Received:', info.totalRecieved, 'satoshis');
    console.log('- Total Sent:', info.totalSent, 'satoshis');
    console.log('- Transaction Count:', info.txCount);

    return info;
  } catch (error) {
    console.error('Error fetching account info:', error.message);
  }
}

// Check your wallet balance
const wallet = client.generatePrivateKey();
await getAccountInfo(wallet.address);
```

## Step 4: Get Transaction History

Retrieve transaction history for any address:

```typescript
async function getTransactionHistory(address: string) {
  try {
    const transactions = await client.getTransactions(address);

    console.log(`Found ${transactions.length} transactions:`);

    transactions.forEach((tx, index) => {
      console.log(`\nTransaction ${index + 1}:`);
      console.log('- TX ID:', tx.txid);
      console.log('- Confirmed:', tx.status.confirmed);
      console.log('- Block Height:', tx.status.block_height);
      console.log('- Fee:', tx.fee, 'satoshis');
      console.log('- Size:', tx.size, 'bytes');
    });

    return transactions;
  } catch (error) {
    console.error('Error fetching transactions:', error.message);
  }
}

await getTransactionHistory(wallet.address);
```

## Step 5: Check Current Fee Rates

Before sending transactions, check current network fee rates:

```typescript
async function getCurrentFees() {
  try {
    const fees = await client.getFeeRates();

    if (fees) {
      console.log('Current Fee Rates (sat/vB):');
      console.log('- Fastest (next block):', fees.fastestFee);
      console.log('- Half hour:', fees.halfHourFee);
      console.log('- One hour:', fees.hourFee);
      console.log('- Economy:', fees.economyFee);
      console.log('- Minimum:', fees.minimumFee);
    }

    return fees;
  } catch (error) {
    console.error('Error fetching fees:', error.message);
  }
}

await getCurrentFees();
```

## Step 6: Send Bitcoin Transactions

### Simple Send (Recommended)

The easiest way to send Bitcoin:

```typescript
async function sendBitcoin(senderWif: string, recipientAddress: string, amountSats: number) {
  try {
    console.log(`Sending ${amountSats} satoshis to ${recipientAddress}`);

    // This method handles transaction creation and broadcasting
    const txId = await client.sendBtc(
      senderWif,
      recipientAddress,
      amountSats,
      20 // fee rate in sat/vB (optional)
    );

    console.log('Transaction sent successfully!');
    console.log('Transaction ID:', txId);

    return txId;
  } catch (error) {
    console.error('Transaction failed:', error.message);
  }
}

// Send 50,000 satoshis (0.0005 BTC)
const wallet = client.generatePrivateKey();
await sendBitcoin(
  wallet.wif,
  'recipient-bitcoin-address',
  50000
);
```

### Advanced Send (Manual Control)

For more control over the transaction process:

```typescript
async function advancedSend(senderWif: string, recipientAddress: string, amountSats: number) {
  try {
    // Step 1: Create the transaction
    const createResult = await client.createTransaction(
      senderWif,
      recipientAddress,
      amountSats,
      15 // custom fee rate
    );

    if (!createResult.success) {
      console.error('Failed to create transaction:', createResult.error);
      return;
    }

    console.log('Transaction created successfully');
    console.log('Raw transaction:', createResult.result);

    // Step 2: Broadcast the transaction
    const broadcastResult = await client.broadcastTransaction(createResult.result!);

    if (!broadcastResult.success) {
      console.error('Failed to broadcast transaction:', broadcastResult.error);
      return;
    }

    console.log('Transaction broadcast successfully');
    console.log('Transaction ID:', broadcastResult.result);

    return broadcastResult.result;
  } catch (error) {
    console.error('Advanced send failed:', error.message);
  }
}
```

## Step 7: Message Signing

Sign and verify Bitcoin messages:

```typescript
function signMessage(message: string, wallet: any) {
  try {
    // Sign with WIF
    const signature = client.getSignatureFromWif(message, wallet.wif);
    console.log('Message signature:', signature);

    // Alternative: Sign with private key
    // const signature2 = client.getSignature(message, wallet.privateKey);

    return signature;
  } catch (error) {
    console.error('Signing failed:', error.message);
  }
}

const wallet = client.generatePrivateKey();
const signature = signMessage('Hello, Bitcoin!', wallet);
```

## Complete Example: Bitcoin Wallet Manager

Here's a comprehensive Bitcoin wallet manager:

```typescript
import { btc } from 'vfx-web-sdk';

class BitcoinWalletManager {
  private client: btc.BtcClient;

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.client = new btc.BtcClient(network);
  }

  // Create new wallet
  createWallet() {
    return this.client.generateMnemonic();
  }

  // Restore wallet from mnemonic
  restoreWallet(mnemonic: string, index: number = 0) {
    return this.client.privateKeyFromMnemonic(mnemonic, index);
  }

  // Import wallet from WIF
  importWallet(wif: string) {
    return this.client.addressFromWif(wif);
  }

  // Get wallet balance and info
  async getWalletInfo(address: string) {
    const [accountInfo, transactions] = await Promise.all([
      this.client.getAddressInfo(address),
      this.client.getTransactions(address)
    ]);

    return {
      balance: accountInfo.balance,
      balanceBTC: accountInfo.balance / 100000000,
      totalReceived: accountInfo.totalRecieved,
      totalSent: accountInfo.totalSent,
      transactionCount: accountInfo.txCount,
      recentTransactions: transactions.slice(0, 5) // Last 5 transactions
    };
  }

  // Send Bitcoin
  async sendBitcoin(fromWif: string, toAddress: string, amountSats: number, feeRate?: number) {
    return await this.client.sendBtc(fromWif, toAddress, amountSats, feeRate);
  }

  // Get current network fees
  async getNetworkFees() {
    return await this.client.getFeeRates();
  }

  // Sign a message
  signMessage(message: string, wif: string) {
    return this.client.getSignatureFromWif(message, wif);
  }
}

// Usage example
async function main() {
  const walletManager = new BitcoinWalletManager('testnet');

  // Create a new wallet
  const wallet = walletManager.createWallet();
  console.log('New Bitcoin wallet created:');
  console.log('Mnemonic:', wallet.mnemonic);
  console.log('Address:', wallet.address);
  console.log('All address types:', wallet.addresses);

  // Get wallet information
  try {
    const walletInfo = await walletManager.getWalletInfo(wallet.address);
    console.log('\nWallet Information:');
    console.log('Balance:', walletInfo.balanceBTC, 'BTC');
    console.log('Transactions:', walletInfo.transactionCount);
  } catch (error) {
    console.log('New wallet - no transactions yet');
  }

  // Check network fees
  const fees = await walletManager.getNetworkFees();
  if (fees) {
    console.log('\nCurrent Network Fees:');
    console.log('Fast:', fees.fastestFee, 'sat/vB');
    console.log('Standard:', fees.hourFee, 'sat/vB');
    console.log('Economy:', fees.economyFee, 'sat/vB');
  }

  // Sign a message
  const message = 'Hello from VerifiedX SDK!';
  const signature = walletManager.signMessage(message, wallet.wif);
  console.log('\nMessage Signature:');
  console.log('Message:', message);
  console.log('Signature:', signature);
}

main().catch(console.error);
```

## Address Types Explained

The SDK generates multiple address types for maximum compatibility:

### Legacy (P2PKH) - addresses start with '1'
- Oldest address format
- Highest fees
- Maximum compatibility

### Nested SegWit (P2SH) - addresses start with '3'
- Medium fees
- Good compatibility
- Wrapped SegWit transactions

### Native SegWit (Bech32) - addresses start with 'bc1' (mainnet) or 'tb1' (testnet)
- Lower fees
- Modern standard
- Best for most use cases

### Taproot (Bech32m) - addresses start with 'bc1p' (mainnet) or 'tb1p' (testnet)
- Lowest fees
- Latest Bitcoin upgrade
- Advanced privacy features

## Best Practices

### Security
- **Secure WIF storage**: WIF keys provide full access to funds
- **Use strong passwords**: For email-based wallets
- **Test on testnet first**: Always test with testnet Bitcoin

### Performance
- **Cache fee rates**: Don't fetch fees for every transaction
- **Batch operations**: Group multiple API calls when possible
- **Handle rate limits**: Mempool.space has API rate limits

### Error Handling
- **Check balances**: Ensure sufficient balance before sending
- **Validate addresses**: Verify recipient addresses
- **Monitor confirmations**: Track transaction confirmations

## What's Next?

Now that you understand Bitcoin basics:

1. **Learn Cross-Chain**: Explore [Cross-Chain Integration](./cross-chain.md)
2. **Build Applications**: Check out [Complete Applications](../examples/applications.md)
3. **API Reference**: Browse the [BtcClient API](../api/btc-client.md)

## Common Issues

### Insufficient Balance
Make sure your wallet has enough Bitcoin. On testnet, use a Bitcoin testnet faucet.

### Transaction Fee Too Low
Increase the fee rate if transactions are stuck in mempool.

### Invalid Address Format
Ensure you're using the correct address format for the recipient's wallet.

### Network Connection Issues
Check internet connection and try again. The SDK automatically retries failed requests.

## Getting Help

- Check the [BtcClient API Reference](../api/btc-client.md)
- Browse [Bitcoin Examples](../examples/snippets.md)
- Report issues on [GitHub](https://github.com/VerifiedXBlockchain/VerifiedX-WebSdk/issues)