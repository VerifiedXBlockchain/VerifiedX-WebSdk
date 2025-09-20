// Browser-compatible exports with polyfills included
import { VfxClient as OriginalVfxClient } from '../client/vfx-client';
import { BrowserKeypairService } from './services/keypair-service';
import { Network, TxType } from '../constants';

// Re-export common interfaces and types from main package
export type { Keypair, VfxAddress, Transaction, PaginatedResponse } from '../types';

// Export browser-compatible BTC namespace
export * as btc from './btc';

// Browser-compatible VfxClient that extends the original
export class BrowserVfxClient extends OriginalVfxClient {
  private browserKeypairService: BrowserKeypairService;

  constructor(network: Network) {
    super(network);
    this.browserKeypairService = new BrowserKeypairService(network);
  }

  // Override only the crypto-related methods with browser-compatible versions
  public generatePrivateKey = (): string => {
    return this.browserKeypairService.generatePrivateKey();
  };

  public generateMnemonic = (words: 12 | 24 = 12): string => {
    return this.browserKeypairService.generateMnemonic(words);
  };

  public privateKeyFromMnemonic = (mnemonic: string, index: number): string => {
    return this.browserKeypairService.privateKeyFromMnemonic(mnemonic, index);
  };

  public publicFromPrivate = (privateKey: string): string => {
    return this.browserKeypairService.publicFromPrivate(privateKey);
  };

  public addressFromPrivate = (privateKey: string): string => {
    return this.browserKeypairService.addressFromPrivate(privateKey);
  };

  public getSignature = (message: string, privateKeyHex: string): string => {
    return this.browserKeypairService.getSignature(message, privateKeyHex);
  };

  // All other methods (getAddressDetails, transactions, etc.) are inherited from OriginalVfxClient
}

// Create a factory function that matches the original API
export function VfxClient(network: Network): BrowserVfxClient {
  return new BrowserVfxClient(network);
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