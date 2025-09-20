// Browser-compatible exports with global window object support
import { VfxClient, Network, TxType } from './index';
import type { Keypair, VfxAddress, Transaction, PaginatedResponse } from './index';

// Export for module bundlers
export { VfxClient, Network, TxType };
export type { Keypair, VfxAddress, Transaction, PaginatedResponse };

// Default export for better bundler compatibility
export default VfxClient;

// Export to global window object for browser usage
declare global {
  interface Window {
    vfx: {
      VfxClient: typeof VfxClient;
      Network: typeof Network;
      TxType: typeof TxType;
    };
  }
}

// Attach to window if in browser environment
if (typeof window !== 'undefined') {
  window.vfx = {
    VfxClient,
    Network,
    TxType,
  };
}