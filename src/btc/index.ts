import KeypairService from './keypair';
import TransactionService from './transaction';
import AccountService from './account';
import BtcClient from './client';

// Export all types
export * from './types';

// Re-export commonly used bitcoinjs-lib types and networks
export type { Network } from 'bitcoinjs-lib';
export { networks } from 'bitcoinjs-lib';

// Export constants
export { BTC_TO_SATOSHI_MULTIPLIER, SATOSHI_TO_BTC_MULTIPLIER } from './constants';

// Export utility functions
export {
  publicKeyToAddress,
  wifToPrivateKey,
  seedToPrivateKey,
  hashSeed,
  regtestUtils
} from './utils';

// Export service classes
export { KeypairService, TransactionService, AccountService, BtcClient };

// Default export - the main client
export default BtcClient;