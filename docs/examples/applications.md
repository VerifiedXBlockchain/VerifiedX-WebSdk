# Complete Applications

This section provides comprehensive examples of real-world applications built with the VerifiedX Web SDK. These examples demonstrate best practices, error handling, and integration patterns.

## Multi-Chain Wallet Application

A complete wallet application supporting both VFX and Bitcoin with cross-chain functionality.

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

interface WalletState {
  vfx: {
    keypair: any;
    balance: number;
    domain?: string;
  } | null;
  btc: {
    keypair: btc.BtcKeypair;
    balance: number;
  } | null;
}

class MultiChainWallet {
  private vfxClient: VfxClient;
  private btcClient: btc.BtcClient;
  private state: WalletState = { vfx: null, btc: null };

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.vfxClient = new VfxClient(
      network === 'mainnet' ? Network.Mainnet : Network.Testnet
    );
    this.btcClient = new btc.BtcClient(network);
  }

  // Create new wallet with unified mnemonic
  async createWallet(): Promise<{ mnemonic: string; addresses: { vfx: string; btc: string } }> {
    try {
      // Generate unified mnemonic
      const mnemonic = this.vfxClient.generateMnemonic(12);

      // Create VFX wallet
      const vfxPrivateKey = this.vfxClient.privateKeyFromMneumonic(mnemonic, 0);
      const vfxKeypair = {
        private: vfxPrivateKey,
        public: this.vfxClient.publicFromPrivate(vfxPrivateKey),
        address: this.vfxClient.addressFromPrivate(vfxPrivateKey)
      };

      // Create Bitcoin wallet from same mnemonic
      const btcKeypair = this.btcClient.privateKeyFromMnemonic(mnemonic, 0);

      // Update state
      this.state.vfx = {
        keypair: vfxKeypair,
        balance: 0
      };
      this.state.btc = {
        keypair: btcKeypair,
        balance: 0
      };

      // Fetch initial balances
      await this.updateBalances();

      return {
        mnemonic,
        addresses: {
          vfx: vfxKeypair.address,
          btc: btcKeypair.address
        }
      };
    } catch (error) {
      throw new Error(`Failed to create wallet: ${error.message}`);
    }
  }

  // Restore wallet from mnemonic
  async restoreWallet(mnemonic: string): Promise<{ addresses: { vfx: string; btc: string } }> {
    try {
      // Restore VFX wallet
      const vfxPrivateKey = this.vfxClient.privateKeyFromMneumonic(mnemonic, 0);
      const vfxKeypair = {
        private: vfxPrivateKey,
        public: this.vfxClient.publicFromPrivate(vfxPrivateKey),
        address: this.vfxClient.addressFromPrivate(vfxPrivateKey)
      };

      // Restore Bitcoin wallet
      const btcKeypair = this.btcClient.privateKeyFromMnemonic(mnemonic, 0);

      // Update state
      this.state.vfx = {
        keypair: vfxKeypair,
        balance: 0
      };
      this.state.btc = {
        keypair: btcKeypair,
        balance: 0
      };

      // Fetch balances and domain info
      await this.updateBalances();

      return {
        addresses: {
          vfx: vfxKeypair.address,
          btc: btcKeypair.address
        }
      };
    } catch (error) {
      throw new Error(`Failed to restore wallet: ${error.message}`);
    }
  }

  // Update balances for both chains
  async updateBalances(): Promise<void> {
    try {
      const promises: Promise<any>[] = [];

      // Update VFX balance
      if (this.state.vfx) {
        promises.push(
          this.vfxClient.getAddressDetails(this.state.vfx.keypair.address)
            .then(details => {
              this.state.vfx!.balance = details.balance;
              this.state.vfx!.domain = details.adnr;
            })
            .catch(() => {
              this.state.vfx!.balance = 0;
            })
        );
      }

      // Update Bitcoin balance
      if (this.state.btc) {
        promises.push(
          this.btcClient.getAddressInfo(this.state.btc.keypair.address)
            .then(info => {
              this.state.btc!.balance = info.balance;
            })
            .catch(() => {
              this.state.btc!.balance = 0;
            })
        );
      }

      await Promise.allSettled(promises);
    } catch (error) {
      console.warn('Some balance updates failed:', error.message);
    }
  }

  // Send VFX transaction
  async sendVfx(toAddress: string, amount: number): Promise<string> {
    if (!this.state.vfx) {
      throw new Error('VFX wallet not initialized');
    }

    if (this.state.vfx.balance < amount) {
      throw new Error('Insufficient VFX balance');
    }

    try {
      const result = await this.vfxClient.sendCoin(
        this.state.vfx.keypair,
        toAddress,
        amount
      );

      // Update balance after transaction
      await this.updateBalances();

      return result.txHash;
    } catch (error) {
      throw new Error(`VFX transaction failed: ${error.message}`);
    }
  }

  // Send Bitcoin transaction
  async sendBtc(toAddress: string, amountSats: number, feeRate?: number): Promise<string> {
    if (!this.state.btc) {
      throw new Error('Bitcoin wallet not initialized');
    }

    if (this.state.btc.balance < amountSats) {
      throw new Error('Insufficient Bitcoin balance');
    }

    try {
      const txId = await this.btcClient.sendBtc(
        this.state.btc.keypair.wif,
        toAddress,
        amountSats,
        feeRate
      );

      // Update balance after transaction
      await this.updateBalances();

      return txId;
    } catch (error) {
      throw new Error(`Bitcoin transaction failed: ${error.message}`);
    }
  }

  // Purchase VFX domain
  async purchaseDomain(domain: string): Promise<string> {
    if (!this.state.vfx) {
      throw new Error('VFX wallet not initialized');
    }

    try {
      // Check if domain is available
      const isAvailable = await this.vfxClient.domainAvailable(domain);
      if (!isAvailable) {
        throw new Error('Domain is not available');
      }

      const result = await this.vfxClient.buyVfxDomain(
        this.state.vfx.keypair,
        domain
      );

      // Update state
      this.state.vfx.domain = domain;
      await this.updateBalances();

      return result.txHash || result.tx;
    } catch (error) {
      throw new Error(`Domain purchase failed: ${error.message}`);
    }
  }

  // Get wallet portfolio
  getPortfolio() {
    return {
      vfx: this.state.vfx ? {
        address: this.state.vfx.keypair.address,
        balance: this.state.vfx.balance,
        domain: this.state.vfx.domain
      } : null,
      btc: this.state.btc ? {
        address: this.state.btc.keypair.address,
        balance: this.state.btc.balance,
        balanceBTC: this.state.btc.balance / 100000000
      } : null
    };
  }

  // Sign messages on both chains
  signMessage(message: string): { vfx?: string; btc?: string } {
    const signatures: { vfx?: string; btc?: string } = {};

    if (this.state.vfx) {
      signatures.vfx = this.vfxClient.getSignature(
        message,
        this.state.vfx.keypair.private
      );
    }

    if (this.state.btc) {
      signatures.btc = this.btcClient.getSignatureFromWif(
        message,
        this.state.btc.keypair.wif
      );
    }

    return signatures;
  }
}
```

## Cross-Chain Payment Processor

A payment processor that accepts both VFX and Bitcoin payments.

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

interface PaymentRequest {
  id: string;
  amount: number;
  currency: 'VFX' | 'BTC';
  recipientAddress: string;
  description?: string;
  expiresAt?: Date;
}

interface PaymentResult {
  success: boolean;
  txId?: string;
  error?: string;
  confirmedAt?: Date;
}

class CrossChainPaymentProcessor {
  private vfxClient: VfxClient;
  private btcClient: btc.BtcClient;
  private payments = new Map<string, PaymentRequest>();

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.vfxClient = new VfxClient(
      network === 'mainnet' ? Network.Mainnet : Network.Testnet
    );
    this.btcClient = new btc.BtcClient(network);
  }

  // Create a payment request
  createPaymentRequest(
    amount: number,
    currency: 'VFX' | 'BTC',
    recipientAddress: string,
    description?: string,
    expirationMinutes: number = 30
  ): PaymentRequest {
    const paymentId = this.generatePaymentId();
    const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

    const payment: PaymentRequest = {
      id: paymentId,
      amount,
      currency,
      recipientAddress,
      description,
      expiresAt
    };

    this.payments.set(paymentId, payment);
    return payment;
  }

  // Process VFX payment
  async processVfxPayment(
    paymentId: string,
    senderKeypair: any
  ): Promise<PaymentResult> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return { success: false, error: 'Payment request not found' };
    }

    if (payment.currency !== 'VFX') {
      return { success: false, error: 'Invalid currency for VFX payment' };
    }

    if (payment.expiresAt && new Date() > payment.expiresAt) {
      return { success: false, error: 'Payment request expired' };
    }

    try {
      // Check sender balance
      const senderDetails = await this.vfxClient.getAddressDetails(
        senderKeypair.address
      );

      if (senderDetails.balance < payment.amount) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Send payment
      const result = await this.vfxClient.sendCoin(
        senderKeypair,
        payment.recipientAddress,
        payment.amount
      );

      return {
        success: true,
        txId: result.txHash,
        confirmedAt: new Date()
      };
    } catch (error) {
      return {
        success: false,
        error: `Transaction failed: ${error.message}`
      };
    }
  }

  // Process Bitcoin payment
  async processBtcPayment(
    paymentId: string,
    senderWif: string,
    feeRate?: number
  ): Promise<PaymentResult> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return { success: false, error: 'Payment request not found' };
    }

    if (payment.currency !== 'BTC') {
      return { success: false, error: 'Invalid currency for Bitcoin payment' };
    }

    if (payment.expiresAt && new Date() > payment.expiresAt) {
      return { success: false, error: 'Payment request expired' };
    }

    try {
      // Get sender address from WIF
      const senderKeypair = this.btcClient.addressFromWif(senderWif);

      // Check sender balance
      const senderInfo = await this.btcClient.getAddressInfo(senderKeypair.address);

      if (senderInfo.balance < payment.amount) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Send payment
      const txId = await this.btcClient.sendBtc(
        senderWif,
        payment.recipientAddress,
        payment.amount,
        feeRate
      );

      return {
        success: true,
        txId,
        confirmedAt: new Date()
      };
    } catch (error) {
      return {
        success: false,
        error: `Transaction failed: ${error.message}`
      };
    }
  }

  // Generate payment QR code data
  generatePaymentQRCode(paymentId: string): string {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new Error('Payment request not found');
    }

    if (payment.currency === 'VFX') {
      return JSON.stringify({
        type: 'VFX_PAYMENT',
        paymentId,
        amount: payment.amount,
        address: payment.recipientAddress,
        description: payment.description
      });
    } else {
      // Bitcoin payment URI format
      return `bitcoin:${payment.recipientAddress}?amount=${payment.amount / 100000000}&label=${encodeURIComponent(payment.description || 'Payment')}`;
    }
  }

  // Get payment status
  getPaymentStatus(paymentId: string): { status: string; payment?: PaymentRequest } {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return { status: 'not_found' };
    }

    if (payment.expiresAt && new Date() > payment.expiresAt) {
      return { status: 'expired', payment };
    }

    return { status: 'pending', payment };
  }

  private generatePaymentId(): string {
    return 'pay_' + Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}
```

## DeFi Portfolio Tracker

A portfolio tracker that monitors assets across VFX and Bitcoin.

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

interface Portfolio {
  vfx: {
    addresses: string[];
    totalBalance: number;
    domains: string[];
  };
  btc: {
    addresses: string[];
    totalBalance: number;
    totalBalanceBTC: number;
  };
  totalValueUSD?: number;
}

interface PriceData {
  vfx?: number;
  btc?: number;
}

class DeFiPortfolioTracker {
  private vfxClient: VfxClient;
  private btcClient: btc.BtcClient;
  private watchedAddresses = new Set<string>();

  constructor(network: 'mainnet' | 'testnet' = 'testnet') {
    this.vfxClient = new VfxClient(
      network === 'mainnet' ? Network.Mainnet : Network.Testnet
    );
    this.btcClient = new btc.BtcClient(network);
  }

  // Add addresses to track
  addVfxAddress(address: string): void {
    this.watchedAddresses.add(`vfx:${address}`);
  }

  addBtcAddress(address: string): void {
    this.watchedAddresses.add(`btc:${address}`);
  }

  // Remove addresses
  removeAddress(address: string, type: 'vfx' | 'btc'): void {
    this.watchedAddresses.delete(`${type}:${address}`);
  }

  // Get complete portfolio
  async getPortfolio(): Promise<Portfolio> {
    const vfxAddresses: string[] = [];
    const btcAddresses: string[] = [];

    // Separate addresses by type
    for (const watchedAddress of this.watchedAddresses) {
      const [type, address] = watchedAddress.split(':');
      if (type === 'vfx') {
        vfxAddresses.push(address);
      } else if (type === 'btc') {
        btcAddresses.push(address);
      }
    }

    // Fetch VFX data
    const vfxData = await this.getVfxPortfolio(vfxAddresses);

    // Fetch Bitcoin data
    const btcData = await this.getBtcPortfolio(btcAddresses);

    return {
      vfx: vfxData,
      btc: btcData
    };
  }

  // Get VFX portfolio data
  private async getVfxPortfolio(addresses: string[]): Promise<Portfolio['vfx']> {
    const promises = addresses.map(address =>
      this.vfxClient.getAddressDetails(address).catch(() => null)
    );

    const results = await Promise.all(promises);

    let totalBalance = 0;
    const domains: string[] = [];

    results.forEach(result => {
      if (result) {
        totalBalance += result.balance;
        if (result.adnr) {
          domains.push(result.adnr);
        }
      }
    });

    return {
      addresses,
      totalBalance,
      domains
    };
  }

  // Get Bitcoin portfolio data
  private async getBtcPortfolio(addresses: string[]): Promise<Portfolio['btc']> {
    const promises = addresses.map(address =>
      this.btcClient.getAddressInfo(address).catch(() => null)
    );

    const results = await Promise.all(promises);

    let totalBalance = 0;

    results.forEach(result => {
      if (result) {
        totalBalance += result.balance;
      }
    });

    return {
      addresses,
      totalBalance,
      totalBalanceBTC: totalBalance / 100000000
    };
  }

  // Get transaction history across all addresses
  async getTransactionHistory(): Promise<{
    vfx: any[];
    btc: btc.BtcTransaction[];
  }> {
    const vfxAddresses: string[] = [];
    const btcAddresses: string[] = [];

    // Separate addresses by type
    for (const watchedAddress of this.watchedAddresses) {
      const [type, address] = watchedAddress.split(':');
      if (type === 'vfx') {
        vfxAddresses.push(address);
      } else if (type === 'btc') {
        btcAddresses.push(address);
      }
    }

    // Fetch VFX transactions
    const vfxTxPromises = vfxAddresses.map(address =>
      this.vfxClient.listTransactionsForAddress(address, 1, 50)
        .catch(() => ({ data: [] }))
    );

    // Fetch Bitcoin transactions
    const btcTxPromises = btcAddresses.map(address =>
      this.btcClient.getTransactions(address).catch(() => [])
    );

    const [vfxTxResults, btcTxResults] = await Promise.all([
      Promise.all(vfxTxPromises),
      Promise.all(btcTxPromises)
    ]);

    // Flatten and sort transactions
    const vfxTransactions = vfxTxResults.flatMap(result => result.data || []);
    const btcTransactions = btcTxResults.flat();

    return {
      vfx: vfxTransactions,
      btc: btcTransactions
    };
  }

  // Calculate portfolio value in USD (requires external price feed)
  async calculatePortfolioValue(prices: PriceData): Promise<number> {
    const portfolio = await this.getPortfolio();

    let totalUSD = 0;

    if (prices.vfx) {
      totalUSD += portfolio.vfx.totalBalance * prices.vfx;
    }

    if (prices.btc) {
      totalUSD += portfolio.btc.totalBalanceBTC * prices.btc;
    }

    return totalUSD;
  }

  // Generate portfolio report
  async generateReport(): Promise<string> {
    const portfolio = await this.getPortfolio();
    const transactions = await this.getTransactionHistory();

    const report = `
# Portfolio Report

## VFX Holdings
- Addresses: ${portfolio.vfx.addresses.length}
- Total Balance: ${portfolio.vfx.totalBalance} VFX
- Domains Owned: ${portfolio.vfx.domains.join(', ') || 'None'}
- Recent Transactions: ${transactions.vfx.length}

## Bitcoin Holdings
- Addresses: ${portfolio.btc.addresses.length}
- Total Balance: ${portfolio.btc.totalBalance} satoshis
- Total Balance: ${portfolio.btc.totalBalanceBTC} BTC
- Recent Transactions: ${transactions.btc.length}

## Summary
- Total VFX: ${portfolio.vfx.totalBalance}
- Total BTC: ${portfolio.btc.totalBalanceBTC}
- Domains: ${portfolio.vfx.domains.length}

Generated at: ${new Date().toISOString()}
    `.trim();

    return report;
  }
}
```

## Usage Examples

### Using the Multi-Chain Wallet

```typescript
async function walletExample() {
  const wallet = new MultiChainWallet('testnet');

  // Create new wallet
  const newWallet = await wallet.createWallet();
  console.log('New wallet created:');
  console.log('Mnemonic:', newWallet.mnemonic);
  console.log('VFX Address:', newWallet.addresses.vfx);
  console.log('BTC Address:', newWallet.addresses.btc);

  // Check portfolio
  const portfolio = wallet.getPortfolio();
  console.log('Portfolio:', portfolio);

  // Send transactions (when you have funds)
  // await wallet.sendVfx('VFX_ADDRESS', 100);
  // await wallet.sendBtc('bc1...', 50000);
}
```

### Using the Payment Processor

```typescript
async function paymentExample() {
  const processor = new CrossChainPaymentProcessor('testnet');

  // Create payment request
  const payment = processor.createPaymentRequest(
    100, // amount
    'VFX', // currency
    'VFX_RECIPIENT_ADDRESS',
    'Product purchase'
  );

  console.log('Payment ID:', payment.id);
  console.log('QR Code data:', processor.generatePaymentQRCode(payment.id));

  // Process payment (when sender is ready)
  // const result = await processor.processVfxPayment(payment.id, senderKeypair);
}
```

### Using the Portfolio Tracker

```typescript
async function portfolioExample() {
  const tracker = new DeFiPortfolioTracker('testnet');

  // Add addresses to track
  tracker.addVfxAddress('VFX_ADDRESS_1');
  tracker.addVfxAddress('VFX_ADDRESS_2');
  tracker.addBtcAddress('bc1...');

  // Get portfolio overview
  const portfolio = await tracker.getPortfolio();
  console.log('Portfolio:', portfolio);

  // Generate report
  const report = await tracker.generateReport();
  console.log(report);
}
```

## Best Practices for Production

### Error Handling
- Always wrap async operations in try-catch blocks
- Implement retry logic for network operations
- Provide meaningful error messages to users
- Log errors for debugging but don't expose sensitive information

### Security
- Never expose private keys or mnemonics in logs
- Validate all user inputs
- Use HTTPS for all network communications
- Implement proper session management

### Performance
- Cache frequently accessed data
- Use batch operations when possible
- Implement proper loading states
- Consider pagination for large datasets

### User Experience
- Provide clear transaction status updates
- Show estimated confirmation times
- Handle network disconnections gracefully
- Implement proper loading indicators

## Next Steps

These applications demonstrate the power of the VerifiedX Web SDK for building sophisticated cross-chain applications. For more specific use cases, check out:

- [Code Snippets](./snippets.md) - Smaller, focused examples