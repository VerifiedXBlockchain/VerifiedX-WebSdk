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

export class VfxClient {
  private network: Network;
  private dryRun: boolean;
  private keypairService: KeypairService;
  private addressApiClient: AddressApiClient;
  private adnrApiClient: AdnrApiClient;
  private rawTransactionApiClient: RawTransactionApiClient;
  private transactionApiClient: TransactionApiClient;
  private vbtcV2ApiClient: VbtcV2ApiClient;

  constructor(network: Network | 'mainnet' | 'testnet', dryRun = false) {
    // Convert string literals to Network enum values
    const networkEnum = typeof network === 'string'
      ? (network === 'mainnet' ? Network.Mainnet : Network.Testnet)
      : network;

    this.network = networkEnum;
    this.dryRun = dryRun;
    this.keypairService = new KeypairService(networkEnum);
    this.addressApiClient = new AddressApiClient(networkEnum);
    this.adnrApiClient = new AdnrApiClient(networkEnum);
    this.rawTransactionApiClient = new RawTransactionApiClient(networkEnum);
    this.transactionApiClient = new TransactionApiClient(networkEnum);
    this.vbtcV2ApiClient = new VbtcV2ApiClient(networkEnum);
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
  public getAddressDetails = (address: string): Promise<VfxAddress | null> => {
    return this.addressApiClient.getAddressDetails(address);
  };

  public domainAvailable = (domain: string): Promise<boolean> => {
    return this.addressApiClient.domainAvailable(domain);
  };

  // Transactions
  public sendCoin = async (keypair: Keypair, toAddress: string, amount: number): Promise<string | null> => {
    const txBuilder = new RawTransactionService({
      network: this.network,
      keypair: keypair,
      toAddress: toAddress,
      amount: amount,
    });
    return await txBuilder.process(this.dryRun);
  };

  public lookupDomain = async (domain: string): Promise<string | null> => {
    return this.addressApiClient.lookupDomain(domain);
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

    const addressApiClient = new AddressApiClient(this.network);

    const addressDetails = await addressApiClient.getAddressDetails(keypair.address);
    if (addressDetails && addressDetails.adnr != null) {
      throw new Error(`Address already has a domain: ${addressDetails.adnr}`);
    }

    const available = await addressApiClient.domainAvailable(domain);

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
    });

    return await txBuilder.process(this.dryRun);
  };

  public buyBtcDomain = async (keypair: Keypair, domain: string, btcPrivateKey: string): Promise<string | null> => {
    domain = cleanBtcDomain(domain);

    if (!isValidBtcDomain(domain)) {
      throw new Error(`Invalid btc domain: ${domain}`);
    }

    const addressApiClient = new AddressApiClient(this.network);

    const available = await addressApiClient.domainAvailable(domain);

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
    const onProgress = params.onProgress ?? (() => undefined);
    const pollIntervalMs = params.pollIntervalMs ?? 5000;
    const timeoutMs = params.timeoutMs ?? 3 * 60 * 1000;

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

    // Step 2: Prepare FROST
    onProgress({ phase: 'frost_preparing', message: 'Preparing FROST signing ceremony' });

    const frostPrep = await this.vbtcV2ApiClient.prepareWithdrawComplete({
      sc_identifier: params.scIdentifier,
      withdrawal_request_hash: withdrawalRequestHash,
      owner_address: params.requestorAddress,
    });
    if (!frostPrep?.success) {
      throw new Error(`requestWithdrawal frost prepare failed: ${JSON.stringify(frostPrep)}`);
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
      amount: frostPrep.Amount,
      btc_destination: frostPrep.BTCDestination,
      fee_rate: frostPrep.FeeRate,
    });
    if (!frostExec?.success || !frostExec.job_id) {
      throw new Error(`requestWithdrawal frost execute failed: ${JSON.stringify(frostExec)}`);
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
    });

    if (!('signed_btc_tx_hex' in frostFinal) || !frostFinal.signed_btc_tx_hex) {
      throw new Error(`requestWithdrawal frost completed without signed_btc_tx_hex: ${JSON.stringify(frostFinal)}`);
    }

    onProgress({ phase: 'frost_complete', message: 'FROST signing complete' });

    // Broadcast BTC tx
    const broadcast = await this.vbtcV2ApiClient.broadcastBtc(frostFinal.signed_btc_tx_hex);
    if (!broadcast?.success || !broadcast.txid) {
      throw new Error(`requestWithdrawal broadcast failed: ${JSON.stringify(broadcast)}`);
    }

    onProgress({
      phase: 'btc_broadcast',
      message: 'BTC transaction broadcast',
      data: { txid: broadcast.txid },
    });

    // Step 4: Record completion (Type 28)
    const completionPrep = await this.vbtcV2ApiClient.prepareWithdrawCompleteTx({
      sc_identifier: params.scIdentifier,
      from_address: params.requestorAddress,
      withdrawal_request_hash: withdrawalRequestHash,
      btc_transaction_hash: broadcast.txid,
      amount: frostPrep.Amount,
      btc_destination: frostPrep.BTCDestination,
    });
    this.assertPrepared(completionPrep, 'requestWithdrawal:completion:prepare');

    const completionSent = await this.signAndSend(completionPrep, params.privateKey, (body) =>
      this.vbtcV2ApiClient.sendWithdrawCompleteTx(body),
    );
    this.assertSent(completionSent, 'requestWithdrawal:completion:send');

    onProgress({
      phase: 'completion_recorded',
      message: 'Withdrawal completion recorded on-chain',
      data: { completionTransactionHash: completionSent.Hash },
    });

    return {
      btcTransactionHash: broadcast.txid,
      completionTransactionHash: completionSent.Hash,
      withdrawalRequestHash,
    };
  };

  public cancelWithdrawal = async (params: {
    scIdentifier: string;
    ownerAddress: string;
    withdrawalRequestHash: string;
    privateKey: string;
  }): Promise<VbtcCancelResult> => {
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
  }): Promise<T> {
    const deadline = Date.now() + opts.timeoutMs;
    // Best-effort short initial delay so callers don't hammer the API immediately after submit.
    await sleep(Math.min(opts.intervalMs, 1500));

    while (Date.now() < deadline) {
      const status = await opts.getStatus();
      opts.onTick?.(status);

      if (opts.isFailed(status)) {
        throw new Error(`${opts.label} polling failed: ${JSON.stringify(status)}`);
      }
      if (opts.isDone(status)) {
        return status;
      }

      await sleep(opts.intervalMs);
    }

    throw new Error(`${opts.label} polling timed out after ${opts.timeoutMs}ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
