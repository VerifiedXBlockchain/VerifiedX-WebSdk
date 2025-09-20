// Browser-compatible btc namespace that extends the original functionality
import OriginalBtcClient from '../btc/client';
import { BTC_TO_SATOSHI_MULTIPLIER, SATOSHI_TO_BTC_MULTIPLIER } from '../btc/constants';

// Re-export constants
export { BTC_TO_SATOSHI_MULTIPLIER, SATOSHI_TO_BTC_MULTIPLIER };

// Re-export types
export * from '../btc/types';

// For browser compatibility, try to import networks with fallback
let networks;
try {
  networks = require('bitcoinjs-lib').networks;
} catch {
  // Fallback for browser environments where bitcoinjs-lib might not work
  networks = {
    bitcoin: { name: 'bitcoin' },
    testnet: { name: 'testnet' },
    regtest: { name: 'regtest' }
  };
}
export { networks };

// Re-export utility functions (these should work in browser as they don't use Node-specific APIs)
export {
  publicKeyToAddress,
  wifToPrivateKey,
  seedToPrivateKey,
  hashSeed
} from '../btc/utils';

// Browser-compatible BTC client that extends the original
export class BrowserBtcClient extends OriginalBtcClient {
  constructor(network: "mainnet" | "testnet" = "mainnet", dryRun = false) {
    super(network, dryRun);
  }

  // All methods are inherited from the original BtcClient
  // Only override if specific browser-compatibility issues arise
}

// Re-export other services (they should work in browser environments)
export { default as KeypairService } from '../btc/keypair';
export { default as TransactionService } from '../btc/transaction';
export { default as AccountService } from '../btc/account';

// Export the browser-compatible client as both named and default export
export { BrowserBtcClient as BtcClient };
export default BrowserBtcClient;