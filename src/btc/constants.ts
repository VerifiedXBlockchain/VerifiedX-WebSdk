export const BTC_TO_SATOSHI_MULTIPLIER = 100000000;
export const SATOSHI_TO_BTC_MULTIPLIER = 0.00000001;

// Esplora REST bases (mempool.space-compatible), including /api. The
// VerifiedX testnet runs on a private Bitcoin signet; signet uses testnet
// address formats, so bitcoin.networks.testnet still applies.
export const MAINNET_API_BASE_URL = 'https://mempool.space/api';
export const TESTNET_API_BASE_URL = 'https://signet.verifiedx.io/api';

export const defaultApiBaseUrl = (isTestnet: boolean): string =>
  isTestnet ? TESTNET_API_BASE_URL : MAINNET_API_BASE_URL;
