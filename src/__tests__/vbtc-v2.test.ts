import { VfxClient } from '../index';
import { VbtcProgressEvent } from '../types';
import { installFetch } from './helpers/mock-fetch';

describe('vBTC V2 — dryRun guard', () => {
  test('all mutating vBTC flows throw immediately on a dryRun client', async () => {
    const client = new VfxClient('testnet', true);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const common = { scIdentifier: 'sc-1', privateKey: '00' + '11'.repeat(32) };
    await expect(client.transferVbtc({ ...common, fromAddress: 'xA', toAddress: 'xB', amount: 1 })).rejects.toThrow(
      /dryRun/,
    );
    await expect(
      client.createVbtcToken({ ...common, ownerAddress: 'xA', name: 'n', description: 'd', ticker: 'T' }),
    ).rejects.toThrow(/dryRun/);
    await expect(
      client.requestWithdrawal({ ...common, requestorAddress: 'xA', btcAddress: 'bc1q', amount: 1, feeRate: 5 }),
    ).rejects.toThrow(/dryRun/);
    await expect(
      client.completeWithdrawal({
        ...common,
        requestorAddress: 'xA',
        withdrawalRequestHash: 'WR',
        btcAddress: 'bc1q',
        amount: 1,
        feeRate: 5,
      }),
    ).rejects.toThrow(/dryRun/);
    await expect(
      client.cancelWithdrawal({ ...common, ownerAddress: 'xA', withdrawalRequestHash: 'WR' }),
    ).rejects.toThrow(/dryRun/);

    // Guard fires before any network activity.
    expect(fetchMock).not.toHaveBeenCalled();
    jest.resetAllMocks();
  });
});

describe('vBTC V2 — read methods', () => {
  let client: VfxClient;

  beforeEach(() => {
    client = new VfxClient('testnet');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('getVbtcTokens unwraps results array', async () => {
    const fakeToken = { sc_identifier: 'sc-1', owner_address: 'xAddr' } as const;
    installFetch({
      '/btc/vbtc-v2/xAddr/': () => ({ results: [fakeToken] }),
    });

    const tokens = await client.getVbtcTokens('xAddr');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].sc_identifier).toBe('sc-1');
  });

  test('getVbtcTokenDetail returns the token object', async () => {
    const fakeToken = { sc_identifier: 'sc-1', addresses: { xA: 100 } };
    installFetch({
      '/btc/vbtc-v2/detail/sc-1/': () => fakeToken,
    });

    const detail = await client.getVbtcTokenDetail('sc-1');
    expect(detail).toEqual(fakeToken);
  });

  test('getVbtcTokens returns empty array if results missing', async () => {
    installFetch({
      '/btc/vbtc-v2/xAddr/': () => ({}),
    });

    const tokens = await client.getVbtcTokens('xAddr');
    expect(tokens).toEqual([]);
  });
});

describe('vBTC V2 — transferVbtc', () => {
  let client: VfxClient;
  let privateKey: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('calls prepare then send and forwards hash/signature/public_key', async () => {
    const expectedHash = 'PREPARED_HASH_ABC';
    const { calls } = installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: true, Hash: expectedHash, Fee: 1 }),
      '/btc/vbtc-v2/transfer/send/': () => ({ success: true, Hash: 'SENT_HASH_XYZ' }),
    });

    const result = await client.transferVbtc({
      scIdentifier: 'sc-1',
      fromAddress: 'xFrom',
      toAddress: 'xTo',
      amount: 5,
      privateKey,
    });

    expect(result).toEqual({ transactionHash: 'SENT_HASH_XYZ' });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/btc/vbtc-v2/transfer/prepare/');
    expect(calls[0].body).toEqual({
      sc_identifier: 'sc-1',
      from_address: 'xFrom',
      to_address: 'xTo',
      amount: 5,
    });

    expect(calls[1].url).toContain('/btc/vbtc-v2/transfer/send/');
    const sendBody = calls[1].body as { hash: string; signature: string; public_key: string };
    expect(sendBody.hash).toBe(expectedHash);

    const expectedSignature = client.getSignature(expectedHash, privateKey);
    expect(sendBody.signature).toBe(expectedSignature);

    const expectedPublic = client.publicFromPrivate(privateKey).replace(/^04/, '');
    expect(sendBody.public_key).toBe(expectedPublic);
  });

  test('throws when prepare returns success: false', async () => {
    installFetch({
      '/btc/vbtc-v2/transfer/prepare/': () => ({ success: false, message: 'nope' }),
    });

    await expect(
      client.transferVbtc({
        scIdentifier: 'sc-1',
        fromAddress: 'xFrom',
        toAddress: 'xTo',
        amount: 5,
        privateKey,
      }),
    ).rejects.toThrow(/transferVbtc:prepare/);
  });
});

describe('vBTC V2 — cancelWithdrawal', () => {
  let client: VfxClient;
  let privateKey: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('signs the prepare hash and sends', async () => {
    const { calls } = installFetch({
      '/btc/vbtc-v2/withdraw/cancel/prepare/': () => ({ success: true, Hash: 'CANCEL_HASH', Fee: 0 }),
      '/btc/vbtc-v2/withdraw/cancel/send/': () => ({ success: true, Hash: 'CANCEL_TX' }),
    });

    const result = await client.cancelWithdrawal({
      scIdentifier: 'sc-1',
      ownerAddress: 'xOwner',
      withdrawalRequestHash: 'WR_HASH',
      privateKey,
    });

    expect(result).toEqual({ transactionHash: 'CANCEL_TX' });
    expect(calls[0].body).toEqual({
      sc_identifier: 'sc-1',
      owner_address: 'xOwner',
      withdrawal_request_hash: 'WR_HASH',
    });
    expect((calls[1].body as { hash: string }).hash).toBe('CANCEL_HASH');
  });
});

describe('vBTC V2 — createVbtcToken', () => {
  let client: VfxClient;
  let privateKey: string;
  let ownerAddress: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
    ownerAddress = client.addressFromPrivate(privateKey);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('runs ceremony → contract create and emits progress events', async () => {
    const startMessage = 'START_MSG';
    const startTimestamp = 1700000000;
    const shareMessage = 'SHARE_MSG';
    const shareTimestamp = 1700000001;

    const { calls } = installFetch({
      '/btc/vbtc-v2/ceremony/prepare/': () => ({
        success: true,
        ceremony_id: 'CER_1',
        session_id: 'SES_1',
        messages_to_sign: {
          start_message: startMessage,
          start_timestamp: startTimestamp,
          share_distribution_message: shareMessage,
          share_distribution_timestamp: shareTimestamp,
        },
        validator_count: 5,
        threshold: 3,
      }),
      '/btc/vbtc-v2/ceremony/execute/': () => ({ success: true }),
      '/btc/vbtc-v2/ceremony/CER_1/': () => ({ success: true, status: 'Completed', progress: 100 }),
      '/btc/vbtc-v2/create/prepare/': () => ({
        success: true,
        Hash: 'CREATE_PREPARE_HASH',
        SmartContractUID: 'SC_UID_1',
        DepositAddress: 'btcDeposit1',
        Fee: 2,
      }),
      '/btc/vbtc-v2/create/send/': () => ({ success: true, Hash: 'CREATE_TX_HASH' }),
    });

    const progressEvents: VbtcProgressEvent[] = [];

    const result = await client.createVbtcToken({
      ownerAddress,
      privateKey,
      name: 'MyToken',
      description: 'desc',
      ticker: 'MTK',
      onProgress: (e) => progressEvents.push(e),
      pollIntervalMs: 5,
      timeoutMs: 5000,
    });

    expect(result.scIdentifier).toBe('SC_UID_1');
    expect(result.depositAddress).toBe('btcDeposit1');
    expect(result.transactionHash).toBe('CREATE_TX_HASH');

    // Validate ceremony execute body has signatures matching the messages.
    const execCall = calls.find((c) => c.url.includes('/ceremony/execute/'));
    expect(execCall).toBeDefined();
    const execBody = execCall!.body as {
      start_signature: string;
      share_distribution_signature: string;
      start_timestamp: number;
      share_distribution_timestamp: number;
      ceremony_id: string;
      session_id: string;
      owner_address: string;
    };
    expect(execBody.start_signature).toBe(client.getSignature(startMessage, privateKey));
    expect(execBody.share_distribution_signature).toBe(client.getSignature(shareMessage, privateKey));
    expect(execBody.start_timestamp).toBe(startTimestamp);
    expect(execBody.share_distribution_timestamp).toBe(shareTimestamp);
    expect(execBody.ceremony_id).toBe('CER_1');
    expect(execBody.session_id).toBe('SES_1');
    expect(execBody.owner_address).toBe(ownerAddress);

    // Validate prepareCreate body — ownership proof signature matches the concat-no-separators format.
    const prepCall = calls.find((c) => c.url.includes('/vbtc-v2/create/prepare/'));
    expect(prepCall).toBeDefined();
    const prepBody = prepCall!.body as {
      owner_address: string;
      name: string;
      description: string;
      ticker: string;
      ceremony_id: string;
      timestamp: number;
      unique_id: string;
      owner_signature: string;
    };
    const expectedOwnershipMessage = `${ownerAddress}MyTokendescMTKCER_1${prepBody.timestamp}${prepBody.unique_id}`;
    expect(prepBody.owner_signature).toBe(client.getSignature(expectedOwnershipMessage, privateKey));
    expect(prepBody.unique_id).toHaveLength(16);

    // Send body should sign the prepare Hash.
    const sendCall = calls.find((c) => c.url.includes('/vbtc-v2/create/send/'));
    expect(sendCall).toBeDefined();
    const sendBody = sendCall!.body as { hash: string; signature: string; public_key: string };
    expect(sendBody.hash).toBe('CREATE_PREPARE_HASH');
    expect(sendBody.signature).toBe(client.getSignature('CREATE_PREPARE_HASH', privateKey));

    // Progress should include each phase boundary.
    const phases = progressEvents.map((e) => e.phase);
    expect(phases).toContain('ceremony_started');
    expect(phases).toContain('ceremony_polling');
    expect(phases).toContain('ceremony_complete');
    expect(phases).toContain('contract_preparing');
    expect(phases).toContain('contract_sent');
  });

  test('throws if ceremony status reports Failed', async () => {
    installFetch({
      '/btc/vbtc-v2/ceremony/prepare/': () => ({
        success: true,
        ceremony_id: 'CER_F',
        session_id: 'SES_F',
        messages_to_sign: {
          start_message: 'SM',
          start_timestamp: 1,
          share_distribution_message: 'SDM',
          share_distribution_timestamp: 2,
        },
        validator_count: 5,
        threshold: 3,
      }),
      '/btc/vbtc-v2/ceremony/execute/': () => ({ success: true }),
      '/btc/vbtc-v2/ceremony/CER_F/': () => ({ success: true, status: 'Failed', message: 'boom' }),
    });

    await expect(
      client.createVbtcToken({
        ownerAddress,
        privateKey,
        name: 'X',
        description: 'd',
        ticker: 'X',
        pollIntervalMs: 5,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/ceremony polling failed/);
  });
});

describe('vBTC V2 — requestWithdrawal', () => {
  let client: VfxClient;
  let privateKey: string;
  let requestorAddress: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
    requestorAddress = client.addressFromPrivate(privateKey);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('runs full 4-step flow: request → FROST → broadcast → completion', async () => {
    const { calls } = installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: true,
        SessionId: 'SES_W',
        StartMessage: 'FROST_START',
        StartTimestamp: 100,
        ShareDistributionMessage: 'FROST_SHARE',
        ShareDistributionTimestamp: 101,
        Amount: 0.001,
        BTCDestination: 'bc1qBTC',
        FeeRate: 10,
      }),
      '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_1' }),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_1/': () => ({
        success: true,
        status: 'complete',
        signed_btc_tx_hex: '0200000001abcd',
        sc_identifier: 'sc-1',
        withdrawal_request_hash: 'WR_HASH',
      }),
      '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID_123' }),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: true, Hash: 'COMP_PREP_HASH', Fee: 0 }),
      '/btc/vbtc-v2/withdraw/complete/tx/send/': () => ({ success: true, Hash: 'COMP_TX_HASH' }),
    });

    const result = await client.requestWithdrawal({
      scIdentifier: 'sc-1',
      requestorAddress,
      btcAddress: 'bc1qBTC',
      amount: 0.001,
      feeRate: 10,
      privateKey,
      pollIntervalMs: 5,
      timeoutMs: 5000,
    });

    expect(result).toEqual({
      btcTransactionHash: 'BTC_TXID_123',
      completionTransactionHash: 'COMP_TX_HASH',
      withdrawalRequestHash: 'WR_HASH',
    });

    const broadcastCall = calls.find((c) => c.url.includes('/btc/broadcast/'));
    expect(broadcastCall).toBeDefined();
    expect(broadcastCall!.body).toEqual({ raw_tx_hex: '0200000001abcd' });

    const compPrep = calls.find((c) => c.url.includes('/withdraw/complete/tx/prepare/'));
    expect(compPrep).toBeDefined();
    expect(compPrep!.body).toMatchObject({
      sc_identifier: 'sc-1',
      from_address: requestorAddress,
      withdrawal_request_hash: 'WR_HASH',
      btc_transaction_hash: 'BTC_TXID_123',
      amount: 0.001,
      btc_destination: 'bc1qBTC',
    });

    const compSend = calls.find((c) => c.url.includes('/withdraw/complete/tx/send/'));
    expect(compSend).toBeDefined();
    expect((compSend!.body as { hash: string }).hash).toBe('COMP_PREP_HASH');

    // FROST execute should carry both signatures derived from messages.
    const frostExec = calls.find((c) => c.url.includes('/withdraw/complete/execute/'));
    expect(frostExec).toBeDefined();
    const frostBody = frostExec!.body as { start_signature: string; share_distribution_signature: string };
    expect(frostBody.start_signature).toBe(client.getSignature('FROST_START', privateKey));
    expect(frostBody.share_distribution_signature).toBe(client.getSignature('FROST_SHARE', privateKey));
  });

  test('execute carries caller inputs as delegated params even when prepare returns zeros', async () => {
    // The FROST prepare races the node's processing of the Type 27 block —
    // when the withdrawal-request record isn't there yet, prepare silently
    // returns Amount=0 / BTCDestination='' / FeeRate=10. The execute payload
    // must carry the CALLER's real values so the node can build a transient
    // request instead of failing with "Withdrawal request not found"
    // (2026-06-12 first mainnet V2 withdrawal).
    const { calls } = installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH' }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: true,
        SessionId: 'SES_W',
        StartMessage: 'FROST_START',
        StartTimestamp: 100,
        ShareDistributionMessage: 'FROST_SHARE',
        ShareDistributionTimestamp: 101,
        // Node hasn't seen the request record yet — prepare defaults.
        Amount: 0,
        BTCDestination: '',
        FeeRate: 10,
      }),
      '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_1' }),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_1/': () => ({
        success: true,
        status: 'complete',
        signed_btc_tx_hex: '0200000001abcd',
        sc_identifier: 'sc-1',
        withdrawal_request_hash: 'WR_HASH',
      }),
      '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID_123' }),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: true, Hash: 'COMP_PREP_HASH', Fee: 0 }),
      '/btc/vbtc-v2/withdraw/complete/tx/send/': () => ({ success: true, Hash: 'COMP_TX_HASH' }),
    });

    await client.requestWithdrawal({
      scIdentifier: 'sc-1',
      requestorAddress,
      btcAddress: 'bc1qRealDestination',
      amount: 0.00042,
      feeRate: 21,
      privateKey,
      pollIntervalMs: 5,
      timeoutMs: 5000,
    });

    const frostExec = calls.find((c) => c.url.includes('/withdraw/complete/execute/'));
    expect(frostExec).toBeDefined();
    expect(frostExec!.body).toMatchObject({
      amount: 0.00042,
      btc_destination: 'bc1qRealDestination',
      fee_rate: 21,
    });
  });

  test('throws if FROST job reports failed', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH' }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: true,
        SessionId: 'SES_W',
        StartMessage: 'FS',
        StartTimestamp: 100,
        ShareDistributionMessage: 'FSh',
        ShareDistributionTimestamp: 101,
        Amount: 0.001,
        BTCDestination: 'bc1q',
        FeeRate: 10,
      }),
      '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_F' }),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_F/': () => ({
        success: false,
        status: 'failed',
        message: 'frost died',
      }),
    });

    await expect(
      client.requestWithdrawal({
        scIdentifier: 'sc-1',
        requestorAddress,
        btcAddress: 'bc1q',
        amount: 0.001,
        feeRate: 10,
        privateKey,
        pollIntervalMs: 5,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/frost polling failed/);
  });
});

describe('vBTC V2 — withdrawal completion failure stays resumable', () => {
  let client: VfxClient;
  let privateKey: string;
  let requestorAddress: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
    requestorAddress = client.addressFromPrivate(privateKey);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const withdrawParams = () => ({
    scIdentifier: 'sc-1',
    requestorAddress,
    btcAddress: 'bc1qBTC',
    amount: 0.001,
    feeRate: 10,
    privateKey,
    pollIntervalMs: 1,
    timeoutMs: 50,
  });

  test('a failed FROST ceremony still surfaces the on-chain request hash', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: true,
        SessionId: 'SES_W',
        StartMessage: 'FROST_START',
        StartTimestamp: 100,
        ShareDistributionMessage: 'FROST_SHARE',
        ShareDistributionTimestamp: 101,
        Amount: 0.001,
        BTCDestination: 'bc1qBTC',
        FeeRate: 10,
      }),
      '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_F' }),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_F/': () => ({
        success: false,
        status: 'failed',
        message: 'Invalid start signature',
      }),
    });

    await expect(client.requestWithdrawal(withdrawParams())).rejects.toMatchObject({
      name: 'VbtcWithdrawalIncompleteError',
      withdrawalRequestHash: 'WR_HASH',
    });
  });

  test('the underlying failure reason is preserved, not swallowed', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
      '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
        success: false,
        message: 'Contract not found',
      }),
    });

    await expect(client.requestWithdrawal(withdrawParams())).rejects.toThrow(/Contract not found/);
    await expect(client.requestWithdrawal(withdrawParams())).rejects.toThrow(/WR_HASH/);
  });

  test('a request that never reached the chain does not masquerade as resumable', async () => {
    installFetch({
      '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: false, message: 'nope' }),
    });

    await expect(client.requestWithdrawal(withdrawParams())).rejects.not.toMatchObject({
      name: 'VbtcWithdrawalIncompleteError',
    });
  });
});

describe('vBTC V2 — a post-broadcast failure must never advise re-signing', () => {
  let client: VfxClient;
  let privateKey: string;
  let requestorAddress: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
    requestorAddress = client.addressFromPrivate(privateKey);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const withdrawParams = () => ({
    scIdentifier: 'sc-1',
    requestorAddress,
    btcAddress: 'bc1qBTC',
    amount: 0.001,
    feeRate: 10,
    privateKey,
    pollIntervalMs: 1,
    timeoutMs: 50,
  });

  // Everything up to and including a successful BTC broadcast.
  const throughBroadcast = () => ({
    '/btc/vbtc-v2/withdraw/request/prepare/': () => ({ success: true, Hash: 'REQ_PREP_HASH', Fee: 1 }),
    '/btc/vbtc-v2/withdraw/request/send/': () => ({ success: true, Hash: 'WR_HASH' }),
    '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
      success: true,
      SessionId: 'SES_W',
      StartMessage: 'FROST_START',
      StartTimestamp: 100,
      ShareDistributionMessage: 'FROST_SHARE',
      ShareDistributionTimestamp: 101,
      Amount: 0.001,
      BTCDestination: 'bc1qBTC',
      FeeRate: 10,
    }),
    '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_F' }),
    '/btc/vbtc-v2/withdraw/complete/status/JOB_F/': () => ({
      success: true,
      status: 'complete',
      signed_btc_tx_hex: 'DEADBEEF',
      sc_identifier: 'sc-1',
      withdrawal_request_hash: 'WR_HASH',
    }),
    '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID' }),
  });

  test('Type 28 failure surfaces the txid and forbids completeWithdrawal', async () => {
    installFetch({
      ...throughBroadcast(),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: false, message: 'node unreachable' }),
    });

    // The BTC is gone. The caller must learn the txid, or the payout is
    // stranded with no way to record it.
    await expect(client.requestWithdrawal(withdrawParams())).rejects.toMatchObject({
      name: 'VbtcWithdrawalUnrecordedError',
      withdrawalRequestHash: 'WR_HASH',
      btcTransactionHash: 'BTC_TXID',
    });

    await expect(client.requestWithdrawal(withdrawParams())).rejects.toThrow(/Do NOT call completeWithdrawal/);
    await expect(client.requestWithdrawal(withdrawParams())).rejects.toThrow(/recordWithdrawalCompletion/);
  });

  test('a post-broadcast failure is not reported as merely incomplete', async () => {
    installFetch({
      ...throughBroadcast(),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: false, message: 'node unreachable' }),
    });

    // VbtcWithdrawalIncompleteError tells the caller to resume via
    // completeWithdrawal, which re-runs the ceremony and can pay twice.
    await expect(client.requestWithdrawal(withdrawParams())).rejects.not.toMatchObject({
      name: 'VbtcWithdrawalIncompleteError',
    });
  });

  test('an accepted broadcast with no txid is flagged unrecoverable, not retryable', async () => {
    installFetch({
      ...throughBroadcast(),
      '/btc/broadcast/': () => ({ success: true }),
    });

    await expect(client.requestWithdrawal(withdrawParams())).rejects.toMatchObject({
      name: 'VbtcWithdrawalUnrecordedError',
      btcTransactionHash: null,
    });
    await expect(client.requestWithdrawal(withdrawParams())).rejects.toThrow(/recover it from the Bitcoin network/);
  });

  test('a rejected broadcast stays pre-broadcast and remains resumable', async () => {
    installFetch({
      ...throughBroadcast(),
      '/btc/broadcast/': () => ({ success: false, message: 'min relay fee not met' }),
    });

    // Nothing was spent, so re-driving the ceremony is the correct advice here.
    await expect(client.requestWithdrawal(withdrawParams())).rejects.toMatchObject({
      name: 'VbtcWithdrawalIncompleteError',
      withdrawalRequestHash: 'WR_HASH',
    });
  });

  test('recordWithdrawalCompletion records a broadcast withdrawal without re-signing', async () => {
    const seen: string[] = [];
    installFetch({
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => {
        seen.push('prepare');
        return { success: true, Hash: 'COMPLETION_PREP', Fee: 1 };
      },
      '/btc/vbtc-v2/withdraw/complete/tx/send/': () => {
        seen.push('send');
        return { success: true, Hash: 'COMPLETION_HASH' };
      },
    });

    const result = await client.recordWithdrawalCompletion({
      scIdentifier: 'sc-1',
      requestorAddress,
      withdrawalRequestHash: 'WR_HASH',
      btcTransactionHash: 'BTC_TXID',
      amount: 0.001,
      btcDestination: 'bc1qBTC',
      privateKey,
    });

    expect(result).toEqual({
      btcTransactionHash: 'BTC_TXID',
      completionTransactionHash: 'COMPLETION_HASH',
      withdrawalRequestHash: 'WR_HASH',
    });
    // No ceremony endpoints were touched — that is the whole point.
    expect(seen).toEqual(['prepare', 'send']);
  });

  test('recording refuses to proceed without a txid', async () => {
    installFetch({});
    await expect(
      client.recordWithdrawalCompletion({
        scIdentifier: 'sc-1',
        requestorAddress,
        withdrawalRequestHash: 'WR_HASH',
        btcTransactionHash: '',
        amount: 0.001,
        btcDestination: 'bc1qBTC',
        privateKey,
      }),
    ).rejects.toThrow(/requires the broadcast btcTransactionHash/);
  });
});

describe('vBTC V2 — FROST polling tolerates job registration lag', () => {
  let client: VfxClient;
  let privateKey: string;
  let requestorAddress: string;

  beforeEach(() => {
    client = new VfxClient('testnet');
    privateKey = client.generatePrivateKey();
    requestorAddress = client.addressFromPrivate(privateKey);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const params = () => ({
    scIdentifier: 'sc-1',
    requestorAddress,
    withdrawalRequestHash: 'WR_HASH',
    btcAddress: 'bc1qBTC',
    amount: 0.001,
    feeRate: 10,
    privateKey,
    pollIntervalMs: 1,
    timeoutMs: 2000,
  });

  const upToPolling = () => ({
    '/btc/vbtc-v2/withdraw/complete/prepare/': () => ({
      success: true,
      SessionId: 'SES_W',
      StartMessage: 'FROST_START',
      StartTimestamp: 100,
      ShareDistributionMessage: 'FROST_SHARE',
      ShareDistributionTimestamp: 101,
      Amount: 0.001,
      BTCDestination: 'bc1qBTC',
      FeeRate: 10,
    }),
    '/btc/vbtc-v2/withdraw/complete/execute/': () => ({ success: true, job_id: 'JOB_F' }),
  });

  test('rides out transient not-yet-registered failures and still completes', async () => {
    let polls = 0;
    installFetch({
      ...upToPolling(),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_F/': () => {
        polls += 1;
        // The job is not queryable yet for the first few polls.
        if (polls <= 3) return { success: false, status: 'failed', message: 'job not found' };
        return {
          success: true,
          status: 'complete',
          signed_btc_tx_hex: 'DEADBEEF',
          sc_identifier: 'sc-1',
          withdrawal_request_hash: 'WR_HASH',
        };
      },
      '/btc/broadcast/': () => ({ success: true, txid: 'BTC_TXID' }),
      '/btc/vbtc-v2/withdraw/complete/tx/prepare/': () => ({ success: true, Hash: 'CP', Fee: 1 }),
      '/btc/vbtc-v2/withdraw/complete/tx/send/': () => ({ success: true, Hash: 'COMPLETION_HASH' }),
    });

    const result = await client.completeWithdrawal(params());
    expect(result.btcTransactionHash).toBe('BTC_TXID');
    expect(polls).toBeGreaterThan(3);
  });

  test('a persistent failure still aborts rather than polling to the deadline', async () => {
    installFetch({
      ...upToPolling(),
      '/btc/vbtc-v2/withdraw/complete/status/JOB_F/': () => ({
        success: false,
        status: 'failed',
        message: 'Invalid start signature',
      }),
    });

    await expect(client.completeWithdrawal(params())).rejects.toThrow(/Invalid start signature/);
  });
});
