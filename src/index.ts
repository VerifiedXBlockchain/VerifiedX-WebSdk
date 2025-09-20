import { VfxClient } from './client/vfx-client';

// Export main client
export { VfxClient };

// Export enums
export { Network, TxType } from './constants';

// Export types
export type {
  Keypair,
  VfxAddress,
  Transaction,
  PaginatedResponse
} from './types';

// Default export for better bundler compatibility
export default VfxClient;

// Also export as a namespace for better compatibility
export const vfx = {
  VfxClient,
};
