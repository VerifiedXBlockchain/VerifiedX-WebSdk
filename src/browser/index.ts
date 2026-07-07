// Browser-compatible exports with polyfills included
import { VfxClient as OriginalVfxClient, VfxClientOptions } from '../client/vfx-client';
import { BrowserKeypairService } from './services/keypair-service';
import { Network, TxType } from '../constants';

export type { VfxClientOptions } from '../client/vfx-client';
export { VfxApiError } from '../client/base-api-client';

// Re-export common interfaces and types from main package
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
} from '../types';

// Export browser-compatible BTC namespace
export * as btc from './btc';

// Browser-compatible VfxClient that extends the original.
// Key generation, derivation and signing are inherited from the canonical
// VfxClient — its crypto stack bundles for browsers and is byte-identical to
// Node/CLI/web-wallet output (see BrowserKeypairService for details).
export class BrowserVfxClient extends OriginalVfxClient {
  private browserKeypairService: BrowserKeypairService;

  constructor(network: Network, dryRunOrOptions: boolean | VfxClientOptions = false) {
    super(network, dryRunOrOptions);
    this.browserKeypairService = new BrowserKeypairService(network);
  }

  /**
   * BIP32 m/0'/0'/index' — identical to privateKeyFromMneumonic and to the
   * Node/CLI/web-wallet derivation. Before v3.1.0 this browser-only method
   * used an incompatible derivation; see privateKeyFromMnemonicLegacyBrowser
   * to recover funds from addresses created with it.
   */
  public privateKeyFromMnemonic = (mnemonic: string, index: number): string => {
    return this.browserKeypairService.privateKeyFromMnemonic(mnemonic, index);
  };

  /** Pre-v3.1.0 browser-only mnemonic derivation, kept for fund recovery. */
  public privateKeyFromMnemonicLegacyBrowser = (mnemonic: string, index: number): string => {
    return this.browserKeypairService.privateKeyFromMnemonicLegacyBrowser(mnemonic, index);
  };

  // All other methods (getAddressDetails, transactions, etc.) are inherited from OriginalVfxClient
}

// Create a factory function that matches the original API
export function VfxClient(network: Network, dryRunOrOptions: boolean | VfxClientOptions = false): BrowserVfxClient {
  return new BrowserVfxClient(network, dryRunOrOptions);
}

// Export constants
export { Network, TxType };

// Default export for better bundler compatibility
export default VfxClient;

// Export individual classes for advanced usage
export { BrowserKeypairService };

// Export for global window object (for script tag usage)
declare global {
  interface Window {
    VfxWebSDK: {
      VfxClient: typeof VfxClient;
      Network: typeof Network;
      TxType: typeof TxType;
    };
  }
}

// Attach to window if in browser environment
if (typeof window !== 'undefined') {
  window.VfxWebSDK = {
    VfxClient,
    Network,
    TxType,
  };
}