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
export { publicKeyToAddress, wifToPrivateKey, seedToPrivateKey, hashSeed, regtestUtils } from './utils';

// External Bitcoin signing (extension, hardware wallet, HSM)
export { btcSignerFromWif, signBtcMessage, btcMessageDigest, isBtcSigner } from './signer';
export type { BtcSigner, BtcSigningRequest, BtcSigningIntent } from './signer';

// Export errors
export { BtcBroadcastUnknownError } from './errors';

// Export service classes
export { KeypairService, TransactionService, AccountService, BtcClient };
export type { BtcClientOptions } from './client';

// Default export - the main client
export default BtcClient;

// Address types a key can spend from
export { addressForSpendType } from './address-types';
export type { BtcSpendType, BitcoinNetworkInput } from './address-types';
