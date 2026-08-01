import { RawTransactionService } from '../services/raw-transaction-service';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { Keypair } from '../types';
import { installFetch, textResponse, CapturedCall } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair: Keypair = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};

function installPipeline(overrides: Record<string, (url: string, init?: RequestInit) => unknown> = {}): {
  calls: CapturedCall[];
} {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/fee/': () => ({ Result: 'Success', Fee: 0.00025 }),
    '/raw/hash/': () => ({ Result: 'Success', Hash: 'TX_HASH_ABC' }),
    '/raw/validate-signature/': () => textResponse('true'),
    '/raw/verify/': () => ({ Result: 'Success' }),
    '/raw/send/': () => ({ Result: 'Success' }),
    ...overrides,
  });
}

function buildService(): RawTransactionService {
  return new RawTransactionService({
    network: Network.Testnet,
    keypair,
    toAddress: 'xRecipient00000000000000000000000',
    amount: 1.5,
  });
}

// process() reports failures via console.error before returning null (the
// only diagnostics its null-contract allows). Capture it so intentional
// failure-path tests stay silent — and assert on it, since that logging IS
// part of the observable behavior.
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.resetAllMocks();
});

describe('RawTransactionService.process', () => {
  test('drives the full pipeline and returns the transaction hash', async () => {
    const { calls } = installPipeline();
    const hash = await buildService().process();

    expect(hash).toBe('TX_HASH_ABC');
    const paths = calls.map((c) => c.url.split('/api')[1]);
    expect(paths[0]).toContain('/raw/timestamp/');
    expect(paths[1]).toContain(`/raw/nonce/${keypair.address}/`);
    expect(paths[2]).toContain('/raw/fee/');
    expect(paths[3]).toContain('/raw/hash/');
    expect(paths[4]).toContain('/raw/validate-signature/');
    expect(paths[5]).toContain('/raw/verify/');
    expect(paths[6]).toContain('/raw/send/');

    // The verify + send payloads carry the fetched values and the signature.
    const sendTx = (calls[6].body as { transaction: Record<string, unknown> }).transaction;
    expect(sendTx.Hash).toBe('TX_HASH_ABC');
    expect(sendTx.Nonce).toBe(7);
    expect(sendTx.Timestamp).toBe(1700000000);
    expect(sendTx.Fee).toBe(0.00025);
    expect(sendTx.FromAddress).toBe(keypair.address);
    expect(typeof sendTx.Signature).toBe('string');
    expect((sendTx.Signature as string).length).toBeGreaterThan(0);
  });

  test('dryRun stops before send and returns the hash', async () => {
    const { calls } = installPipeline();
    const hash = await buildService().process(true);

    expect(hash).toBe('TX_HASH_ABC');
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });

  test('returns null and logs when the node rejects the signature', async () => {
    installPipeline({ '/raw/validate-signature/': () => textResponse('false') });
    expect(await buildService().process()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('process()'),
      expect.objectContaining({ message: 'Invalid Signature' }),
    );
  });

  test('returns null and logs when transaction verification fails', async () => {
    installPipeline({ '/raw/verify/': () => ({ Result: 'Failure', Message: 'bad tx' }) });
    expect(await buildService().process()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('process()'),
      expect.objectContaining({ message: 'Invalid Transaction' }),
    );
  });

  test('returns null and logs when send fails', async () => {
    installPipeline({ '/raw/send/': () => ({ Result: 'Failure' }) });
    expect(await buildService().process()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('process()'),
      expect.objectContaining({ message: 'Transaction failed to send' }),
    );
  });
});

describe('RawTransactionService.process — dispatch ambiguity', () => {
  test('a lost response after dispatch throws rather than reporting a clean failure', async () => {
    installPipeline({
      // The request went out; the reply never came back. The node may well
      // have accepted it.
      '/raw/send/': () => {
        throw new Error('socket hang up');
      },
    });

    const service = buildService();
    await expect(service.process()).rejects.toMatchObject({
      name: 'TransactionDispatchError',
      hash: 'TX_HASH_ABC',
    });
    await expect(buildService().process()).rejects.toThrow(/check the chain for this hash before resending/);
  });

  test('failures before dispatch still return null, since nothing was sent', async () => {
    installPipeline({
      '/raw/validate-signature/': () => textResponse('false'),
    });

    expect(await buildService().process()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('process()'),
      expect.objectContaining({ message: 'Invalid Signature' }),
    );
  });

  test('an explicit node-side rejection still returns null', async () => {
    installPipeline({
      '/raw/send/': () => ({ Result: 'Failure' }),
    });

    expect(await buildService().process()).toBeNull();
  });
});
