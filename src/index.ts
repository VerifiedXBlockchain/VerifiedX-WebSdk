import { VfxClient } from './client/vfx-client';

// Export main VFX client
export { VfxClient };
export type { VfxClientOptions, ReserveSendOptions, SendCoinOptions, RefusalOptions } from './client/vfx-client';

// Export API error type + media client
export { VfxApiError, VfxNetworkError } from './client/base-api-client';
export {
  VbtcWithdrawalIncompleteError,
  VbtcWithdrawalUnrecordedError,
  VbtcNodeUnreachableError,
  VbtcWithdrawalClosedError,
  VbtcFrostJobNotFoundError,
  VbtcWithdrawalAlreadySignedError,
} from './client/vfx-client';
export { frostResumeActionFor } from './services/frost-resume';
export type { FrostResumeAction } from './services/frost-resume';
export { parseWatchedWithdrawal, VBTC_WATCHED_MAX_FEE_RATE } from './services/watched-withdrawal';
export {
  btcNameAcceptanceMessage,
  buildBtcNameAcceptanceCode,
  parseBtcNameAcceptanceCode,
  BTC_NAME_ACCEPTANCE_MAX_AGE_SECONDS,
} from './services/btc-name-acceptance';
export {
  BTC_NAME_SIGNED_MESSAGE_HEIGHT_MAINNET,
  BTC_NAME_SIGNED_MESSAGE_HEIGHT_TESTNET,
  btcNameSignedMessageHeight,
  btcNameSignedMessagesActive,
} from './constants';
export type { BtcNameAcceptance } from './services/btc-name-acceptance';
export {
  PreSignCheckError,
  TransactionDispatchError,
  TransactionRefusedError,
  SignerError,
} from './services/raw-transaction-service';
export { BtcBroadcastUnknownError } from './btc/errors';
export { MediaApiClient } from './client/media-api-client';
export type { MediaUploadResult } from './client/media-api-client';

// Export VFX enums
export { Network, TxType } from './constants';

// Export VFX types
export type {
  Keypair,
  VfxAddress,
  Transaction,
  PaginatedResponse,
  VbtcV2Token,
  VbtcWithdrawalRequest,
  VbtcWithdrawalStatus,
  VbtcTransfer,
  CreateVbtcResult,
  VbtcTransferResult,
  VbtcMultiTransferResult,
  VbtcMultiWithdrawalResult,
  VbtcWithdrawalShare,
  VbtcWithdrawalShareOutcome,
  VbtcWithdrawalSharesResult,
  VbtcWithdrawalResult,
  VbtcWatchedWithdrawal,
  VbtcWatchedWithdrawalTransaction,
  VbtcCancelResult,
  VbtcProgressPhase,
  VbtcProgressEvent,
  VbtcWithdrawalCheckpoint,
  FungibleToken,
  FungibleTokenDetail,
  FungibleTokenBalance,
  TokenVotingTopic,
  TokenImage,
  DeployTokenParams,
  DeployTokenResult,
  ReserveKeypair,
  VfxBlock,
  VaultKeypair,
  LegacyVaultSource,
  LegacyRecoveryLookup,
} from './types';
export type { CoinPrice, CoinPricePoint, PricedCoin } from './client/price-api-client';

// External signing (HSM / MPC)
export type {
  Signer,
  KeypairOrSigner,
  SigningRequest,
  SigningIntent,
  SigningBatchItem,
  SigningTransaction,
} from './signer';
export { vfxSignatureFromDer } from './signer';
export {
  CORE_TX_TYPE_NAMES,
  canHashLocally,
  coreTxTypeName,
  hashPreimage,
  transactionHash,
  transactionHashPreimage,
} from './services/transaction-hash';
export type { HashableTransaction } from './services/transaction-hash';
export { TransactionHashMismatchError, localTransactionFee } from './services/tx-build-session';
export type { HashMode } from './services/tx-build-session';
export { verifySignature } from './services/keypair-service';
export { allocateVbtcInputs, vbtcMultiTransferData, VBTC_MULTI_MAX_INPUTS } from './services/vbtc-multi';
export {
  VBTC_MULTI_WITHDRAWAL_FUNCTION,
  VBTC_MULTI_WITHDRAWAL_MAX_INPUTS,
  VBTC_WITHDRAWAL_DUST_SATS,
  assertBtcAddressOnNetwork,
  vbtcMultiWithdrawalData,
  withdrawalFeeFloorError,
} from './services/vbtc-multi-withdrawal';
export type { VbtcAllocation, VbtcAllocationInput, VbtcAllocationFailure } from './services/vbtc-multi';
export { isOtherNetworksAddress, assertRecipientOnNetwork } from './services/recipient';
// Spyglass wallet reads and the relay's block_addresses event
export { isBlockAddressesEvent, parseBlockAddressesEvent, blockAddressesTouching } from './services/socket-events';
export { ADDRESS_ACTIVITY_MAX } from './client/address-api-client';
export type {
  AddressActivity,
  AddressActivityPage,
  BlockAddressesEvent,
  DomainAvailability,
  VbtcV2ReadOptions,
  VbtcV2WalletNft,
} from './types';

export {
  canCallBackReserveTransaction,
  vaultBackupCode,
  vaultKeyFromBackupCode,
  reserveRestoreCode,
} from './services/vault-helpers';
export { vbtcContractHasNoMedia } from './services/vbtc-media';
export {
  VBTC_WITHDRAWAL_EXPIRY_BLOCKS,
  VBTC_WITHDRAWAL_STALE_AFTER_MS,
  isWithdrawalResumable,
  isWithdrawalStale,
  liveResumableWithdrawalsFor,
  resumableWithdrawalsFor,
  vbtcMultiWithdrawalMax,
  watchedWithdrawalRowState,
  withdrawalRowCanCancel,
} from './services/vbtc-withdrawal-state';
export type { WatchedWithdrawalRowState } from './services/vbtc-withdrawal-state';
// NFTs (VFX10)
export { NftBulkMintError, VaultRegistrationError } from './client/vfx-client';
export {
  nftContract,
  nftEvolveStages,
  nftCurrentStage,
  nftIsMedialess,
  nftEvolveRefusal,
} from './client/nft-api-client';
export { parseVfxShhMessage, formatVfxShhMessage, decryptVfxShh, encryptVfxShh } from './services/vfx-shh';
export type { VfxShhMessage } from './services/vfx-shh';
// Bfly's Base (EVM) account for a VFX key
export { deriveBaseKeypair } from './services/base-wallet';
export type { BaseKeypair } from './services/base-wallet';
export type { VfxNft, NftListQuery, NftEvolveStage } from './client/nft-api-client';
export {
  nftMintPayload,
  nftOwnershipProof,
  NFT_FEATURE_EVOLVE,
  NFT_FEATURE_ROYALTY,
  NFT_FEATURE_MULTI_ASSET,
} from './services/nft-data';
export type { NftAssetInput, NftMintParams, NftEvolvePhaseInput } from './services/nft-data';
// Web wallet sign-in derivation (vault and Bitcoin account texts)
export {
  btcCredentialsFromDerivationText,
  btcKeypairFromDerivationText,
  canonicalPrivateKeyHex,
  derivationTextCandidates,
  derivationTextFromKeyText,
  normalizeRecoveryPhrase,
  walletDerivationText,
} from './services/wallet-derivation';
export { VFX_API_BASE_URL_MAINNET, VFX_API_BASE_URL_TESTNET, VFX_API_BASE_URL_DEVNET } from './constants';
export {
  TOKEN_BASE_ADDRESS,
  RESERVE_BASE_ADDRESS,
  RESERVE_ACTIVATION_COST,
  RESERVE_MIN_UNLOCK_HOURS,
} from './constants';

// Export BTC namespace
export * as btc from './btc';

// Default export for better bundler compatibility
export default VfxClient;

// Export as namespaces for better compatibility
export const vfx = {
  VfxClient,
};
