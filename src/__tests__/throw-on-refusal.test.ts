import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import { Network } from '../constants';
import { HashableTransaction, transactionHash } from '../services/transaction-hash';
import { installFetch, textResponse } from './helpers/mock-fetch';

const service = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair = {
  privateKey,
  publicKey: service.publicFromPrivate(privateKey),
  address: service.addressFromPrivate(privateKey),
};
const RECIPIENT = 'xRecipient00000000000000000000000';

function install(verify: unknown, send: unknown) {
  return installFetch({
    '/raw/timestamp/': () => textResponse('1700000000'),
    '/raw/nonce/': () => textResponse('7'),
    '/raw/hash/': (_u: string, init?: RequestInit) => ({
      Result: 'Success',
      Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
    }),
    '/raw/verify/': () => verify,
    '/raw/send/': () => send,
    '/tokens/': () => ({}),
  });
}

let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('throwOnRefusal on sends', () => {
  const refusedAtVerify = {
    Result: 'Fail',
    Message: 'The balance of this account is less than the amount being sent.',
  };

  test('default unchanged: a refusal resolves to null', async () => {
    install(refusedAtVerify, { Result: 'Success' });
    expect(await new VfxClient('testnet').sendCoin(keypair, RECIPIENT, 1)).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  test('sendCoin({ throwOnRefusal: true }) throws TransactionRefusedError with the reason', async () => {
    install(refusedAtVerify, { Result: 'Success' });
    await expect(
      new VfxClient('testnet').sendCoin(keypair, RECIPIENT, 1, { throwOnRefusal: true }),
    ).rejects.toMatchObject({ name: 'TransactionRefusedError', reason: refusedAtVerify.Message });
  });

  test('the client option covers every send; a per-call false turns it off for one call', async () => {
    install(refusedAtVerify, { Result: 'Success' });
    const client = new VfxClient('testnet', { throwOnRefusal: true });
    await expect(client.sendCoin(keypair, RECIPIENT, 1)).rejects.toMatchObject({ name: 'TransactionRefusedError' });
    // Another high-level send, with no per-call option: the client's applies.
    await expect(client.deleteBtcDomain(keypair, { btcFromAddress: 'tb1qsomething' })).rejects.toMatchObject({
      name: 'TransactionRefusedError',
      reason: refusedAtVerify.Message,
    });
    expect(await client.sendCoin(keypair, RECIPIENT, 1, { throwOnRefusal: false })).toBeNull();
  });

  test("a refusal at the send itself ('local' mode skips verify) carries the node's message", async () => {
    install({ Result: 'Success' }, { Result: 'Fail', Message: 'Transaction was not verified.' });
    const client = new VfxClient('testnet', { hashMode: 'local' });
    await expect(client.sendCoin(keypair, RECIPIENT, 1, { throwOnRefusal: true })).rejects.toMatchObject({
      name: 'TransactionRefusedError',
      reason: 'Transaction was not verified.',
    });
    expect(await client.sendCoin(keypair, RECIPIENT, 1)).toBeNull();
    expect(consoleError).toHaveBeenLastCalledWith(
      expect.stringContaining('process()'),
      expect.objectContaining({ message: 'Transaction failed to send: Transaction was not verified.' }),
    );
  });
});
