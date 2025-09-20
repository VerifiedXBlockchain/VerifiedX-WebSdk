// Browser-compatible btc namespace that extends the original functionality
import OriginalBtcClient from '../btc/client';
import { BTC_TO_SATOSHI_MULTIPLIER, SATOSHI_TO_BTC_MULTIPLIER } from '../btc/constants';

// Re-export constants
export { BTC_TO_SATOSHI_MULTIPLIER, SATOSHI_TO_BTC_MULTIPLIER };

// Re-export types
export * from '../btc/types';

// For browser compatibility, use fallback networks
// (bitcoinjs-lib networks may not work in all browser environments)
export const networks = {
  bitcoin: { name: 'bitcoin' },
  testnet: { name: 'testnet' },
  regtest: { name: 'regtest' }
};

// Note: BTC utility functions contain Node.js Buffer dependencies
// For full BTC functionality in browser, use the script tag version or
// implement browser-compatible versions of these utilities
// export { publicKeyToAddress, wifToPrivateKey, seedToPrivateKey, hashSeed } from '../btc/utils';

// Browser-compatible BTC client that extends the original
export class BrowserBtcClient extends OriginalBtcClient {
  constructor(network: "mainnet" | "testnet" = "mainnet", dryRun = false) {
    super(network, dryRun);
  }

  // All methods are inherited from the original BtcClient
  // Only override if specific browser-compatibility issues arise
}

// Note: BTC services contain Node.js dependencies (Buffer, bitcoinjs-lib)
// For full BTC functionality in browser, use the IIFE build (lib/browser.js)
// which includes all necessary polyfills
// export { default as KeypairService } from '../btc/keypair';
// export { default as TransactionService } from '../btc/transaction';
// export { default as AccountService } from '../btc/account';

// Export the browser-compatible client as both named and default export
export { BrowserBtcClient as BtcClient };
export default BrowserBtcClient;