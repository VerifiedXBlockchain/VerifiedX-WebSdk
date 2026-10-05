import EC from 'elliptic';
import { VfxClient } from '../index';
import KeypairService from '../services/keypair-service';
import {
  tokenBanAddressData,
  tokenBurnData,
  tokenDeployPayload,
  tokenMintData,
  tokenOwnerChangeData,
  tokenPauseData,
  tokenTransferData,
  tokenVoteCastData,
  tokenVoteTopicCreateData,
} from '../services/token-data';
import { Network, TOKEN_BASE_ADDRESS, TxType } from '../constants';
import { CapturedCall, installFetch, jsonResponse, textResponse } from './helpers/mock-fetch';

const keypairService = new KeypairService(Network.Testnet);
const privateKey = '47412619788fecb0ea0b152d1398e5ec742223d14dd8f46121b80cc0b1260ba5';
const keypair = {
  privateKey,
  publicKey: keypairService.publicFromPrivate(privateKey),
  address: keypairService.addressFromPrivate(privateKey),
};
const OWNER = 'xOwner000000000000000000000000000';
const RECIPIENT = 'xRecipient00000000000000000000000';
const SC = 'abc123:1700000000';

const fakeToken = {
  sc_identifier: SC,
  name: 'Acme Fund',
  ticker: 'ACME',
  description: 'd',
  owner_address: OWNER,
  can_mint: true,
  can_burn: true,
  can_vote: true,
  created_at: '2026-01-01T00:00:00Z',
  initial_supply: 0,
  circulating_supply: 100,
  decimal_places: 8,
  image_url: null,
  is_paused: false,
  banned_addresses: [],
  nsfw: false,
};

function installTokenPipeline(overrides: Record<string, (url: string, init?: RequestInit) => unknown> = {}): {
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
    [`/fungible-tokens/${encodeURIComponent(SC)}/`]: () => ({ token: fakeToken, holders: { [OWNER]: 100 } }),
    ...overrides,
  });
}

function sentTransaction(calls: CapturedCall[]): Record<string, unknown> {
  const send = calls.find((c) => c.url.includes('/raw/send/'));
  if (!send) throw new Error('no /raw/send/ call captured');
  return (send.body as { transaction: Record<string, unknown> }).transaction;
}

afterEach(() => {
  jest.resetAllMocks();
});

describe('token Data builders', () => {
  const base = { scIdentifier: SC, fromAddress: OWNER, ticker: 'ACME', name: 'Acme Fund' };

  test('mint / transfer / burn carry the wallet field set in the wallet order', () => {
    expect(tokenMintData({ ...base, amount: 5 })).toEqual({
      Function: 'TokenMint()',
      ContractUID: SC,
      FromAddress: OWNER,
      Amount: 5,
      TokenTicker: 'ACME',
      TokenName: 'Acme Fund',
    });
    expect(Object.keys(tokenTransferData({ ...base, toAddress: RECIPIENT, amount: 1.5 }))).toEqual([
      'Function',
      'ContractUID',
      'FromAddress',
      'ToAddress',
      'Amount',
      'TokenTicker',
      'TokenName',
    ]);
    expect(tokenBurnData({ ...base, amount: 2 }).Function).toBe('TokenBurn()');
  });

  test('pause, ban and owner change', () => {
    expect(tokenPauseData({ scIdentifier: SC, fromAddress: OWNER, pause: false })).toEqual({
      Function: 'TokenPause()',
      ContractUID: SC,
      FromAddress: OWNER,
      Pause: false,
    });
    expect(tokenBanAddressData({ scIdentifier: SC, fromAddress: OWNER, banAddress: RECIPIENT })).toEqual({
      Function: 'TokenBanAddress()',
      ContractUID: SC,
      FromAddress: OWNER,
      BanAddress: RECIPIENT,
    });
    expect(tokenOwnerChangeData({ scIdentifier: SC, fromAddress: OWNER, toAddress: RECIPIENT })).toEqual({
      Function: 'TokenContractOwnerChange()',
      ContractUID: SC,
      FromAddress: OWNER,
      ToAddress: RECIPIENT,
    });
  });

  test('vote topic create and cast', () => {
    const topic = tokenVoteTopicCreateData({
      scIdentifier: SC,
      fromAddress: OWNER,
      topicUid: 'AbCdEfGh1700000000',
      name: 'Distribute Q3',
      description: 'Pay out',
      minimumVoteRequirement: 51,
      blockHeight: 12345,
      createdAt: 1700000000,
      votingEndsAt: 1700000000 + 7 * 86400,
    });
    expect(topic.Function).toBe('TokenVoteTopicCreate()');
    expect(topic.TokenVoteTopic).toEqual({
      SmartContractUID: SC,
      TopicUID: 'AbCdEfGh1700000000',
      TopicName: 'Distribute Q3',
      TopicDescription: 'Pay out',
      MinimumVoteRequirement: 51,
      BlockHeight: 12345,
      TokenHolderCount: 1,
      TopicCreateDate: 1700000000,
      VotingEndDate: 1700604800,
      VoteYes: 0,
      VoteNo: 0,
      TotalVotes: 0,
      PercentVotesYes: 0,
      PercentVotesNo: 0,
      PercentInFavor: 0,
      PercentAgainst: 0,
    });
    expect(tokenVoteCastData({ scIdentifier: SC, fromAddress: OWNER, topicUid: 't1', vote: true }).VoteType).toBe(1);
    expect(tokenVoteCastData({ scIdentifier: SC, fromAddress: OWNER, topicUid: 't1', vote: false }).VoteType).toBe(0);
  });

  test('rejects bad amounts, missing ids and addresses', () => {
    expect(() => tokenMintData({ ...base, amount: 0 })).toThrow(/positive number/);
    expect(() => tokenMintData({ ...base, amount: -1 })).toThrow(/positive number/);
    expect(() => tokenMintData({ ...base, amount: NaN })).toThrow(/positive number/);
    expect(() => tokenMintData({ ...base, scIdentifier: '', amount: 1 })).toThrow(/scIdentifier/);
    expect(() => tokenTransferData({ ...base, toAddress: '', amount: 1 })).toThrow(/toAddress/);
    expect(() => tokenBanAddressData({ scIdentifier: SC, fromAddress: OWNER, banAddress: ' ' })).toThrow(/address/);
    expect(() =>
      tokenVoteTopicCreateData({
        scIdentifier: SC,
        fromAddress: OWNER,
        topicUid: 't',
        name: 'x',
        description: '',
        minimumVoteRequirement: 1,
        blockHeight: 1,
        createdAt: 10,
        votingEndsAt: 10,
      }),
    ).toThrow(/end after/);
  });
});

describe('tokenDeployPayload', () => {
  const minterAddress = OWNER;

  test('builds the compiler payload with the token feature and a default asset', () => {
    const payload = tokenDeployPayload({
      minterAddress,
      name: 'Acme Fund',
      ticker: 'acme',
      mintable: true,
      burnable: true,
    });
    expect(payload).toEqual({
      Name: 'Acme Fund',
      MinterName: minterAddress,
      Description: 'Acme Fund',
      SmartContractAsset: {
        AssetId: '00000000-0000-0000-0000-000000000000',
        Name: 'default',
        AssetAuthorName: minterAddress,
        Location: 'default',
        Extension: '',
        FileSize: 0,
      },
      IsPublic: false,
      Features: [
        {
          FeatureName: 13,
          FeatureFeatures: {
            TokenName: 'Acme Fund',
            TokenTicker: 'ACME',
            TokenDecimalPlaces: 8,
            TokenSupply: 0,
            TokenBurnable: true,
            TokenMintable: true,
            TokenVoting: false,
            TokenImageURL: null,
            TokenImageBase: null,
          },
        },
      ],
      MinterAddress: minterAddress,
      IsMinter: true,
      SCVersion: 1,
    });
  });

  test('an image becomes the primary asset and the token image fields', () => {
    const payload = tokenDeployPayload({
      minterAddress,
      name: 'Acme',
      ticker: 'ACME',
      initialSupply: 1000,
      image: { url: 'https://cdn.example.com/media/logo.png?v=2', thumbnailBase64: 'AAAA' },
    }) as {
      SmartContractAsset: Record<string, unknown>;
      Features: Array<{ FeatureFeatures: Record<string, unknown> }>;
    };
    expect(payload.SmartContractAsset).toEqual({
      AssetId: '00000000-0000-0000-0000-000000000000',
      Name: 'logo.png',
      AssetAuthorName: minterAddress,
      Location: 'https://cdn.example.com/media/logo.png?v=2',
      Extension: 'png',
      FileSize: 0,
    });
    expect(payload.Features[0].FeatureFeatures.TokenImageURL).toBe('https://cdn.example.com/media/logo.png?v=2');
    expect(payload.Features[0].FeatureFeatures.TokenImageBase).toBe('AAAA');
    expect(payload.Features[0].FeatureFeatures.TokenSupply).toBe(1000);
  });

  test('escapes newlines in the description the way the wallet does', () => {
    const payload = tokenDeployPayload({
      minterAddress,
      name: 'Acme',
      ticker: 'ACME',
      initialSupply: 1,
      description: 'line one\r\nline two',
    });
    expect(payload.Description).toBe('line one\\nline two');
  });

  test('rejects what the node or wallets would', () => {
    const ok = { minterAddress, name: 'Acme', ticker: 'ACME', initialSupply: 1 };
    expect(() => tokenDeployPayload({ ...ok, name: ' ' })).toThrow(/name is required/);
    expect(() => tokenDeployPayload({ ...ok, ticker: 'A'.repeat(21) })).toThrow(/ticker/);
    expect(() => tokenDeployPayload({ ...ok, decimalPlaces: 0 })).toThrow(/decimalPlaces/);
    expect(() => tokenDeployPayload({ ...ok, decimalPlaces: 19 })).toThrow(/decimalPlaces/);
    expect(() => tokenDeployPayload({ ...ok, decimalPlaces: 2.5 })).toThrow(/decimalPlaces/);
    expect(() => tokenDeployPayload({ ...ok, initialSupply: 10.5 })).toThrow(/whole number/);
    expect(() => tokenDeployPayload({ ...ok, initialSupply: 10, mintable: true })).toThrow(/mintable token/);
    expect(() => tokenDeployPayload({ ...ok, initialSupply: 0 })).toThrow(/never have any supply/);
  });
});

describe('VfxClient token transactions', () => {
  let client: VfxClient;

  beforeEach(() => {
    client = new VfxClient('testnet');
  });

  test('mintToken sends a Type 15 to Token_Base from the signer, looking up ticker and name', async () => {
    const { calls } = installTokenPipeline();
    const hash = await client.mintToken(keypair, { scIdentifier: SC, amount: 250 });
    expect(hash).toBe('TX_HASH_ABC');

    expect(calls[0].url).toContain(`/fungible-tokens/${encodeURIComponent(SC)}/`);
    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.TokenTx);
    expect(tx.ToAddress).toBe(TOKEN_BASE_ADDRESS);
    expect(tx.FromAddress).toBe(keypair.address);
    expect(tx.Amount).toBe(0);
    expect(tx.Data).toEqual({
      Function: 'TokenMint()',
      ContractUID: SC,
      FromAddress: keypair.address,
      Amount: 250,
      TokenTicker: 'ACME',
      TokenName: 'Acme Fund',
    });
  });

  test('transferToken targets the recipient and skips the lookup when ticker and name are given', async () => {
    const { calls } = installTokenPipeline();
    const hash = await client.transferToken(keypair, {
      scIdentifier: SC,
      toAddress: RECIPIENT,
      amount: 12.5,
      ticker: 'ACME',
      name: 'Acme Fund',
    });
    expect(hash).toBe('TX_HASH_ABC');
    expect(calls.some((c) => c.url.includes('/fungible-tokens/'))).toBe(false);

    const tx = sentTransaction(calls);
    expect(tx.ToAddress).toBe(RECIPIENT);
    expect((tx.Data as Record<string, unknown>).ToAddress).toBe(RECIPIENT);
    expect((tx.Data as Record<string, unknown>).Amount).toBe(12.5);
  });

  test('burnToken, toggleTokenPause and banTokenAddress go to Token_Base', async () => {
    const { calls } = installTokenPipeline();
    await client.burnToken(keypair, { scIdentifier: SC, amount: 1, ticker: 'ACME', name: 'Acme Fund' });
    await client.toggleTokenPause(keypair, { scIdentifier: SC });
    await client.banTokenAddress(keypair, { scIdentifier: SC, address: RECIPIENT });

    const sends = calls
      .filter((c) => c.url.includes('/raw/send/'))
      .map((c) => (c.body as { transaction: Record<string, unknown> }).transaction);
    expect(sends).toHaveLength(3);
    expect(sends.every((tx) => tx.ToAddress === TOKEN_BASE_ADDRESS && tx.TransactionType === TxType.TokenTx)).toBe(
      true,
    );
    expect((sends[0].Data as Record<string, unknown>).Function).toBe('TokenBurn()');
    expect(sends[1].Data).toEqual({
      Function: 'TokenPause()',
      ContractUID: SC,
      FromAddress: keypair.address,
      Pause: true,
    });
    expect((sends[2].Data as Record<string, unknown>).BanAddress).toBe(RECIPIENT);
  });

  test('toggleTokenPause on a paused token carries Pause: false, the state it produces', async () => {
    const { calls } = installTokenPipeline({
      [`/fungible-tokens/${encodeURIComponent(SC)}/`]: () => ({
        token: { ...fakeToken, is_paused: true },
        holders: {},
      }),
    });
    await client.toggleTokenPause(keypair, { scIdentifier: SC });
    expect((sentTransaction(calls).Data as Record<string, unknown>).Pause).toBe(false);
  });

  test('toggleTokenPause fails when the current state cannot be read', async () => {
    const { calls } = installTokenPipeline({
      [`/fungible-tokens/${encodeURIComponent(SC)}/`]: () => jsonResponse({}, 503),
    });
    await expect(client.toggleTokenPause(keypair, { scIdentifier: SC })).rejects.toThrow(/503/);
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
  });

  test('transferTokenOwnership is addressed to the new owner', async () => {
    const { calls } = installTokenPipeline();
    await client.transferTokenOwnership(keypair, { scIdentifier: SC, toAddress: RECIPIENT });
    const tx = sentTransaction(calls);
    expect(tx.ToAddress).toBe(RECIPIENT);
    expect(tx.Data).toEqual({
      Function: 'TokenContractOwnerChange()',
      ContractUID: SC,
      FromAddress: keypair.address,
      ToAddress: RECIPIENT,
    });
  });

  test('createTokenVoteTopic anchors to the latest block and derives the end date', async () => {
    const { calls } = installTokenPipeline({
      '/blocks/': () => ({ count: 1, page: 1, num_pages: 1, results: [{ height: 956614 }] }),
    });
    const before = Math.round(Date.now() / 1000);
    await client.createTokenVoteTopic(keypair, {
      scIdentifier: SC,
      name: 'Distribute Q3',
      description: 'Pay out',
      votingDays: 7,
      minimumVoteRequirement: 51,
    });
    expect(calls[0].url).toContain('/blocks/?limit=1');

    const tx = sentTransaction(calls);
    expect(tx.ToAddress).toBe(TOKEN_BASE_ADDRESS);
    const topic = (tx.Data as { TokenVoteTopic: Record<string, number | string> }).TokenVoteTopic;
    expect(topic.BlockHeight).toBe(956614);
    expect(topic.TopicCreateDate as number).toBeGreaterThanOrEqual(before);
    expect(topic.VotingEndDate).toBe((topic.TopicCreateDate as number) + 7 * 86400);
    expect(topic.TopicUID).toMatch(new RegExp(`^[A-Za-z0-9]{8}${topic.TopicCreateDate}$`));
  });

  test('createTokenVoteTopic uses a supplied blockHeight without asking Spyglass', async () => {
    const { calls } = installTokenPipeline();
    await client.createTokenVoteTopic(keypair, {
      scIdentifier: SC,
      name: 'n',
      description: 'd',
      votingDays: 1,
      minimumVoteRequirement: 1,
      blockHeight: 42,
    });
    expect(calls.some((c) => c.url.includes('/blocks/'))).toBe(false);
    expect(
      (sentTransaction(calls).Data as { TokenVoteTopic: { BlockHeight: number } }).TokenVoteTopic.BlockHeight,
    ).toBe(42);
    await expect(
      client.createTokenVoteTopic(keypair, {
        scIdentifier: SC,
        name: 'n',
        description: 'd',
        votingDays: 0,
        minimumVoteRequirement: 1,
      }),
    ).rejects.toThrow(/votingDays/);
  });

  test('castTokenVote is addressed to the token owner, looked up when not supplied', async () => {
    const { calls } = installTokenPipeline();
    await client.castTokenVote(keypair, { scIdentifier: SC, topicUid: 'topic-1', vote: true });
    const tx = sentTransaction(calls);
    expect(tx.ToAddress).toBe(OWNER);
    expect(tx.Data).toEqual({
      Function: 'TokenVoteTopicCast()',
      ContractUID: SC,
      FromAddress: keypair.address,
      TopicUID: 'topic-1',
      VoteType: 1,
    });
  });

  test('a pre-dispatch failure returns null and sends nothing', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { calls } = installTokenPipeline({
      '/raw/verify/': () => ({ Result: 'Fail', Message: 'Insufficient balance' }),
    });
    const hash = await client.mintToken(keypair, { scIdentifier: SC, amount: 1, ticker: 'ACME', name: 'Acme Fund' });
    expect(hash).toBeNull();
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  test('an external signer signs token transactions identically to the local key', async () => {
    const curve = new EC.ec('secp256k1');
    const signer = {
      address: keypair.address,
      publicKey: keypair.publicKey,
      signDigest: (digestHex: string): Uint8Array =>
        Uint8Array.from(
          curve
            .keyFromPrivate(Buffer.from(privateKey, 'hex'))
            .sign(Buffer.from(digestHex, 'hex'), { canonical: true })
            .toDER(),
        ),
    };
    const { calls } = installTokenPipeline();
    await client.transferToken(signer, {
      scIdentifier: SC,
      toAddress: RECIPIENT,
      amount: 1,
      ticker: 'ACME',
      name: 'Acme Fund',
    });
    const tx = sentTransaction(calls);
    expect(tx.FromAddress).toBe(keypair.address);
    expect(tx.Signature).toBe(keypairService.getSignature('TX_HASH_ABC', privateKey));
  });
});

describe('VfxClient.deployToken', () => {
  const compiled = [{ Function: 'TokenDeploy()', ContractUID: SC, Data: 'H4sI...', MD5List: 'x' }];

  test('compiles on the node, then sends a Type 17 from the signer to itself with the compiled Data', async () => {
    const client = new VfxClient('testnet');
    const { calls } = installTokenPipeline({ '/raw/smart-contract-data/': () => compiled });

    const result = await client.deployToken(keypair, {
      name: 'Acme Fund',
      ticker: 'ACME',
      mintable: true,
      burnable: true,
      voting: true,
    });
    expect(result).toEqual({ transactionHash: 'TX_HASH_ABC', scIdentifier: SC });

    expect(calls[0].url).toContain('/raw/smart-contract-data/');
    const payload = calls[0].body as Record<string, unknown>;
    expect(payload.MinterAddress).toBe(keypair.address);
    expect(payload.SCVersion).toBe(1);
    expect((payload.Features as Array<{ FeatureName: number }>)[0].FeatureName).toBe(13);

    const tx = sentTransaction(calls);
    expect(tx.TransactionType).toBe(TxType.TokenDeploy);
    expect(tx.ToAddress).toBe(keypair.address);
    expect(tx.FromAddress).toBe(keypair.address);
    expect(tx.Amount).toBe(0);
    expect(tx.Data).toEqual(compiled);
  });

  test('dryRun compiles and validates but does not send, and still returns the contract id', async () => {
    const client = new VfxClient('testnet', true);
    const { calls } = installTokenPipeline({ '/raw/smart-contract-data/': () => compiled });
    const result = await client.deployToken(keypair, { name: 'Acme', ticker: 'ACME', initialSupply: 100 });
    expect(result).toEqual({ transactionHash: 'TX_HASH_ABC', scIdentifier: SC });
    expect(calls.some((c) => c.url.includes('/raw/send/'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/raw/verify/'))).toBe(true);
  });

  test('a compile failure surfaces instead of producing a deploy with no contract', async () => {
    const client = new VfxClient('testnet');
    installTokenPipeline({ '/raw/smart-contract-data/': () => jsonResponse({}, 500) });
    await expect(client.deployToken(keypair, { name: 'Acme', ticker: 'ACME', initialSupply: 1 })).rejects.toThrow(
      /500/,
    );
    installTokenPipeline({ '/raw/smart-contract-data/': () => ({ Success: false, Message: 'SC Main was null' }) });
    await expect(client.deployToken(keypair, { name: 'Acme', ticker: 'ACME', initialSupply: 1 })).rejects.toThrow(
      /Unexpected smart-contract-data/,
    );
  });

  test('invalid parameters fail before any request', async () => {
    const client = new VfxClient('testnet');
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      client.deployToken(keypair, { name: 'Acme', ticker: 'ACME', mintable: true, initialSupply: 5 }),
    ).rejects.toThrow(/mintable token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('VfxClient token reads', () => {
  let client: VfxClient;

  beforeEach(() => {
    client = new VfxClient('testnet');
  });

  test('listFungibleTokens passes paging and returns the page', async () => {
    const { calls } = installFetch({
      '/fungible-tokens/': () => ({ count: 1, page: 2, num_pages: 3, results: [fakeToken] }),
    });
    const page = await client.listFungibleTokens(2, 5);
    expect(calls[0].url).toContain('/fungible-tokens/?page=2&limit=5');
    expect(page.results[0].ticker).toBe('ACME');
  });

  test('getFungibleToken returns token and holders', async () => {
    installFetch({
      [`/fungible-tokens/${encodeURIComponent(SC)}/`]: () => ({ token: fakeToken, holders: { [OWNER]: 100 } }),
    });
    const detail = await client.getFungibleToken(SC);
    expect(detail.token.sc_identifier).toBe(SC);
    expect(detail.holders[OWNER]).toBe(100);
  });

  test('getFungibleTokenBalances unwraps tokens and reads an unknown address as empty', async () => {
    installFetch({
      '/addresses/xKnown/tokens/': () => ({ address: 'xKnown', tokens: [{ token: fakeToken, balance: 42 }] }),
      '/addresses/xUnknown/tokens/': () => jsonResponse({ detail: 'Address not found' }, 404),
      '/addresses/xBroken/tokens/': () => jsonResponse({}, 500),
    });
    expect(await client.getFungibleTokenBalances('xKnown')).toEqual([{ token: fakeToken, balance: 42 }]);
    expect(await client.getFungibleTokenBalances('xUnknown')).toEqual([]);
    await expect(client.getFungibleTokenBalances('xBroken')).rejects.toThrow(/500/);
  });

  test('voting topic reads', async () => {
    const topic = { topic_id: 't1', sc_identifier: SC, name: 'n' };
    const { calls } = installFetch({
      [`/fungible-tokens/${encodeURIComponent(SC)}/voting-topics/`]: () => ({
        count: 1,
        page: 1,
        num_pages: 1,
        results: [topic],
      }),
      '/fungible-tokens/voting-topics/t1/': () => topic,
    });
    expect((await client.listTokenVotingTopics(SC)).results[0].topic_id).toBe('t1');
    expect((await client.getTokenVotingTopic('t1')).topic_id).toBe('t1');
    expect(calls).toHaveLength(2);
  });
});
