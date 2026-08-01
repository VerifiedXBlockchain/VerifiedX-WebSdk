import BtcClient from '../btc';
import { DOMAIN_PURCHASE_COST, Network, TxType } from '../constants';
import KeypairService from '../services/keypair-service';
import { RawTransactionService } from '../services/raw-transaction-service';
import {
  CreateVbtcResult,
  Keypair,
  PaginatedResponse,
  Transaction,
  VbtcCancelResult,
  VbtcProgressEvent,
  VbtcTransfer,
  VbtcTransferResult,
  VbtcV2Token,
  VbtcWithdrawalRequest,
  VbtcWithdrawalResult,
  VfxAddress,
} from '../types';
import {
  cleanBtcDomain,
  cleanVfxDomain,
  domainWithoutSuffix,
  generateRandomStringSecure,
  isValidBtcDomain,
  isValidVfxDomain,
  normalizePrivateKey,
} from '../utils';
import { AddressApiClient } from './address-api-client';
import { AdnrApiClient } from './adnr-client';
import { RawTransactionApiClient } from './raw-transaction-api-client';
import { TransactionApiClient } from './transaction-api.client';
import { PreparedTransactionResponse, SentTransactionResponse, VbtcV2ApiClient } from './vbtc-v2-api-client';

type SendFn = (body: { hash: string; signature: string; public_key: string }) => Promise<SentTransactionResponse>;

const VBTC_UNIQUE_ID_CHARSET = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789';

/**
 * Thrown when a withdrawal request made it on chain but completing it did
 * not. The request is live, and the chain refuses a new one while it stands,
 * so re-driving completion for `withdrawalRequestHash` is the only way
 * forward — hence the hash travelling on the error rather than being lost
 * with the return value the caller never got.
 */
export class VbtcWithdrawalIncompleteError extends Error {
  readonly withdrawalRequestHash: string;
  readonly cause: unknown;

  constructor(withdrawalRequestHash: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Withdrawal request ${withdrawalRequestHash} is on chain but completion ` +
        `failed: ${detail}. Resume with completeWithdrawal({ withdrawalRequestHash }).`,
    );
    this.name = 'VbtcWithdrawalIncompleteError';
    this.withdrawalRequestHash = withdrawalRequestHash;
    this.cause = cause;
    // Subclassing a built-in under an ES6 target loses the prototype chain,
    // which would break instanceof for callers trying to recover the hash.
    Object.setPrototypeOf(this, VbtcWithdrawalIncompleteError.prototype);
  }
}

/**
 * Thrown when the Bitcoin transaction was broadcast but the VFX-side
 * completion record was not written. The BTC has left the vault; only the
 * Type 28 is missing.
 *
 * This is emphatically NOT resumable via completeWithdrawal — that restarts
 * the signing ceremony, and a second ceremony can broadcast a second Bitcoin
 * transaction against a different UTXO and pay the destination twice. Resume
 * with recordWithdrawalCompletion, which needs no ceremony state.
 *
 * `btcTransactionHash` is null only in the narrow case where the broadcast was
 * accepted but the node returned no txid. The coins are gone and the txid must
 * be recovered from the Bitcoin network (look up spends of the contract's
 * Taproot deposit address) before completion can be recorded. Retrying is
 * unsafe in that state.
 */
export class VbtcWithdrawalUnrecordedError extends Error {
  readonly withdrawalRequestHash: string;
  readonly btcTransactionHash: string | null;
  readonly cause: unknown;

  constructor(withdrawalRequestHash: string, btcTransactionHash: string | null, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const resume = btcTransactionHash
      ? `Resume with recordWithdrawalCompletion({ withdrawalRequestHash, btcTransactionHash: '${btcTransactionHash}' }).`
      : 'The broadcast was accepted but returned no txid; recover it from the Bitcoin network before recording completion.';
    super(
      `Withdrawal request ${withdrawalRequestHash} broadcast its Bitcoin transaction ` +
        `but the on-chain completion was not recorded: ${detail}. ` +
        `Do NOT call completeWithdrawal — it would re-sign and may broadcast a second payout. ${resume}`,
    );
    this.name = 'VbtcWithdrawalUnrecordedError';
    this.withdrawalRequestHash = withdrawalRequestHash;
    this.btcTransactionHash = btcTransactionHash;
    this.cause = cause;
    Object.setPrototypeOf(this, VbtcWithdrawalUnrecordedError.prototype);
  }
}

export interface VfxClientOptions {
  /** Return would-be hashes from sendCoin/domain purchases without broadcasting. */
  dryRun?: boolean;
  /**
   * Override the network-derived data API origin (e.g. a self-hosted node or
   * a replacement testnet), including the /api suffix:
   * 'https://data-testnet.verifiedx.io/api'
   */
  baseUrl?: string;
  /** Per-request timeout in ms (default 30000; 0 disables). */
  timeoutMs?: number;
}

export class VfxClient {
  private network: Network;
  private dryRun: boolean;
  private apiOptions: { baseUrl?: string; timeoutMs?: number };
  private keypairService: KeypairService;
  private addressApiClient: AddressApiClient;
  private adnrApiClient: AdnrApiClient;
  private rawTransactionApiClient: RawTransactionApiClient;
  private transactionApiClient: TransactionApiClient;
  private vbtcV2ApiClient: VbtcV2ApiClient;

  /**
   * @param network 'mainnet' | 'testnet' (or the Network enum)
   * @param dryRunOrOptions boolean dryRun (historical signature) or a
   *   VfxClientOptions object: new VfxClient('testnet', { baseUrl: '...' })
   */
  constructor(network: Network | 'mainnet' | 'testnet', dryRunOrOptions: boolean | VfxClientOptions = false) {
    // Convert string literals to Network enum values
    const networkEnum = typeof network === 'string'
      ? (network === 'mainnet' ? Network.Mainnet : Network.Testnet)
      : network;

    const options: VfxClientOptions =
      typeof dryRunOrOptions === 'boolean' ? { dryRun: dryRunOrOptions } : dryRunOrOptions;

    this.network = networkEnum;
    this.dryRun = options.dryRun ?? false;
    this.apiOptions = { baseUrl: options.baseUrl, timeoutMs: options.timeoutMs };
    this.keypairService = new KeypairService(networkEnum);
    this.addressApiClient = new AddressApiClient(networkEnum, this.apiOptions);
    this.adnrApiClient = new AdnrApiClient(networkEnum, this.apiOptions);
    this.rawTransactionApiClient = new RawTransactionApiClient(networkEnum, this.apiOptions);
    this.transactionApiClient = new TransactionApiClient(networkEnum, this.apiOptions);
    this.vbtcV2ApiClient = new VbtcV2ApiClient(networkEnum, this.apiOptions);
  }

  // Keypairs
  public generatePrivateKey = (): string => {
    return this.keypairService.generatePrivateKey();
  };

  public generateMnemonic = (words: 12 | 24 = 12): string => {
    return this.keypairService.generateMnemonic(words);
  };

  public privateKeyFromEmailPassword = (email: string, password: string, index = 0): string => {
    return this.keypairService.privateKeyFromEmailPassword(email, password, index);
  };

  public privateKeyFromMneumonic = (mnemonic: string, index: number): string => {
    return this.keypairService.privateKeyFromMneumonic(mnemonic, index);
  };

  /** Correctly-spelled alias for privateKeyFromMneumonic (same derivation). */
  public privateKeyFromMnemonic = (mnemonic: string, index: number): string => {
    return this.keypairService.privateKeyFromMneumonic(mnemonic, index);
  };

  public publicFromPrivate = (privateKey: string): string => {
    return this.keypairService.publicFromPrivate(privateKey);
  };

  public addressFromPrivate = (privateKey: string): string => {
    return this.keypairService.addressFromPrivate(privateKey);
  };

  public getSignature = (message: string, privateKey: string): string => {
    return this.keypairService.getSignature(message, privateKey);
  };

  // Raw Transaction API
  public getHash = async (txData: Record<string, unknown>): Promise<string> => {
    return this.rawTransactionApiClient.getHash(txData);
  };

  // Explorer API
  public getAddressDetails = (address: string, opts: { strict?: boolean } = {}): Promise<VfxAddress | null> => {
    return this.addressApiClient.getAddressDetails(address, opts);
  };

  public domainAvailable = (domain: string, opts: { strict?: boolean } = {}): Promise<boolean> => {
    return this.addressApiClient.domainAvailable(domain, opts);
  };

  // Transactions
  public sendCoin = async (keypair: Keypair, toAddress: string, amount: number): Promise<string | null> => {
    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: toAddress,
      amount: amount,
      apiOptions: this.apiOptions,
    });
    return await txBuilder.process(this.dryRun);
  };

  public lookupDomain = async (domain: string, opts: { strict?: boolean } = {}): Promise<string | null> => {
    return this.addressApiClient.lookupDomain(domain, opts);
  };

  public lookupBtcDomain = async (domain: string): Promise<string | null> => {
    return this.adnrApiClient.lookupBtcDomain(domain);
  };

  public lookupBtcDomainFromBtcAddress = async (address: string): Promise<string | null> => {
    return this.adnrApiClient.lookupBtcDomainFromBtcAddress(address);
  };

  public buyVfxDomain = async (keypair: Keypair, domain: string): Promise<string | null> => {
    domain = cleanVfxDomain(domain);

    if (!isValidVfxDomain(domain)) {
      throw new Error(`Invalid vfx domain: ${domain}`);
    }

    // strict: an API outage must fail the purchase, not read as
    // "no domain yet / domain available".
    const addressDetails = await this.addressApiClient.getAddressDetails(keypair.address, { strict: true });
    if (addressDetails && addressDetails.adnr != null) {
      throw new Error(`Address already has a domain: ${addressDetails.adnr}`);
    }

    const available = await this.addressApiClient.domainAvailable(domain, { strict: true });

    if (!available) {
      throw new Error(`Domain already exists: ${domain}`);
    }

    const data = {
      Function: 'AdnrCreate()',
      Name: domainWithoutSuffix(domain),
    };

    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_PURCHASE_COST,
      txType: TxType.Adnr,
      data: data,
      apiOptions: this.apiOptions,
    });

    return await txBuilder.process(this.dryRun);
  };

  public buyBtcDomain = async (keypair: Keypair, domain: string, btcPrivateKey: string): Promise<string | null> => {
    domain = cleanBtcDomain(domain);

    if (!isValidBtcDomain(domain)) {
      throw new Error(`Invalid btc domain: ${domain}`);
    }

    // strict: an API outage must fail the purchase, not read as available.
    const available = await this.addressApiClient.domainAvailable(domain, { strict: true });

    if (!available) {
      throw new Error(`Domain already exists: ${domain}`);
    }

    const message = `${Math.floor((Date.now() / 1000))}`;
    const btcClient = new BtcClient(this.network);

    const signature = btcClient.getSignature(message, btcPrivateKey);
    const btcAccount = btcClient.addressFromPrivate(btcPrivateKey);

    const data = {
      Function: 'BTCAdnrCreate()',
      Name: domainWithoutSuffix(domain),
      BTCAddress: btcAccount.address,
      Message: message,
      Signature: signature
    };


    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_PURCHASE_COST,
      txType: TxType.Adnr,
      data: data,
      apiOptions: this.apiOptions,
    });

    return await txBuilder.process(this.dryRun);
  };

  public listTransactionsForAddress = async (
    address: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction> | null> => {
    return this.transactionApiClient.listTransactionsForAddress(address, page, limit);
  };

  // ---------------------------------------------------------------------------
  // vBTC V2
  // ---------------------------------------------------------------------------

  public listVbtcTokens = async (): Promise<VbtcV2Token[]> => {
    return this.vbtcV2ApiClient.listAllTokens();
  };

  public getVbtcTokens = async (address: string): Promise<VbtcV2Token[]> => {
    return this.vbtcV2ApiClient.getTokensForAddress(address);
  };

  public getVbtcTokenDetail = async (scIdentifier: string): Promise<VbtcV2Token> => {
    return this.vbtcV2ApiClient.getTokenDetail(scIdentifier);
  };

  public getVbtcTransfers = async (scIdentifier: string): Promise<VbtcTransfer[]> => {
    return this.vbtcV2ApiClient.getTransfers(scIdentifier);
  };

  public getVbtcWithdrawals = async (scIdentifier: string): Promise<VbtcWithdrawalRequest[]> => {
    return this.vbtcV2ApiClient.getWithdrawals(scIdentifier);
  };

  public transferVbtc = async (params: {
    scIdentifier: string;
    fromAddress: string;
    toAddress: string;
    amount: number;
    privateKey: string;
  }): Promise<VbtcTransferResult> => {
    this.assertNotDryRun('transferVbtc');
    const prepared = await this.vbtcV2ApiClient.prepareTransfer({
      sc_identifier: params.scIdentifier,
      from_address: params.fromAddress,
      to_address: params.toAddress,
      amount: params.amount,
    });
    this.assertPrepared(prepared, 'transferVbtc:prepare');

    const sent = await this.signAndSend(prepared, params.privateKey, (body) =>
      this.vbtcV2ApiClient.sendTransfer(body),
    );
    this.assertSent(sent, 'transferVbtc:send');

    return { transactionHash: sent.Hash };
  };

  public createVbtcToken = async (params: {
    ownerAddress: string;
    privateKey: string;
    name: string;
    description: string;
    ticker: string;
    onProgress?: (event: VbtcProgressEvent) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<CreateVbtcResult> => {
    this.assertNotDryRun('createVbtcToken');
    const onProgress = params.onProgress ?? (() => undefined);
    const pollIntervalMs = params.pollIntervalMs ?? 4000;
    const timeoutMs = params.timeoutMs ?? 3 * 60 * 1000;

    // Phase 1: MPC ceremony
    const ceremonyPrep = await this.vbtcV2ApiClient.prepareCeremony(params.ownerAddress);
    if (!ceremonyPrep?.success) {
      throw new Error(`createVbtcToken ceremony prepare failed: ${JSON.stringify(ceremonyPrep)}`);
    }

    const startSignature = this.keypairService.getSignature(
      ceremonyPrep.messages_to_sign.start_message,
      params.privateKey,
    );
    const shareSignature = this.keypairService.getSignature(
      ceremonyPrep.messages_to_sign.share_distribution_message,
      params.privateKey,
    );

    onProgress({
      phase: 'ceremony_started',
      message: 'MPC ceremony started',
      data: { ceremonyId: ceremonyPrep.ceremony_id },
    });

    const ceremonyExec = await this.vbtcV2ApiClient.executeCeremony({
      ceremony_id: ceremonyPrep.ceremony_id,
      session_id: ceremonyPrep.session_id,
      owner_address: params.ownerAddress,
      start_signature: startSignature,
      start_timestamp: ceremonyPrep.messages_to_sign.start_timestamp,
      share_distribution_signature: shareSignature,
      share_distribution_timestamp: ceremonyPrep.messages_to_sign.share_distribution_timestamp,
    });
    if (!ceremonyExec?.success) {
      throw new Error(`createVbtcToken ceremony execute failed: ${JSON.stringify(ceremonyExec)}`);
    }

    await this.pollUntilDone({
      getStatus: () => this.vbtcV2ApiClient.getCeremonyStatus(ceremonyPrep.ceremony_id),
      isDone: (s) => s?.status === 'Completed',
      isFailed: (s) => s?.status === 'Failed' || s?.success === false,
      onTick: (s) =>
        onProgress({
          phase: 'ceremony_polling',
          message: s?.message ?? `Ceremony status: ${s?.status}`,
          progress: typeof s?.progress === 'number' ? s.progress : undefined,
          data: s,
        }),
      intervalMs: pollIntervalMs,
      timeoutMs,
      label: 'ceremony',
    });

    onProgress({ phase: 'ceremony_complete', message: 'MPC ceremony complete' });

    // Phase 2: Contract creation
    const timestamp = Math.round(Date.now() / 1000);
    const uniqueId = generateRandomStringSecure(16, VBTC_UNIQUE_ID_CHARSET);
    const ownershipMessage = `${params.ownerAddress}${params.name}${params.description}${params.ticker}${ceremonyPrep.ceremony_id}${timestamp}${uniqueId}`;
    const ownerSignature = this.keypairService.getSignature(ownershipMessage, params.privateKey);

    onProgress({ phase: 'contract_preparing', message: 'Preparing contract create transaction' });

    const createPrep = await this.vbtcV2ApiClient.prepareCreate({
      owner_address: params.ownerAddress,
      name: params.name,
      description: params.description,
      ticker: params.ticker,
      ceremony_id: ceremonyPrep.ceremony_id,
      timestamp,
      unique_id: uniqueId,
      owner_signature: ownerSignature,
    });
    this.assertPrepared(createPrep, 'createVbtcToken:prepare');

    const sent = await this.signAndSend(createPrep, params.privateKey, (body) =>
      this.vbtcV2ApiClient.sendCreate(body),
    );
    this.assertSent(sent, 'createVbtcToken:send');

    onProgress({
      phase: 'contract_sent',
      message: 'Contract create transaction sent',
      data: { transactionHash: sent.Hash },
    });

    const scIdentifier = (createPrep.SmartContractUID as string | undefined) ?? '';
    const depositAddress = (createPrep.DepositAddress as string | undefined) ?? '';

    return {
      transactionHash: sent.Hash,
      scIdentifier,
      depositAddress,
    };
  };

  public requestWithdrawal = async (params: {
    scIdentifier: string;
    requestorAddress: string;
    btcAddress: string;
    amount: number;
    feeRate: number;
    privateKey: string;
    onProgress?: (event: VbtcProgressEvent) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('requestWithdrawal');
    const onProgress = params.onProgress ?? (() => undefined);

    // Step 1: Request (Type 27)
    const requestPrep = await this.vbtcV2ApiClient.prepareWithdrawRequest({
      sc_identifier: params.scIdentifier,
      requestor_address: params.requestorAddress,
      btc_address: params.btcAddress,
      amount: params.amount,
      fee_rate: params.feeRate,
    });
    this.assertPrepared(requestPrep, 'requestWithdrawal:request:prepare');

    const requestSent = await this.signAndSend(requestPrep, params.privateKey, (body) =>
      this.vbtcV2ApiClient.sendWithdrawRequest(body),
    );
    this.assertSent(requestSent, 'requestWithdrawal:request:send');

    const withdrawalRequestHash = requestSent.Hash;
    onProgress({
      phase: 'withdraw_request_sent',
      message: 'Withdrawal request submitted',
      data: { withdrawalRequestHash },
    });

    // Steps 2-4 are resumable: a crashed/failed session can re-drive them
    // for the same on-chain request via completeWithdrawal (the chain
    // refuses a NEW request while one is incomplete, so resume is the only
    // way forward for a stranded request).
    //
    // Resuming needs withdrawalRequestHash, and a caller that only ever sees
    // a rejected promise never receives it — the request is committed on
    // chain but its hash lives only in this frame. Carrying it on the error
    // is what keeps the resume path reachable.
    try {
      return await this.completeWithdrawal({ ...params, withdrawalRequestHash });
    } catch (error) {
      // A post-broadcast failure already carries the txid and the correct
      // (do-not-re-sign) recovery instruction. Re-wrapping it as merely
      // "incomplete" would tell the caller to resume via completeWithdrawal,
      // which is the one thing that can pay the destination twice.
      if (error instanceof VbtcWithdrawalUnrecordedError) throw error;
      throw new VbtcWithdrawalIncompleteError(withdrawalRequestHash, error);
    }
  };

  /**
   * Complete an EXISTING on-chain withdrawal request (Type 27 already
   * broadcast): FROST prepare/sign/execute, BTC broadcast, Type 28 record.
   *
   * Safe to call for a request whose first completion attempt died at any
   * point before the BTC broadcast — FROST sessions are per-call and the
   * node rejects double-completion of a completed request.
   */
  public completeWithdrawal = async (params: {
    scIdentifier: string;
    requestorAddress: string;
    withdrawalRequestHash: string;
    btcAddress: string;
    amount: number;
    feeRate: number;
    privateKey: string;
    onProgress?: (event: VbtcProgressEvent) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('completeWithdrawal');
    const onProgress = params.onProgress ?? (() => undefined);
    const pollIntervalMs = params.pollIntervalMs ?? 5000;
    const timeoutMs = params.timeoutMs ?? 3 * 60 * 1000;
    const withdrawalRequestHash = params.withdrawalRequestHash;

    // Step 2: Prepare FROST
    onProgress({ phase: 'frost_preparing', message: 'Preparing FROST signing ceremony' });

    const frostPrep = await this.vbtcV2ApiClient.prepareWithdrawComplete({
      sc_identifier: params.scIdentifier,
      withdrawal_request_hash: withdrawalRequestHash,
      owner_address: params.requestorAddress,
    });
    if (!frostPrep?.success) {
      throw new Error(`completeWithdrawal frost prepare failed: ${JSON.stringify(frostPrep)}`);
    }

    const frostStartSig = this.keypairService.getSignature(frostPrep.StartMessage, params.privateKey);
    const frostShareSig = this.keypairService.getSignature(frostPrep.ShareDistributionMessage, params.privateKey);

    // Step 3: Execute FROST + poll
    const frostExec = await this.vbtcV2ApiClient.executeWithdrawComplete({
      sc_identifier: params.scIdentifier,
      withdrawal_request_hash: withdrawalRequestHash,
      owner_address: params.requestorAddress,
      session_id: frostPrep.SessionId,
      start_signature: frostStartSig,
      start_timestamp: frostPrep.StartTimestamp,
      share_distribution_signature: frostShareSig,
      share_distribution_timestamp: frostPrep.ShareDistributionTimestamp,
      // Delegated params: the caller's REAL inputs, never frostPrep echoes.
      // This call races the node's processing of the Type 27 block (prepare
      // runs seconds after the request broadcast); when the node hasn't
      // recorded the request yet, prepare silently returns Amount=0 /
      // BTCDestination="" — echoing those turns a benign propagation race
      // into a hard "Withdrawal request not found" failure. Real delegated
      // values let the node build a transient request and proceed
      // (2026-06-12 first mainnet V2 withdrawal).
      amount: params.amount,
      btc_destination: params.btcAddress,
      fee_rate: params.feeRate,
    });
    if (!frostExec?.success || !frostExec.job_id) {
      throw new Error(`completeWithdrawal frost execute failed: ${JSON.stringify(frostExec)}`);
    }

    const frostFinal = await this.pollUntilDone({
      getStatus: () => this.vbtcV2ApiClient.getWithdrawCompleteStatus(frostExec.job_id),
      isDone: (s) => s?.success === true && (s as { status?: string }).status === 'complete',
      isFailed: (s) => s?.success === false || (s as { status?: string }).status === 'failed',
      onTick: (s) =>
        onProgress({
          phase: 'frost_polling',
          message: `FROST status: ${(s as { status?: string })?.status ?? 'pending'}`,
          data: s,
        }),
      intervalMs: pollIntervalMs,
      timeoutMs,
      label: 'frost',
      // The job is registered a moment after execute returns, so the first
      // polls can legitimately report failure for a job that does not exist
      // yet. Aborting on the first one strands a withdrawal whose ceremony was
      // about to start; the Flutter wallet rides out six for this reason.
      toleratedFailures: 6,
    });

    if (!('signed_btc_tx_hex' in frostFinal) || !frostFinal.signed_btc_tx_hex) {
      throw new Error(`completeWithdrawal frost completed without signed_btc_tx_hex: ${JSON.stringify(frostFinal)}`);
    }

    onProgress({ phase: 'frost_complete', message: 'FROST signing complete' });

    // Broadcast BTC tx.
    //
    // The two failure modes here are opposites and must not be collapsed:
    // a rejected broadcast leaves the coins untouched and is safe to re-drive,
    // while an accepted broadcast that returns no txid means the coins are
    // already gone and re-signing would risk a second payout.
    const broadcast = await this.vbtcV2ApiClient.broadcastBtc(frostFinal.signed_btc_tx_hex);
    if (!broadcast?.success) {
      throw new Error(`completeWithdrawal broadcast rejected: ${JSON.stringify(broadcast)}`);
    }
    if (!broadcast.txid) {
      throw new VbtcWithdrawalUnrecordedError(
        withdrawalRequestHash,
        null,
        new Error(`broadcast accepted without a txid: ${JSON.stringify(broadcast)}`),
      );
    }

    onProgress({
      phase: 'btc_broadcast',
      message: 'BTC transaction broadcast',
      data: { txid: broadcast.txid },
    });

    // Step 4: Record completion (Type 28).
    //
    // Past this point the BTC has left the vault, so a failure here is not the
    // same kind of failure as anything above it: the caller must record the
    // completion for the txid we already have, never re-run the ceremony.
    try {
      return await this.recordWithdrawalCompletion({
        scIdentifier: params.scIdentifier,
        requestorAddress: params.requestorAddress,
        withdrawalRequestHash,
        btcTransactionHash: broadcast.txid,
        // Caller's real values — frostPrep echoes are 0/"" when prepare raced
        // the node's processing of the Type 27 block (same trap as execute).
        amount: params.amount,
        btcDestination: params.btcAddress,
        privateKey: params.privateKey,
        onProgress,
      });
    } catch (error) {
      throw new VbtcWithdrawalUnrecordedError(withdrawalRequestHash, broadcast.txid, error);
    }
  };

  /**
   * Record an already-broadcast withdrawal on the VFX chain (Type 28) without
   * re-running FROST.
   *
   * This is the resume path for a withdrawal whose Bitcoin transaction went out
   * but whose completion was never recorded — the state that leaves BTC spent
   * and the vBTC still unburned. `completeWithdrawal` cannot be used to recover
   * it: that method restarts at the signing ceremony, and because UTXOs are
   * re-selected live and the validators' double-sign guard is in-memory (so a
   * validator restart or 24h clears it), a second ceremony can broadcast a
   * SECOND Bitcoin transaction and pay the destination twice.
   *
   * Requires only the values a caller already holds once the broadcast
   * succeeded — no ceremony session state — so it is safe to call from a fresh
   * process after a crash, reload, or device switch, provided the txid was
   * persisted.
   */
  public recordWithdrawalCompletion = async (params: {
    scIdentifier: string;
    requestorAddress: string;
    withdrawalRequestHash: string;
    btcTransactionHash: string;
    amount: number;
    btcDestination: string;
    privateKey: string;
    onProgress?: (event: VbtcProgressEvent) => void;
  }): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('recordWithdrawalCompletion');
    const onProgress = params.onProgress ?? (() => undefined);

    if (!params.btcTransactionHash) {
      throw new Error('recordWithdrawalCompletion requires the broadcast btcTransactionHash');
    }

    const completionPrep = await this.vbtcV2ApiClient.prepareWithdrawCompleteTx({
      sc_identifier: params.scIdentifier,
      from_address: params.requestorAddress,
      withdrawal_request_hash: params.withdrawalRequestHash,
      btc_transaction_hash: params.btcTransactionHash,
      amount: params.amount,
      btc_destination: params.btcDestination,
    });
    this.assertPrepared(completionPrep, 'recordWithdrawalCompletion:prepare');

    const completionSent = await this.signAndSend(completionPrep, params.privateKey, (body) =>
      this.vbtcV2ApiClient.sendWithdrawCompleteTx(body),
    );
    this.assertSent(completionSent, 'recordWithdrawalCompletion:send');

    onProgress({
      phase: 'completion_recorded',
      message: 'Withdrawal completion recorded on-chain',
      data: { completionTransactionHash: completionSent.Hash },
    });

    return {
      btcTransactionHash: params.btcTransactionHash,
      completionTransactionHash: completionSent.Hash,
      withdrawalRequestHash: params.withdrawalRequestHash,
    };
  };

  public cancelWithdrawal = async (params: {
    scIdentifier: string;
    ownerAddress: string;
    withdrawalRequestHash: string;
    privateKey: string;
  }): Promise<VbtcCancelResult> => {
    this.assertNotDryRun('cancelWithdrawal');
    const prepared = await this.vbtcV2ApiClient.prepareWithdrawCancel({
      sc_identifier: params.scIdentifier,
      owner_address: params.ownerAddress,
      withdrawal_request_hash: params.withdrawalRequestHash,
    });
    this.assertPrepared(prepared, 'cancelWithdrawal:prepare');

    const sent = await this.signAndSend(prepared, params.privateKey, (body) =>
      this.vbtcV2ApiClient.sendWithdrawCancel(body),
    );
    this.assertSent(sent, 'cancelWithdrawal:send');

    return { transactionHash: sent.Hash };
  };

  // -- Internal helpers --------------------------------------------------------

  private assertNotDryRun(label: string): void {
    // vBTC flows run MPC/FROST ceremonies and broadcast immediately — there
    // is no meaningful dry-run subset. Before v3.1.0 these methods silently
    // IGNORED dryRun and moved real funds; failing loudly is the safe fix.
    if (this.dryRun) {
      throw new Error(
        `${label} does not support dryRun mode: this flow signs and broadcasts real transactions. ` +
          'Construct the VfxClient without dryRun to use it.',
      );
    }
  }

  private assertPrepared(response: PreparedTransactionResponse | undefined, label: string): void {
    if (!response?.success || !response.Hash) {
      throw new Error(`${label} failed: ${JSON.stringify(response)}`);
    }
  }

  private assertSent(response: SentTransactionResponse | undefined, label: string): void {
    if (!response?.success || !response.Hash) {
      throw new Error(`${label} failed: ${JSON.stringify(response)}`);
    }
  }

  private async signAndSend(
    prepared: PreparedTransactionResponse,
    privateKey: string,
    sendFn: SendFn,
  ): Promise<SentTransactionResponse> {
    const hash = prepared.Hash;
    const signature = this.keypairService.getSignature(hash, privateKey);

    let publicKey = this.keypairService.publicFromPrivate(normalizePrivateKey(privateKey));
    if (publicKey.startsWith('04')) {
      publicKey = publicKey.substring(2);
    }

    return sendFn({ hash, signature, public_key: publicKey });
  }

  private async pollUntilDone<T>(opts: {
    getStatus: () => Promise<T>;
    isDone: (s: T) => boolean;
    isFailed: (s: T) => boolean;
    onTick?: (s: T) => void;
    intervalMs: number;
    timeoutMs: number;
    label: string;
    /**
     * Consecutive failed statuses to ride out before giving up. A job is not
     * queryable the instant it is created, so the first polls after submit can
     * report failure for a job that is merely not registered yet.
     */
    toleratedFailures?: number;
  }): Promise<T> {
    const deadline = Date.now() + opts.timeoutMs;
    const tolerated = opts.toleratedFailures ?? 0;
    let consecutiveFailures = 0;
    // Best-effort short initial delay so callers don't hammer the API immediately after submit.
    await sleep(Math.min(opts.intervalMs, 1500));

    while (Date.now() < deadline) {
      const status = await opts.getStatus();
      opts.onTick?.(status);

      if (opts.isFailed(status)) {
        consecutiveFailures += 1;
        if (consecutiveFailures > tolerated) {
          throw new Error(`${opts.label} polling failed: ${JSON.stringify(status)}`);
        }
      } else {
        // Only an uninterrupted run counts — a real failure after the job is
        // live must not be masked by earlier successful polls.
        consecutiveFailures = 0;
        if (opts.isDone(status)) {
          return status;
        }
      }

      await sleep(opts.intervalMs);
    }

    throw new Error(`${opts.label} polling timed out after ${opts.timeoutMs}ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
