// Browser-compatible exports with global window object support
import { VfxClient, Network, TxType, btc } from './index';
import type { Keypair, VfxAddress, Transaction, PaginatedResponse, VbtcWithdrawalResult, VbtcWithdrawRequest } from './index';

// Export for module bundlers
export { VfxClient, Network, TxType, btc };
export type { Keypair, VfxAddress, Transaction, PaginatedResponse, VbtcWithdrawalResult, VbtcWithdrawRequest };

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
    btc: typeof btc;
  }
}

// Attach to window if in browser environment
if (typeof window !== 'undefined') {
  window.vfx = {
    VfxClient,
    Network,
    TxType,
  };
  window.btc = btc;
}