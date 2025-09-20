# VerifiedX Web SDK Documentation

Welcome to the VerifiedX Web SDK documentation. This SDK provides a unified interface for interacting with both the VerifiedX blockchain and Bitcoin network, enabling powerful cross-chain applications.

## What is VerifiedX?

VerifiedX is a blockchain platform that operates as both a standalone Layer 1 network and a Bitcoin sidechain. This dual nature allows developers to:

- Build native VFX applications with full blockchain functionality
- Create Bitcoin-compatible applications that leverage VerifiedX's enhanced features
- Develop cross-chain solutions that bridge VFX and Bitcoin ecosystems

## SDK Overview

The VerifiedX Web SDK is designed with simplicity and power in mind:

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

// VerifiedX operations
const vfxClient = new VfxClient(Network.Testnet);

// Bitcoin operations
const btcClient = new btc.BtcClient('testnet');
```

## Key Features

### Dual Blockchain Support
- **Native VFX Operations**: Full support for VerifiedX blockchain transactions, domain management, and address operations
- **Bitcoin Integration**: Complete Bitcoin functionality including wallet management, transactions, and mempool interaction
- **Cross-Chain Compatibility**: Seamless integration between VFX and Bitcoin operations

### Developer Experience
- **TypeScript First**: Full type safety with comprehensive definitions
- **Universal Compatibility**: Works in Node.js, browsers, and modern bundlers
- **Multiple Build Targets**: CommonJS, ES Modules, and browser-ready bundles
- **Consistent API**: Similar patterns across VFX and Bitcoin operations

### Enterprise Ready
- **Production Tested**: Battle-tested in real-world applications
- **Comprehensive Testing**: Full test coverage for all major functionality
- **Professional Support**: Active maintenance and community support

## Quick Start

### Installation

```bash
npm install vfx-web-sdk
```

### Basic Usage

```typescript
import { VfxClient, btc, Network } from 'vfx-web-sdk';

async function quickStart() {
  // Initialize clients
  const vfxClient = new VfxClient(Network.Testnet);
  const btcClient = new btc.BtcClient('testnet');

  // Generate VFX wallet
  const vfxPrivateKey = vfxClient.generatePrivateKey();
  const vfxAddress = vfxClient.addressFromPrivate(vfxPrivateKey);

  // Generate Bitcoin wallet
  const btcKeypair = btcClient.generatePrivateKey();

  console.log('VFX Address:', vfxAddress);
  console.log('BTC Address:', btcKeypair.address);
}
```

## Documentation Structure

This documentation is organized into several sections:

### Getting Started
- [VFX Basics](./getting-started/vfx-basics.md) - Learn VerifiedX fundamentals
- [Bitcoin Basics](./getting-started/bitcoin-basics.md) - Bitcoin operations with the SDK
- [Cross-Chain Guide](./getting-started/cross-chain.md) - Building cross-chain applications

### API Reference
- [VfxClient API](./api/vfx-client.md) - Complete VFX client documentation
- [BtcClient API](./api/btc-client.md) - Complete Bitcoin client documentation
- [Types & Interfaces](./api/types.md) - TypeScript definitions


### Examples
- [Complete Applications](./examples/applications.md)
- [Code Snippets](./examples/snippets.md)

## Community and Support

- **GitHub**: [VerifiedX WebSDK Repository](https://github.com/VerifiedXBlockchain/VerifiedX-WebSdk)
- **Issues**: Report bugs and request features
- **Discussions**: Join the community discussions

## Next Steps

Ready to start building? Choose your path:

1. **New to VerifiedX?** Start with [VFX Basics](./getting-started/vfx-basics.md)
2. **Bitcoin Developer?** Jump to [Bitcoin Basics](./getting-started/bitcoin-basics.md)
3. **Building Cross-Chain?** Explore [Cross-Chain Guide](./getting-started/cross-chain.md)
4. **Need Examples?** Browse [Complete Applications](./examples/applications.md)

Let's build the future of cross-chain applications together!