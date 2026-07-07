import { VfxClient } from './client/vfx-client';

// Export main VFX client
export { VfxClient };
export type { VfxClientOptions } from './client/vfx-client';

// Export API error type + media client
export { VfxApiError } from './client/base-api-client';
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
} from './types';

// Export BTC namespace
export * as btc from './btc';

// Default export for better bundler compatibility
export default VfxClient;

// Export as namespaces for better compatibility
export const vfx = {
  VfxClient,
};
