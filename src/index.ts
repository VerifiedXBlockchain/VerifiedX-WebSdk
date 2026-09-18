import { VfxClient } from './client/vfx-client';

// Export main VFX client
export { VfxClient };
export type { VfxClientOptions, ReserveSendOptions } from './client/vfx-client';

// Export API error type + media client
export { VfxApiError } from './client/base-api-client';
export { VbtcWithdrawalIncompleteError, VbtcWithdrawalUnrecordedError } from './client/vfx-client';
export { TransactionDispatchError } from './services/raw-transaction-service';
export { MediaApiClient } from './client/media-api-client';

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
  VbtcTransfer,
  CreateVbtcResult,
  VbtcTransferResult,
  VbtcWithdrawalResult,
  VbtcCancelResult,
  VbtcProgressPhase,
  VbtcProgressEvent,
  FungibleToken,
  FungibleTokenDetail,
  FungibleTokenBalance,
  TokenVotingTopic,
  TokenImage,
  DeployTokenParams,
  DeployTokenResult,
  ReserveKeypair,
} from './types';

// External signing (HSM / MPC)
export type { Signer, KeypairOrSigner } from './signer';
export { vfxSignatureFromDer } from './signer';
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
