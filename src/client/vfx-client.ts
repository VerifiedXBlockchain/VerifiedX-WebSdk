import BtcClient from '../btc';
import {
  DOMAIN_DELETE_COST,
  DOMAIN_PURCHASE_COST,
  DOMAIN_TRANSFER_COST,
  Network,
  RESERVE_ACTIVATION_COST,
  RESERVE_ADDRESS_PREFIX,
  RESERVE_BASE_ADDRESS,
  RESERVE_MIN_UNLOCK_HOURS,
  TOKEN_BASE_ADDRESS,
  TxType,
} from '../constants';
import KeypairService from '../services/keypair-service';
import { RawTransactionService } from '../services/raw-transaction-service';
import {
  TokenTxData,
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
import { KeypairOrSigner, ResolvedSigner, Signer, resolveSigner } from '../signer';
import { VbtcAllocationInput, allocateVbtcInputs, vbtcMultiTransferData } from '../services/vbtc-multi';
import {
  CreateVbtcResult,
  DeployTokenParams,
  DeployTokenResult,
  FungibleToken,
  FungibleTokenBalance,
  FungibleTokenDetail,
  PaginatedResponse,
  ReserveKeypair,
  TokenVotingTopic,
  Transaction,
  VbtcCancelResult,
  VbtcMultiTransferResult,
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
} from '../utils';
import { AddressApiClient } from './address-api-client';
import { AdnrApiClient } from './adnr-client';
import { BlockApiClient } from './block-api-client';
import { RawTransactionApiClient } from './raw-transaction-api-client';
import { TokenApiClient } from './token-api-client';
import { TransactionApiClient } from './transaction-api.client';
import { PreparedTransactionResponse, SentTransactionResponse, VbtcV2ApiClient } from './vbtc-v2-api-client';

type SendFn = (body: { hash: string; signature: string; public_key: string }) => Promise<SentTransactionResponse>;

/** The network refuses domain operations and multi-contract vBTC transfers from a reserve (xRBX) account. */
function assertNotReserveSender(signer: ResolvedSigner, label: string): void {
  if (signer.address.startsWith(RESERVE_ADDRESS_PREFIX)) {
    throw new Error(
      `${label} cannot be sent from a reserve account; the network only allows it from an ordinary account`,
    );
  }
}

/**
 * Accepted by every method that can be signed from a reserve (vault) account.
 * Ignored for ordinary accounts, where it is an error to set it.
 */
export interface ReserveSendOptions {
  /**
   * Hours until the transaction settles when sent from a reserve (xRBX)
   * account. Defaults to 24, the network minimum; during that window the
   * sender can call it back. Setting it from an ordinary account is an error.
   */
  unlockHours?: number;
}

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
  private tokenApiClient: TokenApiClient;
  private blockApiClient: BlockApiClient;

  /**
   * @param network 'mainnet' | 'testnet' (or the Network enum)
   * @param dryRunOrOptions boolean dryRun (historical signature) or a
   *   VfxClientOptions object: new VfxClient('testnet', { baseUrl: '...' })
   */
  constructor(network: Network | 'mainnet' | 'testnet', dryRunOrOptions: boolean | VfxClientOptions = false) {
    // Convert string literals to Network enum values
    const networkEnum =
      typeof network === 'string' ? (network === 'mainnet' ? Network.Mainnet : Network.Testnet) : network;

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
    this.tokenApiClient = new TokenApiClient(networkEnum, this.apiOptions);
    this.blockApiClient = new BlockApiClient(networkEnum, this.apiOptions);
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

  /**
   * Derive the network address for an uncompressed secp256k1 public key. This
   * is how the address of an external signer (HSM, MPC) is obtained: the SDK
   * never needs the private key.
   */
  public addressFromPublic = (publicKeyHex: string): string => {
    return this.keypairService.addressFromPublic(publicKeyHex);
  };

  // Reserve (Vault) account keys — see KeypairService for the derivation.

  /** The vault the web wallet pairs with this main private key. */
  public reserveKeypairFromPrivateKey = (mainPrivateKey: string): ReserveKeypair => {
    return this.keypairService.reserveKeypairFromPrivateKey(mainPrivateKey);
  };

  /** A vault from its own private key; the recovery key is derived from it. */
  public reserveKeypairFromReservePrivateKey = (reservePrivateKey: string): ReserveKeypair => {
    return this.keypairService.reserveKeypairFromReservePrivateKey(reservePrivateKey);
  };

  /** Restore a vault from the CLI / web wallet restore code. */
  public reserveKeypairFromRestoreCode = (restoreCode: string): ReserveKeypair => {
    return this.keypairService.reserveKeypairFromRestoreCode(restoreCode);
  };

  /** A standalone vault on a fresh key, not tied to a main account. */
  public generateReserveKeypair = (): ReserveKeypair => {
    return this.keypairService.generateReserveKeypair();
  };

  /** The xRBX address for a public key — how an HSM-held vault key's address is obtained. */
  public reserveAddressFromPublic = (publicKeyHex: string): string => {
    return this.keypairService.reserveAddressFromPublic(publicKeyHex);
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
  /**
   * Send VFX. From a reserve (vault) account the send waits `unlockHours`
   * (default 24) before settling and can be called back in the meantime.
   */
  public sendCoin = async (
    keypair: KeypairOrSigner,
    toAddress: string,
    amount: number,
    options: ReserveSendOptions = {},
  ): Promise<string | null> => {
    const signer = this.resolve(keypair);
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: toAddress,
      amount: amount,
      unlockTime: this.unlockTimeFor(signer, options.unlockHours),
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

  public buyVfxDomain = async (keypair: KeypairOrSigner, domain: string): Promise<string | null> => {
    domain = cleanVfxDomain(domain);

    if (!isValidVfxDomain(domain)) {
      throw new Error(`Invalid vfx domain: ${domain}`);
    }

    const signer = this.resolve(keypair);
    this.assertNotReserve(signer, 'buyVfxDomain');

    // strict: an API outage must fail the purchase, not read as
    // "no domain yet / domain available".
    const addressDetails = await this.addressApiClient.getAddressDetails(signer.address, { strict: true });
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
      signer,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_PURCHASE_COST,
      txType: TxType.Adnr,
      data: data,
      apiOptions: this.apiOptions,
    });

    return await txBuilder.process(this.dryRun);
  };

  public buyBtcDomain = async (
    keypair: KeypairOrSigner,
    domain: string,
    btcPrivateKey: string,
  ): Promise<string | null> => {
    domain = cleanBtcDomain(domain);

    if (!isValidBtcDomain(domain)) {
      throw new Error(`Invalid btc domain: ${domain}`);
    }
    this.assertNotReserve(this.resolve(keypair), 'buyBtcDomain');

    // strict: an API outage must fail the purchase, not read as available.
    const available = await this.addressApiClient.domainAvailable(domain, { strict: true });

    if (!available) {
      throw new Error(`Domain already exists: ${domain}`);
    }

    const message = `${Math.floor(Date.now() / 1000)}`;
    const btcClient = new BtcClient(this.network);

    const signature = btcClient.getSignature(message, btcPrivateKey);
    const btcAccount = btcClient.addressFromPrivate(btcPrivateKey);

    const data = {
      Function: 'BTCAdnrCreate()',
      Name: domainWithoutSuffix(domain),
      BTCAddress: btcAccount.address,
      Message: message,
      Signature: signature,
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

  /**
   * Hand the signer's .vfx domain to `toAddress`. Costs 5 VFX. The sender
   * must own a domain and the recipient must not; both are checked against
   * Spyglass first (strictly — an outage fails the call rather than reading
   * as "no domain").
   */
  public transferVfxDomain = async (keypair: KeypairOrSigner, toAddress: string): Promise<string | null> => {
    const signer = this.resolve(keypair);
    assertNotReserveSender(signer, 'transferVfxDomain');
    if (!toAddress || toAddress === signer.address) {
      throw new Error('transferVfxDomain requires a recipient other than the sender');
    }

    const domain = await this.ownedVfxDomain(signer.address, 'transferVfxDomain');
    const recipient = await this.addressApiClient.getAddressDetails(toAddress, { strict: true });
    if (recipient?.adnr) {
      throw new Error(`Recipient already has a domain: ${recipient.adnr}`);
    }

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress,
      amount: DOMAIN_TRANSFER_COST,
      txType: TxType.Adnr,
      data: { Function: 'AdnrTransfer()', Name: domain },
      apiOptions: this.apiOptions,
    });
    return txBuilder.process(this.dryRun);
  };

  /** Release the signer's .vfx domain. Costs 5 VFX. */
  public deleteVfxDomain = async (keypair: KeypairOrSigner): Promise<string | null> => {
    const signer = this.resolve(keypair);
    assertNotReserveSender(signer, 'deleteVfxDomain');
    const domain = await this.ownedVfxDomain(signer.address, 'deleteVfxDomain');

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_DELETE_COST,
      txType: TxType.Adnr,
      data: { Function: 'AdnrDelete()', Name: domain },
      apiOptions: this.apiOptions,
    });
    return txBuilder.process(this.dryRun);
  };

  /**
   * Move a .btc domain to another Bitcoin address, managed by `vfxToAddress`
   * from then on. Costs 5 VFX. The signer must be the VFX account that
   * currently manages the domain for `btcFromAddress`; the node checks that
   * pairing and that `btcToAddress` has no domain.
   */
  public transferBtcDomain = async (
    keypair: KeypairOrSigner,
    params: { btcFromAddress: string; btcToAddress: string; vfxToAddress: string },
  ): Promise<string | null> => {
    const signer = this.resolve(keypair);
    assertNotReserveSender(signer, 'transferBtcDomain');
    if (!params.btcFromAddress || !params.btcToAddress || !params.vfxToAddress) {
      throw new Error('transferBtcDomain requires btcFromAddress, btcToAddress and vfxToAddress');
    }

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: params.vfxToAddress,
      amount: DOMAIN_TRANSFER_COST,
      txType: TxType.Adnr,
      data: {
        Function: 'BTCAdnrTransfer()',
        BTCToAddress: params.btcToAddress,
        BTCFromAddress: params.btcFromAddress,
      },
      apiOptions: this.apiOptions,
    });
    return txBuilder.process(this.dryRun);
  };

  /** Release the .btc domain on `btcFromAddress`, managed by the signer. Costs 5 VFX. */
  public deleteBtcDomain = async (
    keypair: KeypairOrSigner,
    params: { btcFromAddress: string },
  ): Promise<string | null> => {
    const signer = this.resolve(keypair);
    assertNotReserveSender(signer, 'deleteBtcDomain');
    if (!params.btcFromAddress) {
      throw new Error('deleteBtcDomain requires btcFromAddress');
    }

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: 'Adnr_Base',
      amount: DOMAIN_DELETE_COST,
      txType: TxType.Adnr,
      data: { Function: 'BTCAdnrDelete()', BTCFromAddress: params.btcFromAddress },
      apiOptions: this.apiOptions,
    });
    return txBuilder.process(this.dryRun);
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
    /** Local key to sign with. Pass either this or `signer`. */
    privateKey?: string;
    /** External signer (HSM, MPC) to sign with instead of a local key. */
    signer?: Signer;
  }): Promise<VbtcTransferResult> => {
    this.assertNotDryRun('transferVbtc');
    const signer = this.signerFor(params, 'transferVbtc');
    const prepared = await this.vbtcV2ApiClient.prepareTransfer({
      sc_identifier: params.scIdentifier,
      from_address: params.fromAddress,
      to_address: params.toAddress,
      amount: params.amount,
    });
    this.assertPrepared(prepared, 'transferVbtc:prepare');

    const sent = await this.signAndSend(prepared, signer, (body) => this.vbtcV2ApiClient.sendTransfer(body));
    this.assertSent(sent, 'transferVbtc:send');

    return { transactionHash: sent.Hash };
  };

  /**
   * Send `totalAmount` vBTC to `toAddress` drawn from every V2 contract the
   * signer holds spendable balance on, as one transaction. Inputs are chosen
   * with the CLI's own rule (largest balance first, greedy, whole satoshis)
   * unless `inputs` is given. A transfer that a single contract can cover goes
   * through the ordinary `transferVbtc` path instead, exactly as the wallet
   * does. Not available from a reserve account, and capped at 25 contracts.
   */
  public transferVbtcMulti = async (params: {
    toAddress: string;
    totalAmount: number;
    privateKey?: string;
    signer?: Signer;
    /** Skip the balance lookup and allocation: the exact contracts and amounts to draw. */
    inputs?: VbtcAllocationInput[];
  }): Promise<VbtcMultiTransferResult> => {
    this.assertNotDryRun('transferVbtcMulti');
    const signer = this.signerFor(params, 'transferVbtcMulti');
    assertNotReserveSender(signer, 'transferVbtcMulti');
    if (!(params.totalAmount > 0)) {
      throw new Error('transferVbtcMulti requires a positive totalAmount');
    }

    let inputs = params.inputs;
    if (!inputs) {
      const tokens = await this.vbtcV2ApiClient.getTokensForAddress(signer.address);
      const balances: Record<string, number> = {};
      for (const token of tokens) {
        balances[token.sc_identifier] =
          token.available_balances?.[signer.address] ?? token.addresses?.[signer.address] ?? 0;
      }
      const allocation = allocateVbtcInputs(balances, params.totalAmount);
      if (allocation.failure === 'insufficientBalance') {
        throw new Error(
          `Insufficient vBTC: ${allocation.available} available across ${Object.keys(balances).length} contracts, ${
            params.totalAmount
          } requested`,
        );
      }
      if (allocation.failure === 'tooManyInputs') {
        throw new Error(`Sending ${params.totalAmount} vBTC would need more than the maximum contract inputs`);
      }
      inputs = allocation.inputs;
    }

    if (inputs.length === 1) {
      const single = inputs[0];
      const sent = await this.transferVbtc({
        scIdentifier: single.scIdentifier,
        fromAddress: signer.address,
        toAddress: params.toAddress,
        amount: single.amount,
        privateKey: params.privateKey,
        signer: params.signer,
      });
      return { transactionHash: sent.transactionHash, inputs };
    }

    const data = vbtcMultiTransferData({
      fromAddress: signer.address,
      toAddress: params.toAddress,
      totalAmount: params.totalAmount,
      inputs,
    });
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: params.toAddress,
      amount: 0,
      txType: TxType.VbtcV2Transfer,
      data,
      apiOptions: this.apiOptions,
    });
    const transactionHash = await txBuilder.process(false);
    if (!transactionHash) {
      throw new Error('transferVbtcMulti: the transaction was rejected before it reached the node');
    }
    return { transactionHash, inputs };
  };

  public createVbtcToken = async (params: {
    ownerAddress: string;
    /** Local key to sign with. Pass either this or `signer`. */
    privateKey?: string;
    /** External signer (HSM, MPC) to sign with instead of a local key. */
    signer?: Signer;
    name: string;
    description: string;
    ticker: string;
    onProgress?: (event: VbtcProgressEvent) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<CreateVbtcResult> => {
    this.assertNotDryRun('createVbtcToken');
    const signer = this.signerFor(params, 'createVbtcToken');
    const onProgress = params.onProgress ?? (() => undefined);
    const pollIntervalMs = params.pollIntervalMs ?? 4000;
    const timeoutMs = params.timeoutMs ?? 3 * 60 * 1000;

    // Phase 1: MPC ceremony
    const ceremonyPrep = await this.vbtcV2ApiClient.prepareCeremony(params.ownerAddress);
    if (!ceremonyPrep?.success) {
      throw new Error(`createVbtcToken ceremony prepare failed: ${JSON.stringify(ceremonyPrep)}`);
    }

    const startSignature = await signer.sign(ceremonyPrep.messages_to_sign.start_message);
    const shareSignature = await signer.sign(ceremonyPrep.messages_to_sign.share_distribution_message);

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
    const ownerSignature = await signer.sign(ownershipMessage);

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

    const sent = await this.signAndSend(createPrep, signer, (body) => this.vbtcV2ApiClient.sendCreate(body));
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
    /** Local key to sign with. Pass either this or `signer`. */
    privateKey?: string;
    /** External signer (HSM, MPC) to sign with instead of a local key. */
    signer?: Signer;
    onProgress?: (event: VbtcProgressEvent) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('requestWithdrawal');
    const signer = this.signerFor(params, 'requestWithdrawal');
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

    const requestSent = await this.signAndSend(requestPrep, signer, (body) =>
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
    /** Local key to sign with. Pass either this or `signer`. */
    privateKey?: string;
    /** External signer (HSM, MPC) to sign with instead of a local key. */
    signer?: Signer;
    onProgress?: (event: VbtcProgressEvent) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('completeWithdrawal');
    const signer = this.signerFor(params, 'completeWithdrawal');
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

    const frostStartSig = await signer.sign(frostPrep.StartMessage);
    const frostShareSig = await signer.sign(frostPrep.ShareDistributionMessage);

    // Multi-input withdrawals (caster-upgrade nodes) return one start message
    // per vault UTXO. StartMessages[0] is byte-identical to the legacy
    // StartMessage and is already covered by frostStartSig; every later entry
    // is signed verbatim — the validators verify the exact Message strings the
    // node returned, so they must never be reconstructed locally. Signing
    // fewer inputs than the transaction needs fails Execute with
    // InputCountMismatch (retryable via a fresh prepare).
    const extraStartSignatures: Array<{ input_index: number; signature: string }> = [];
    for (const entry of frostPrep.StartMessages ?? []) {
      if (entry.InputIndex > 0) {
        extraStartSignatures.push({ input_index: entry.InputIndex, signature: await signer.sign(entry.Message) });
      }
    }

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
      // Omitted for single-input withdrawals: the payload stays byte-identical
      // to what pre-multi-input Spyglass/node versions expect.
      ...(extraStartSignatures.length > 0 ? { start_signatures: extraStartSignatures } : {}),
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

    // The failed-status diagnostics (failure_code, retryable, ...) ride on
    // the polled status object; captured here so the thrown error can say
    // whether retrying is worthwhile instead of just dumping JSON.
    let lastFrostFailure: { failure_code?: string | null; retryable?: boolean | null } | undefined;

    let frostFinal;
    try {
      frostFinal = await this.pollUntilDone({
        getStatus: () => this.vbtcV2ApiClient.getWithdrawCompleteStatus(frostExec.job_id),
        isDone: (s) => s?.success === true && (s as { status?: string }).status === 'complete',
        isFailed: (s) => {
          const failed = s?.success === false || (s as { status?: string }).status === 'failed';
          if (failed && (s as { status?: string }).status === 'failed') {
            lastFrostFailure = s as { failure_code?: string | null; retryable?: boolean | null };
          }
          return failed;
        },
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
    } catch (e) {
      if (lastFrostFailure?.retryable === true) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `${detail} — FailureCode ${lastFrostFailure.failure_code ?? 'unknown'} is transient: ` +
            `wait ~60 seconds (validator-side cooldown), then call completeWithdrawal again. ` +
            `Each retry runs a fresh ceremony; old sessions are never reused.`,
        );
      }
      throw e;
    }

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
        signer: params.signer,
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
    /** Local key to sign with. Pass either this or `signer`. */
    privateKey?: string;
    /** External signer (HSM, MPC) to sign with instead of a local key. */
    signer?: Signer;
    onProgress?: (event: VbtcProgressEvent) => void;
  }): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('recordWithdrawalCompletion');
    const signer = this.signerFor(params, 'recordWithdrawalCompletion');
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

    const completionSent = await this.signAndSend(completionPrep, signer, (body) =>
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
    /** Local key to sign with. Pass either this or `signer`. */
    privateKey?: string;
    /** External signer (HSM, MPC) to sign with instead of a local key. */
    signer?: Signer;
  }): Promise<VbtcCancelResult> => {
    this.assertNotDryRun('cancelWithdrawal');
    const signer = this.signerFor(params, 'cancelWithdrawal');
    const prepared = await this.vbtcV2ApiClient.prepareWithdrawCancel({
      sc_identifier: params.scIdentifier,
      owner_address: params.ownerAddress,
      withdrawal_request_hash: params.withdrawalRequestHash,
    });
    this.assertPrepared(prepared, 'cancelWithdrawal:prepare');

    const sent = await this.signAndSend(prepared, signer, (body) => this.vbtcV2ApiClient.sendWithdrawCancel(body));
    this.assertSent(sent, 'cancelWithdrawal:send');

    return { transactionHash: sent.Hash };
  };

  // ---------------------------------------------------------------------------
  // Fungible tokens (VFX20)
  //
  // Every mutating method returns the transaction hash, or null when the
  // transaction never reached the node (same contract as sendCoin), and
  // honours dryRun. The signer's address is the token-side FromAddress: the
  // owner for mint / pause / ban / ownership change / topic creation, the
  // holder for transfer / burn / vote.
  // ---------------------------------------------------------------------------

  public listFungibleTokens = async (page = 1, limit = 10): Promise<PaginatedResponse<FungibleToken>> => {
    return this.tokenApiClient.listTokens(page, limit);
  };

  public getFungibleToken = async (scIdentifier: string): Promise<FungibleTokenDetail> => {
    return this.tokenApiClient.getToken(scIdentifier);
  };

  public getFungibleTokenBalances = async (address: string): Promise<FungibleTokenBalance[]> => {
    return this.addressApiClient.getTokenBalances(address);
  };

  public listTokenVotingTopics = async (
    scIdentifier: string,
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<TokenVotingTopic>> => {
    return this.tokenApiClient.listVotingTopics(scIdentifier, page, limit);
  };

  public getTokenVotingTopic = async (topicId: string): Promise<TokenVotingTopic> => {
    return this.tokenApiClient.getVotingTopic(topicId);
  };

  /**
   * Deploy a fungible token contract owned by the signer. The payload is
   * compiled on the node (via Spyglass), and the resulting Type 17 deploy is
   * sent from the signer's address to itself. The contract id is known before
   * the send, so it is returned even in dryRun.
   */
  public deployToken = async (
    signer: KeypairOrSigner,
    params: DeployTokenParams,
  ): Promise<DeployTokenResult | null> => {
    const resolved = this.resolve(signer);
    this.assertNotReserve(resolved, 'deployToken');
    const payload = tokenDeployPayload({ ...params, minterAddress: resolved.address });
    const data = await this.rawTransactionApiClient.getSmartContractDeployData(payload);
    const scIdentifier = data[0].ContractUID as string;

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer: resolved,
      toAddress: resolved.address,
      amount: 0,
      txType: TxType.TokenDeploy,
      data,
      apiOptions: this.apiOptions,
    });
    const transactionHash = await txBuilder.process(this.dryRun);
    return transactionHash ? { transactionHash, scIdentifier } : null;
  };

  /** Owner only; the token must be mintable. Tokens are credited to the signer. */
  public mintToken = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; amount: number; ticker?: string; name?: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const identity = await this.tokenIdentity(params);
    const data = tokenMintData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      amount: params.amount,
      ...identity,
    });
    return this.sendTokenTx(resolved, TOKEN_BASE_ADDRESS, data, params.unlockHours);
  };

  public transferToken = async (
    signer: KeypairOrSigner,
    params: {
      scIdentifier: string;
      toAddress: string;
      amount: number;
      ticker?: string;
      name?: string;
    } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const identity = await this.tokenIdentity(params);
    const data = tokenTransferData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      toAddress: params.toAddress,
      amount: params.amount,
      ...identity,
    });
    return this.sendTokenTx(resolved, params.toAddress, data, params.unlockHours);
  };

  /** Burns from the signer's own balance; the token must be burnable. */
  public burnToken = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; amount: number; ticker?: string; name?: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const identity = await this.tokenIdentity(params);
    const data = tokenBurnData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      amount: params.amount,
      ...identity,
    });
    return this.sendTokenTx(resolved, TOKEN_BASE_ADDRESS, data, params.unlockHours);
  };

  /**
   * Owner only. Flips the token between paused (no transfers) and active.
   * The node toggles whatever the current state is — there is no way to
   * "set paused" — so never send this twice for one intended change: the
   * second one undoes the first. The current state is read from Spyglass so
   * the transaction carries the state it produces, which is what explorers
   * and wallets display.
   */
  public toggleTokenPause = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const { token } = await this.getFungibleToken(params.scIdentifier);
    const data = tokenPauseData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      pause: !token.is_paused,
    });
    return this.sendTokenTx(resolved, TOKEN_BASE_ADDRESS, data, params.unlockHours);
  };

  /**
   * Owner only. Stops `address` from sending the token. It can still receive,
   * and the network has no way to lift a ban, so treat this as permanent.
   */
  public banTokenAddress = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; address: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const data = tokenBanAddressData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      banAddress: params.address,
    });
    return this.sendTokenTx(resolved, TOKEN_BASE_ADDRESS, data, params.unlockHours);
  };

  /** Owner only. Hands the owner role (mint, pause, ban, topics) to `toAddress`. */
  public transferTokenOwnership = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; toAddress: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const data = tokenOwnerChangeData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      toAddress: params.toAddress,
    });
    return this.sendTokenTx(resolved, params.toAddress, data, params.unlockHours);
  };

  /**
   * Owner only; the token must have voting enabled. Opens a yes/no topic that
   * holders can vote on for `votingDays` days. The topic is anchored to the
   * current block height, fetched from Spyglass unless `blockHeight` is given.
   */
  public createTokenVoteTopic = async (
    signer: KeypairOrSigner,
    params: {
      scIdentifier: string;
      name: string;
      description: string;
      votingDays: number;
      minimumVoteRequirement: number;
      blockHeight?: number;
    } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    if (!Number.isInteger(params.votingDays) || params.votingDays < 1) {
      throw new Error('votingDays must be a whole number of days, at least 1');
    }
    const blockHeight = params.blockHeight ?? (await this.blockApiClient.getLatestHeight());
    const createdAt = Math.round(Date.now() / 1000);
    const data = tokenVoteTopicCreateData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      topicUid: `${generateRandomStringSecure(8, VBTC_UNIQUE_ID_CHARSET)}${createdAt}`,
      name: params.name,
      description: params.description,
      minimumVoteRequirement: params.minimumVoteRequirement,
      blockHeight,
      createdAt,
      votingEndsAt: createdAt + params.votingDays * 24 * 60 * 60,
    });
    return this.sendTokenTx(resolved, TOKEN_BASE_ADDRESS, data, params.unlockHours);
  };

  /**
   * Cast the signer's vote on a topic. The transaction is addressed to the
   * token owner, looked up from Spyglass unless `ownerAddress` is given.
   */
  public castTokenVote = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; topicUid: string; vote: boolean; ownerAddress?: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const ownerAddress =
      params.ownerAddress ?? (await this.tokenApiClient.getToken(params.scIdentifier)).token.owner_address;
    const data = tokenVoteCastData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      topicUid: params.topicUid,
      vote: params.vote,
    });
    return this.sendTokenTx(resolved, ownerAddress, data, params.unlockHours);
  };

  // -- Internal helpers --------------------------------------------------------

  /**
   * Ticker and name travel in every token transaction for indexers and
   * wallets. Callers that know them skip a round-trip; otherwise they are read
   * from Spyglass.
   */
  private async tokenIdentity(params: {
    scIdentifier: string;
    ticker?: string;
    name?: string;
  }): Promise<{ ticker: string; name: string }> {
    if (params.ticker && params.name) {
      return { ticker: params.ticker, name: params.name };
    }
    const detail = await this.tokenApiClient.getToken(params.scIdentifier);
    return { ticker: params.ticker ?? detail.token.ticker, name: params.name ?? detail.token.name };
  }

  private async sendTokenTx(
    signer: ResolvedSigner,
    toAddress: string,
    data: TokenTxData,
    unlockHours?: number,
  ): Promise<string | null> {
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress,
      amount: 0,
      txType: TxType.TokenTx,
      data,
      unlockTime: this.unlockTimeFor(signer, unlockHours),
      apiOptions: this.apiOptions,
    });
    return txBuilder.process(this.dryRun);
  }

  // ---------------------------------------------------------------------------
  // Reserve (Vault) accounts
  //
  // A reserve account is funded like any address, then activated with
  // registerReserveAccount. From then on every send from it waits behind an
  // unlock time (24 hours minimum) and can be called back until it settles;
  // recoverReserveAccount sweeps pending sends and the balance to the
  // recovery address if the vault key is ever compromised. The node applies
  // the delay to VFX, vBTC and NFT sends; a fungible-token transfer from a
  // vault carries the unlock time the node insists on but settles at once.
  // ---------------------------------------------------------------------------

  /**
   * Activate a funded reserve account on the network: a 4 VFX Register()
   * naming the recovery address. The vault must already hold the 4 VFX plus
   * the fee plus the 0.5 VFX floor the node keeps on reserve accounts.
   * `recoveryAddress` is taken from a ReserveKeypair; a Signer must supply it.
   */
  public registerReserveAccount = async (
    signer: KeypairOrSigner,
    params: { recoveryAddress?: string } = {},
  ): Promise<string | null> => {
    const resolved = this.resolveReserve(signer, 'registerReserveAccount');
    const recoveryAddress = params.recoveryAddress ?? (signer as Partial<ReserveKeypair>).recoveryAddress;
    if (!recoveryAddress) {
      throw new Error('registerReserveAccount requires a recoveryAddress when the signer is not a ReserveKeypair');
    }
    if (recoveryAddress === resolved.address || recoveryAddress.startsWith(RESERVE_ADDRESS_PREFIX)) {
      throw new Error('recoveryAddress must be an ordinary account, not a reserve account');
    }
    return this.sendReserveTx(
      resolved,
      { Function: 'Register()', RecoveryAddress: recoveryAddress },
      {
        amount: RESERVE_ACTIVATION_COST,
        unlockTime: null,
      },
    );
  };

  /**
   * Cancel a pending send from the vault before its unlock time. `hash` is
   * the hash of the send being called back; the node refuses once it has
   * settled, and only the vault that sent it can call it back.
   */
  public callBackReserveTransaction = async (
    signer: KeypairOrSigner,
    params: { hash: string },
  ): Promise<string | null> => {
    const resolved = this.resolveReserve(signer, 'callBackReserveTransaction');
    if (!params.hash) {
      throw new Error('callBackReserveTransaction requires the hash of the pending transaction');
    }
    return this.sendReserveTx(resolved, { Function: 'CallBack()', Hash: params.hash }, { amount: 0, unlockTime: 0 });
  };

  /**
   * Sweep the vault to its recovery address: pending sends are reversed and
   * the balance moves. Two signatures are needed — the vault key signs the
   * transaction, and the recovery key signs `${SignatureTime}${recoveryAddress}`
   * to prove control of the recovery account. A ReserveKeypair carries both;
   * with a Signer for the vault, pass `recoverySigner` for the recovery key.
   * The node accepts the recovery signature for ten minutes.
   */
  public recoverReserveAccount = async (
    signer: KeypairOrSigner,
    params: { recoverySigner?: KeypairOrSigner; recoveryAddress?: string } = {},
  ): Promise<string | null> => {
    const resolved = this.resolveReserve(signer, 'recoverReserveAccount');

    const recoveryPrivateKey = (signer as Partial<ReserveKeypair>).recoveryPrivateKey;
    const recoveryInput =
      params.recoverySigner ?? (recoveryPrivateKey ? { privateKey: recoveryPrivateKey } : undefined);
    if (!recoveryInput) {
      throw new Error('recoverReserveAccount requires a recoverySigner when the signer is not a ReserveKeypair');
    }
    const recovery = this.resolve(recoveryInput);
    const recoveryAddress = params.recoveryAddress ?? recovery.address;
    if (recovery.address !== recoveryAddress) {
      throw new Error(
        `recoverReserveAccount: the recovery key signs for ${recovery.address}, not the recoveryAddress ${recoveryAddress}`,
      );
    }

    const signatureTime = Math.round(Date.now() / 1000);
    const recoverySigScript = await recovery.sign(`${signatureTime}${recoveryAddress}`);

    return this.sendReserveTx(
      resolved,
      {
        Function: 'Recover()',
        RecoveryAddress: recoveryAddress,
        RecoverySigScript: recoverySigScript,
        SignatureTime: signatureTime,
      },
      { amount: 0, unlockTime: 0 },
    );
  };

  private async sendReserveTx(
    signer: ResolvedSigner,
    data: Record<string, unknown>,
    opts: { amount: number; unlockTime: number | null },
  ): Promise<string | null> {
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: RESERVE_BASE_ADDRESS,
      amount: opts.amount,
      txType: TxType.Reserve,
      data,
      unlockTime: opts.unlockTime,
      apiOptions: this.apiOptions,
    });
    return txBuilder.process(this.dryRun);
  }

  private resolveReserve(signer: KeypairOrSigner, label: string): ResolvedSigner {
    const resolved = this.resolve(signer);
    if (!resolved.address.startsWith(RESERVE_ADDRESS_PREFIX)) {
      throw new Error(
        `${label} must be signed by a reserve (${RESERVE_ADDRESS_PREFIX}) account, got ${resolved.address}. ` +
          'Pass the ReserveKeypair itself, or a Signer whose address is the reserve form of its key.',
      );
    }
    return resolved;
  }

  private assertNotReserve(signer: ResolvedSigner, label: string): void {
    if (signer.address.startsWith(RESERVE_ADDRESS_PREFIX)) {
      throw new Error(
        `${label} cannot be sent from a reserve account; the network only allows it from an ordinary account`,
      );
    }
  }

  /**
   * The unlock time a send needs. Reserve accounts must delay every send by
   * at least 24 hours (the node checks this); ordinary accounts never set one.
   */
  private unlockTimeFor(signer: ResolvedSigner, unlockHours?: number): number | null {
    if (!signer.address.startsWith(RESERVE_ADDRESS_PREFIX)) {
      if (unlockHours !== undefined) {
        throw new Error('unlockHours applies only to sends from a reserve (xRBX) account');
      }
      return null;
    }
    const hours = unlockHours ?? RESERVE_MIN_UNLOCK_HOURS;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < RESERVE_MIN_UNLOCK_HOURS) {
      throw new Error(
        `A send from a reserve account must wait at least ${RESERVE_MIN_UNLOCK_HOURS} hours, got ${hours}`,
      );
    }
    return Math.round(Date.now() / 1000) + Math.round(hours * 3600);
  }

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

  /** The .vfx name (without suffix) the address owns, or throw. Strict: an outage is an error, not "no domain". */
  private async ownedVfxDomain(address: string, label: string): Promise<string> {
    const details = await this.addressApiClient.getAddressDetails(address, { strict: true });
    if (!details?.adnr) {
      throw new Error(`${label}: ${address} does not own a .vfx domain`);
    }
    return domainWithoutSuffix(details.adnr);
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

  private resolve(input: KeypairOrSigner | ResolvedSigner | { privateKey: string }): ResolvedSigner {
    return resolveSigner(input, this.keypairService);
  }

  /**
   * Pick the signing key for a flow that historically took `privateKey` and
   * now also accepts `signer`. Exactly one must be given: silently preferring
   * one over the other would hide a wiring mistake in exactly the setups
   * (HSM alongside a leftover dev key) where it matters most.
   */
  private signerFor(params: { privateKey?: string; signer?: Signer }, label: string): ResolvedSigner {
    if (params.signer && params.privateKey) {
      throw new Error(`${label}: pass either privateKey or signer, not both`);
    }
    if (params.signer) {
      return this.resolve(params.signer);
    }
    if (params.privateKey) {
      return this.resolve({ privateKey: params.privateKey });
    }
    throw new Error(`${label} requires a privateKey or a signer`);
  }

  private async signAndSend(
    prepared: PreparedTransactionResponse,
    signer: ResolvedSigner,
    sendFn: SendFn,
  ): Promise<SentTransactionResponse> {
    const hash = prepared.Hash;
    const signature = await signer.sign(hash);
    return sendFn({ hash, signature, public_key: signer.publicKey });
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
