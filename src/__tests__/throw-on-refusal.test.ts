import { SignerError, VfxClient } from '../index';
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

describe('Greptile review fixes', () => {
  test('prepared vBTC sends honour the client option, keeping the prepared hash and reason', async () => {
    installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => ({ success: false, message: 'Insufficient vBTC balance' }),
    });
    await expect(
      new VfxClient('testnet', { throwOnRefusal: true }).transferVbtc({
        scIdentifier: 'sc-1',
        fromAddress: keypair.address,
        toAddress: RECIPIENT,
        amount: 1,
        privateKey,
      }),
    ).rejects.toMatchObject({
      name: 'TransactionRefusedError',
      hash: 'PREPARED_HASH',
      reason: 'Insufficient vBTC balance',
    });

    // Without the option the same refusal is the historical plain Error.
    await expect(
      new VfxClient('testnet').transferVbtc({
        scIdentifier: 'sc-1',
        fromAddress: keypair.address,
        toAddress: RECIPIENT,
        amount: 1,
        privateKey,
      }),
    ).rejects.toThrow(/transferVbtc:send failed/);
  });
});

describe('throwOnRefusal on the NFT writes', () => {
  const SC = '7a6b4c3d-0000-4000-8000-000000000001:1762600000';
  const refused = { Result: 'Fail', Message: 'You are attempting to devolve/evolve a Smart contract you dont own.' };
  const evolvingNft = {
    identifier: SC,
    minter_address: keypair.address,
    owner_address: RECIPIENT,
    is_burned: false,
    primary_asset_name: 'default',
    primary_asset_size: 0,
    smart_contract_data: JSON.stringify({
      SmartContractMain: {
        SmartContractAsset: { Name: 'default', FileSize: 0 },
        Features: [{ FeatureName: 0, FeatureFeatures: [{ EvolutionState: 1, Name: 'One', IsCurrentState: false }] }],
      },
    }),
  };

  function installNft() {
    return installFetch({
      '/raw/timestamp/': () => textResponse('1700000000'),
      '/raw/nonce/': () => textResponse('7'),
      '/raw/hash/': (_u: string, init?: RequestInit) => ({
        Result: 'Success',
        Hash: transactionHash((JSON.parse(init?.body as string) as { transaction: HashableTransaction }).transaction),
      }),
      '/raw/verify/': () => refused,
      '/raw/send/': () => ({ Result: 'Success' }),
      '/raw/smart-contract-data/': () => [{ Function: 'Mint()', ContractUID: SC, Data: 'H4sI', MD5List: 'x' }],
      '/raw/nft-transfer-data/': () => [{ Function: 'Transfer()', ContractUID: SC, ToAddress: RECIPIENT }],
      '/raw/nft-evolve-data/': () => [{ Function: 'ChangeEvolveStateSpecific()', ContractUID: SC, NewEvoState: 1 }],
      '/raw/nft-burn-data/': () => ({
        Success: true,
        Message: JSON.stringify([{ Function: 'Burn()', ContractUID: SC, FromAddress: keypair.address }]),
      }),
      [`/nft/${encodeURIComponent(SC)}/`]: () => ({ ...evolvingNft, owner_address: keypair.address }),
    });
  }

  const mint = { name: 'Lighthouse', description: 'd', minterName: 'M' };
  const writes = (client: VfxClient, perCall?: { throwOnRefusal: boolean }) => ({
    mintNft: () => client.mintNft(keypair, mint, perCall),
    transferNft: () =>
      client.transferNft(keypair, { scIdentifier: SC, toAddress: RECIPIENT, locator: 'NA', ...perCall }),
    evolveNft: () => client.evolveNft(keypair, { scIdentifier: SC, stage: 1, ...perCall }),
    burnNft: () => client.burnNft(keypair, { scIdentifier: SC, ...perCall }),
  });

  test('default unchanged: each NFT write resolves to null on a refusal', async () => {
    installNft();
    for (const [name, write] of Object.entries(writes(new VfxClient('testnet')))) {
      expect([name, await write()]).toEqual([name, null]);
    }
  });

  test('per call, each NFT write throws TransactionRefusedError with the reason', async () => {
    installNft();
    for (const write of Object.values(writes(new VfxClient('testnet'), { throwOnRefusal: true }))) {
      await expect(write()).rejects.toMatchObject({ name: 'TransactionRefusedError', reason: refused.Message });
    }
  });

  test('the client option covers the NFT writes; a per-call false turns it off', async () => {
    installNft();
    const client = new VfxClient('testnet', { throwOnRefusal: true });
    for (const write of Object.values(writes(client))) {
      await expect(write()).rejects.toMatchObject({ name: 'TransactionRefusedError' });
    }
    for (const write of Object.values(writes(client, { throwOnRefusal: false }))) {
      expect(await write()).toBeNull();
    }
  });

  test('mintNfts wraps the refusal in NftBulkMintError, the refusal as its cause', async () => {
    installNft();
    const failure = new VfxClient('testnet').mintNfts(keypair, [mint, mint], { throwOnRefusal: true });
    await expect(failure).rejects.toMatchObject({ name: 'NftBulkMintError', index: 0, minted: [] });
    await expect(failure).rejects.toHaveProperty('cause.name', 'TransactionRefusedError');
  });
});

describe('throwOnRefusal and a signer that refuses to sign', () => {
  // A browser extension rejects with a provider error, not an Error instance.
  const rejection = { code: 4001, message: 'User rejected the request.' };
  const refusingSigner = {
    address: keypair.address,
    publicKey: keypair.publicKey,
    signDigest: () => {
      throw rejection;
    },
  };

  test('default unchanged: the send resolves to null', async () => {
    const { calls } = install({ Result: 'Success' }, { Result: 'Success' });
    expect(await new VfxClient('testnet').sendCoin(refusingSigner, RECIPIENT, 1)).toBeNull();
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });

  test('with throwOnRefusal it throws SignerError carrying the signer error, before anything is sent', async () => {
    const { calls } = install({ Result: 'Success' }, { Result: 'Success' });
    for (const client of [new VfxClient('testnet', { throwOnRefusal: true }), new VfxClient('testnet')]) {
      const send = client.sendCoin(refusingSigner, RECIPIENT, 1, { throwOnRefusal: true });
      await expect(send).rejects.toBeInstanceOf(SignerError);
      await expect(send).rejects.toMatchObject({ cause: rejection });
      await expect(send).rejects.toThrow(/User rejected the request.*Nothing was sent/);
    }
    // The client option alone covers the other sends.
    await expect(
      new VfxClient('testnet', { throwOnRefusal: true }).sendCoin(refusingSigner, RECIPIENT, 1),
    ).rejects.toBeInstanceOf(SignerError);
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });

  test('prepared vBTC sends: the signer error unchanged by default, SignerError with throwOnRefusal', async () => {
    const { calls } = installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => ({ success: true, hash: 'PREPARED_HASH' }),
    });
    const transfer = { scIdentifier: 'sc-1', fromAddress: keypair.address, toAddress: RECIPIENT, amount: 1 };
    await expect(new VfxClient('testnet').transferVbtc({ ...transfer, signer: refusingSigner })).rejects.toBe(
      rejection,
    );
    const wrapped = new VfxClient('testnet', { throwOnRefusal: true }).transferVbtc({
      ...transfer,
      signer: refusingSigner,
    });
    await expect(wrapped).rejects.toBeInstanceOf(SignerError);
    await expect(wrapped).rejects.toMatchObject({ cause: rejection });
    expect(calls.some((c) => c.url.includes('/transfer/send/'))).toBe(false);
  });
});

describe('node_message on prepared vBTC sends (Spyglass 78)', () => {
  const transfer = { scIdentifier: 'sc-1', fromAddress: keypair.address, toAddress: RECIPIENT, amount: 1, privateKey };
  const refusedBy = (nodeMessage: string | null) =>
    new Response(JSON.stringify({ success: false, message: 'Failed to send', raw: null, node_message: nodeMessage }), {
      status: 500,
    });

  test('with throwOnRefusal, a 500 carrying the node reason is a definite TransactionRefusedError', async () => {
    installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => refusedBy('Insufficient vBTC balance'),
    });
    await expect(new VfxClient('testnet', { throwOnRefusal: true }).transferVbtc(transfer)).rejects.toMatchObject({
      name: 'TransactionRefusedError',
      hash: 'PREPARED_HASH',
      reason: 'Insufficient vBTC balance',
    });
  });

  test('no node reason (the node did not answer), or no throwOnRefusal: still TransactionDispatchError', async () => {
    installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => refusedBy(null),
    });
    await expect(new VfxClient('testnet', { throwOnRefusal: true }).transferVbtc(transfer)).rejects.toMatchObject({
      name: 'TransactionDispatchError',
      hash: 'PREPARED_HASH',
    });
    installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => refusedBy('Insufficient vBTC balance'),
    });
    await expect(new VfxClient('testnet').transferVbtc(transfer)).rejects.toMatchObject({
      name: 'TransactionDispatchError',
    });
  });

  test('a success: false body prefers node_message as the reason', async () => {
    installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: 'PREPARED_HASH', Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => ({ success: false, message: 'Failed', node_message: 'Bad nonce' }),
    });
    await expect(new VfxClient('testnet', { throwOnRefusal: true }).transferVbtc(transfer)).rejects.toMatchObject({
      name: 'TransactionRefusedError',
      reason: 'Bad nonce',
    });
  });
});
