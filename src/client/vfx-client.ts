import { Transaction as BitcoinTransaction, networks as bitcoinNetworks } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import BtcClient from '../btc';
import { BtcSigner, isBtcSigner } from '../btc/signer';
import {
  DOMAIN_DELETE_COST,
  DOMAIN_PURCHASE_COST,
  DOMAIN_TRANSFER_COST,
  Network,
  RESERVE_ACTIVATION_COST,
  RESERVE_MIN_REMAINING_BALANCE,
  RESERVE_ADDRESS_PREFIX,
  RESERVE_BASE_ADDRESS,
  RESERVE_MIN_UNLOCK_HOURS,
  TOKEN_BASE_ADDRESS,
  TxType,
  btcNameSignedMessagesActive,
} from '../constants';
import KeypairService from '../services/keypair-service';
import {
  PreSignCheckError,
  RawTransactionService,
  TransactionDispatchError,
  TransactionRefusedError,
} from '../services/raw-transaction-service';
import { assertRecipientOnNetwork, isNameRecipient } from '../services/recipient';
import {
  btcNameAcceptanceMessage,
  btcNameAcceptanceProblem,
  buildBtcNameAcceptanceCode,
} from '../services/btc-name-acceptance';
import {
  assertWatchedFeeRate,
  isUnreachableAnswer,
  parseWatchedWithdrawal,
  watchedWithdrawalFeeBumpData,
} from '../services/watched-withdrawal';
import {
  TokenTxData,
  assertPositiveAmount,
  tokenBanAddressData,
  tokenBurnData,
  tokenDeployPayload,
  tokenMintData,
  tokenMintRefusal,
  tokenOwnerChangeData,
  tokenPauseData,
  tokenTransferData,
  tokenVoteCastData,
  tokenVoteTopicCreateData,
} from '../services/token-data';
import {
  KeypairOrSigner,
  ResolvedSigner,
  Signer,
  SigningIntent,
  SigningRequest,
  SigningTransaction,
  approveIntent,
  newFlowId,
  resolveSigner,
  signMessages,
} from '../signer';
import { CORE_TX_TYPE_NAMES, hashPreimage } from '../services/transaction-hash';
import { vbtcContractHasNoMedia } from '../services/vbtc-media';
import { liveResumableWithdrawalsFor, resumableWithdrawalsFor } from '../services/vbtc-withdrawal-state';
import { frostResumeActionFor } from '../services/frost-resume';
import { NftAssetInput, NftMintParams, nftMintPayload, nftOwnershipProof } from '../services/nft-data';
import { decryptVfxShh, parseVfxShhMessage } from '../services/vfx-shh';
import {
  DEFAULT_HASH_MODE,
  HashMode,
  TransactionHashMismatchError,
  TxBuildSession,
  localTransactionFee,
} from '../services/tx-build-session';
import { VbtcAllocationInput, allocateVbtcInputs, vbtcMultiTransferData } from '../services/vbtc-multi';
import {
  VBTC_MULTI_WITHDRAWAL_DEFAULT_MAX_FEE,
  VBTC_MULTI_WITHDRAWAL_FUNCTION,
  VBTC_MULTI_WITHDRAWAL_MAX_INPUTS,
  assertBtcAddressOnNetwork,
  isFinalShareOutcome,
  shareOutcome,
  vbtcMultiWithdrawalData,
  withdrawalFeeFloorError,
} from '../services/vbtc-multi-withdrawal';
import {
  CreateVbtcResult,
  DeployTokenParams,
  DeployTokenResult,
  FungibleToken,
  FungibleTokenBalance,
  FungibleTokenDetail,
  Keypair,
  LegacyRecoveryLookup,
  LegacyVaultSource,
  PaginatedResponse,
  ReserveKeypair,
  VfxBlock,
  TokenVotingTopic,
  Transaction,
  VaultKeypair,
  VbtcCancelResult,
  VbtcWithdrawalCheckpoint,
  VbtcMultiTransferResult,
  VbtcMultiWithdrawalResult,
  VbtcWithdrawalShare,
  VbtcWithdrawalSharesResult,
  VbtcProgressEvent,
  VbtcTransfer,
  VbtcTransferResult,
  VbtcV2Token,
  VbtcWatchedWithdrawal,
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
import { BaseApiClient, VfxApiError } from './base-api-client';
import { AdnrApiClient } from './adnr-client';
import { BlockApiClient } from './block-api-client';
import { RawTransactionApiClient } from './raw-transaction-api-client';
import { TokenApiClient } from './token-api-client';
import { CoinPrice, CoinPricePoint, PriceApiClient, PricedCoin } from './price-api-client';
import { NftListingApiClient } from './nft-listing-api-client';
import {
  NftApiClient,
  NftListQuery,
  VfxNft,
  nftEvolveRefusal,
  nftEvolveStages,
  nftIsMedialess,
} from './nft-api-client';
import { MediaApiClient } from './media-api-client';
import { AuthApiClient } from './auth-api-client';
import { TransactionApiClient } from './transaction-api.client';
import {
  BroadcastResponse,
  PreparedTransactionResponse,
  SentTransactionResponse,
  VbtcV2ApiClient,
  WithdrawCompletePrepareResponse,
} from './vbtc-v2-api-client';

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

/** The per-call refusal switch `sendCoin` and the NFT writes take. */
export interface RefusalOptions {
  /**
   * Throw TransactionRefusedError, with the node's reason, when the node
   * refuses this send, instead of resolving to null. Overrides the client's
   * `throwOnRefusal` for this call.
   */
  throwOnRefusal?: boolean;
}

/** Per-call options for `sendCoin`. */
export interface SendCoinOptions extends ReserveSendOptions, RefusalOptions {}

/** The RawTransactionService option a call's RefusalOptions sets, if any. */
function refusalOverride(options: RefusalOptions | undefined): { throwOnRefusal?: boolean } {
  return options?.throwOnRefusal !== undefined ? { throwOnRefusal: options.throwOnRefusal } : {};
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
  /**
   * Set only when the broadcast request itself failed, so it is unknown
   * whether the Bitcoin transaction reached the network. Re-broadcasting this
   * exact transaction is safe (it can only ever confirm once); if the network
   * still refuses it and `btcTransactionHash` is not found, nothing was spent
   * and completeWithdrawal may run again.
   */
  readonly signedBtcTxHex: string | null;
  readonly cause: unknown;

  constructor(
    withdrawalRequestHash: string,
    btcTransactionHash: string | null,
    cause: unknown,
    options: { signedBtcTxHex?: string } = {},
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const signedBtcTxHex = options.signedBtcTxHex ?? null;
    let message: string;
    if (signedBtcTxHex) {
      message =
        `Withdrawal request ${withdrawalRequestHash} signed its Bitcoin transaction` +
        `${btcTransactionHash ? ` ${btcTransactionHash}` : ''} but the broadcast outcome is unknown: ${detail}. ` +
        `Do NOT call completeWithdrawal while it may be on the network — it would re-sign and may broadcast a second payout. ` +
        `Look the transaction up; if it is absent, re-broadcast signedBtcTxHex (the same transaction, so it cannot pay twice), ` +
        `then record it with recordWithdrawalCompletion. Only if the network refuses that transaction and it never appears ` +
        `is it safe to run completeWithdrawal again.`;
    } else {
      const resume = btcTransactionHash
        ? `Resume with recordWithdrawalCompletion({ withdrawalRequestHash, btcTransactionHash: '${btcTransactionHash}' }).`
        : 'The broadcast was accepted but returned no txid; recover it from the Bitcoin network before recording completion.';
      message =
        `Withdrawal request ${withdrawalRequestHash} broadcast its Bitcoin transaction ` +
        `but the on-chain completion was not recorded: ${detail}. ` +
        `Do NOT call completeWithdrawal — it would re-sign and may broadcast a second payout. ${resume}`;
    }
    super(message);
    this.name = 'VbtcWithdrawalUnrecordedError';
    this.withdrawalRequestHash = withdrawalRequestHash;
    this.btcTransactionHash = btcTransactionHash;
    this.signedBtcTxHex = signedBtcTxHex;
    this.cause = cause;
    Object.setPrototypeOf(this, VbtcWithdrawalUnrecordedError.prototype);
  }
}

/**
 * Thrown when a withdrawal from a watched vault closed without being paid: its
 * requester released it, or it expired or could not be paid. The vBTC was
 * returned to the requester (less the release's Bitcoin fee, for a release).
 */
export class VbtcWithdrawalClosedError extends Error {
  readonly withdrawalRequestHash: string;
  readonly withdrawal: VbtcWatchedWithdrawal;

  constructor(withdrawalRequestHash: string, withdrawal: VbtcWatchedWithdrawal) {
    super(
      `Withdrawal request ${withdrawalRequestHash} was closed without being paid (${withdrawal.state}): ` +
        `${withdrawal.summary ?? withdrawal.message ?? 'no detail'}`,
    );
    this.name = 'VbtcWithdrawalClosedError';
    this.withdrawalRequestHash = withdrawalRequestHash;
    this.withdrawal = withdrawal;
    Object.setPrototypeOf(this, VbtcWithdrawalClosedError.prototype);
  }
}

/**
 * `resumeJobId` named a FROST job the explorer no longer knows. Nothing new
 * was signed. Clear the stored job and call completeWithdrawal without it
 * (with `resignGuard`, so a signature that did land is not repeated).
 */
export class VbtcFrostJobNotFoundError extends Error {
  readonly withdrawalRequestHash: string;
  readonly jobId: string;

  constructor(withdrawalRequestHash: string, jobId: string) {
    super(`FROST job ${jobId} for withdrawal request ${withdrawalRequestHash} is not known to the explorer any more`);
    this.name = 'VbtcFrostJobNotFoundError';
    this.withdrawalRequestHash = withdrawalRequestHash;
    this.jobId = jobId;
    Object.setPrototypeOf(this, VbtcFrostJobNotFoundError.prototype);
  }
}

/**
 * `resignGuard` found that this withdrawal was already signed (`signed_at` or
 * `pending_btc`) but the explorer names no Bitcoin transaction for it.
 * Signing again could pay it twice, so nothing was done. Do not retry; find
 * the broadcast (or wait for the explorer) and use recordWithdrawalCompletion.
 */
export class VbtcWithdrawalAlreadySignedError extends Error {
  readonly withdrawalRequestHash: string;

  constructor(withdrawalRequestHash: string) {
    super(
      `Withdrawal request ${withdrawalRequestHash} has already been signed and no Bitcoin transaction is recorded ` +
        'for it yet. Do not start it again: that could pay it twice.',
    );
    this.name = 'VbtcWithdrawalAlreadySignedError';
    this.withdrawalRequestHash = withdrawalRequestHash;
    Object.setPrototypeOf(this, VbtcWithdrawalAlreadySignedError.prototype);
  }
}

/** Spyglass answered but could not reach the node, so the withdrawal's state is unknown; ask again. */
export class VbtcNodeUnreachableError extends Error {
  readonly answer: string;

  constructor(answer: string) {
    super(`Spyglass could not reach the node for the withdrawal's state; ask again: ${answer.slice(0, 300)}`);
    this.name = 'VbtcNodeUnreachableError';
    this.answer = answer;
    Object.setPrototypeOf(this, VbtcNodeUnreachableError.prototype);
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
  /**
   * Who builds transaction hashes, timestamps and fees for the sends this
   * client makes; see HashMode. Default 'both': built locally and checked
   * against Spyglass `/raw/hash`, throwing TransactionHashMismatchError on any
   * difference.
   */
  hashMode?: HashMode;
  /**
   * Ask the node to verify each transaction (`/raw/verify`) before sending
   * it. Default true for 'server' and 'both', false for 'local'; the send
   * refuses a bad transaction with the same reason either way.
   */
  preflight?: boolean;
  /**
   * Make every send from this client throw TransactionRefusedError, with the
   * node's reason, when the node refuses it, instead of resolving to null.
   * Default false (the historical null). Per call, `sendCoin` takes it too.
   * Calls that already throw on refusal (multi-vault withdrawals) keep doing so.
   * It covers the prepared vBTC sends (transfer, create, withdrawal request,
   * cancel, completion record) too: an explicit refusal there throws
   * TransactionRefusedError with the prepared hash, instead of a plain Error.
   */
  throwOnRefusal?: boolean;
}

type CompleteWithdrawalParams = {
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
  /**
   * How long to wait for the prepare/watched-vault answers, and the default
   * FROST polling limit; default 3 minutes. Signing, broadcast and the Type 28
   * are not counted against it.
   */
  timeoutMs?: number;
  /**
   * Deadline for the FROST signing job alone; defaults to `timeoutMs`. The
   * Flutter wallet waits 10 minutes (real ceremonies have taken over 4).
   */
  frostTimeoutMs?: number;
  /**
   * Resume an existing FROST job (the `jobId` of a `frost-job-started`
   * checkpoint) instead of starting a new signing: no prepare, no new
   * signatures, just polling, broadcast and the Type 28. Throws
   * VbtcFrostJobNotFoundError when the explorer no longer knows the job.
   */
  resumeJobId?: string;
  /**
   * Called, and awaited, at the two moments a withdrawal must be persisted
   * to survive a closed tab: when the FROST job starts (`frost-job-started`,
   * before polling) and when its Bitcoin transaction is broadcast
   * (`btc-broadcast`, before the Type 28). A throwing hook does not stop the
   * withdrawal; the failure is reported through `onProgress`.
   */
  onCheckpoint?: (checkpoint: VbtcWithdrawalCheckpoint) => void | Promise<void>;
  /**
   * Before signing, read the explorer's row for this request and, if it
   * shows a signature already exists (`signed_at` set or status
   * `pending_btc`), record the completion when the row names its Bitcoin
   * transaction or throw VbtcWithdrawalAlreadySignedError otherwise, rather
   * than sign a second time. An unreadable row lets signing go ahead, as the
   * Flutter wallet does. Off by default.
   */
  resignGuard?: boolean;
};

type RecordWithdrawalCompletionParams = {
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
};

/** A user action the signer already approved; its signatures share `flowId`. */
interface ApprovedFlow {
  flowId: string;
}

/**
 * A Bitcoin private key as 64 hex characters, from either that or a WIF for
 * the client's network. Throws on anything else, before anything is signed.
 */
function btcPrivateKeyHex(key: string, network: Network): string {
  const trimmed = key.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const btcNetwork = network === Network.Testnet ? bitcoinNetworks.testnet : bitcoinNetworks.bitcoin;
  let privateKey: Buffer | undefined;
  try {
    privateKey = ECPairFactory(ecc).fromWIF(trimmed, btcNetwork).privateKey;
  } catch (error) {
    throw new Error(
      `Bitcoin key is neither 64 hex characters nor a ${network} WIF: ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
  if (!privateKey) {
    throw new Error('Bitcoin WIF holds no private key');
  }
  return privateKey.toString('hex');
}

/** Concurrent transaction lookups in getLiveResumableWithdrawals. */
const WITHDRAWAL_HEIGHT_LOOKUP_CONCURRENCY = 4;
const OWNERSHIP_NONCE_CHARSET = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz';

/**
 * Thrown by `mintNfts` when one mint fails. `minted` holds the NFTs minted
 * before it, in order; `index` is the failed item.
 */
export class NftBulkMintError extends Error {
  readonly index: number;
  readonly minted: Array<{ transactionHash: string; scIdentifier: string }>;
  readonly cause: unknown;

  constructor(index: number, minted: Array<{ transactionHash: string; scIdentifier: string }>, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`mintNfts: item ${index} failed after ${minted.length} were minted: ${detail}`);
    this.name = 'NftBulkMintError';
    this.index = index;
    this.minted = minted;
    this.cause = cause;
    Object.setPrototypeOf(this, NftBulkMintError.prototype);
  }
}

const LEGACY_VAULT_HISTORY_PAGE_SIZE = 50;

/** The larger of an address's available and total balance; 0 when Spyglass has neither. */
function largestBalance(details: { balance: number; balanceTotal: number } | null): number {
  const finite = (value: number) => (Number.isFinite(value) ? value : 0);
  return details ? Math.max(finite(details.balance), finite(details.balanceTotal)) : 0;
}

/** A transaction's Data as Spyglass returns it (JSON text, an object, or a one-element array). */
function parseTxData(data: unknown): Record<string, unknown> | null {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) value = value[0];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Thrown by `fundAndRegisterVault` when the funding landed but the
 * registration was refused. `fundingHash` is the payment already made: retry
 * with `registerReserveAccount`, not by funding again. A registration whose
 * send may have reached the node throws TransactionDispatchError instead.
 */
export class VaultRegistrationError extends Error {
  readonly fundingHash: string;
  readonly cause: unknown;

  constructor(fundingHash: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `fundAndRegisterVault: funding ${fundingHash} landed but the registration failed; ` +
        `call registerReserveAccount to retry, without funding again: ${detail}`,
    );
    this.name = 'VaultRegistrationError';
    this.fundingHash = fundingHash;
    this.cause = cause;
    Object.setPrototypeOf(this, VaultRegistrationError.prototype);
  }
}

/** What fundAndRegisterVault sends by default: the Flutter wallet's VAULT_ACTIVATION_AMOUNT. */
const VAULT_FUND_AND_ACTIVATE_AMOUNT = 5;

/**
 * Room fundAndRegisterVault leaves for the Register() fee on top of the
 * activation cost and the balance floor. A Register() transaction is a few
 * hundred bytes, so its fee is a small fraction of this.
 */
const VAULT_REGISTER_FEE_ALLOWANCE = 0.01;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

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
  /** `/transaction/{hash}/`, read only for a request's mined height. */
  private transactionHeightApiClient: BaseApiClient;
  private priceApiClient: PriceApiClient;
  private nftListingApiClient: NftListingApiClient;
  private nftApiClient: NftApiClient;
  private mediaApiClient: MediaApiClient;
  private authApiClient: AuthApiClient;
  private hashMode: HashMode;
  private preflight: boolean | undefined;
  private throwOnRefusal: boolean;
  /** Clock offset and next-nonce cache shared by every send from this client. */
  private txBuildSession = new TxBuildSession();

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
    this.transactionHeightApiClient = new BaseApiClient({
      basePath: '/transaction',
      network: networkEnum,
      ...this.apiOptions,
    });
    this.priceApiClient = new PriceApiClient(networkEnum, this.apiOptions);
    this.nftListingApiClient = new NftListingApiClient(networkEnum, this.apiOptions);
    this.nftApiClient = new NftApiClient(networkEnum, this.apiOptions);
    this.mediaApiClient = new MediaApiClient(networkEnum, this.apiOptions);
    this.authApiClient = new AuthApiClient(networkEnum, this.apiOptions);
    this.hashMode = options.hashMode ?? DEFAULT_HASH_MODE;
    this.preflight = options.preflight;
    this.throwOnRefusal = options.throwOnRefusal ?? false;
  }

  /** The transaction-building options every RawTransactionService this client makes shares. */
  private get txBuildOptions(): {
    hashMode: HashMode;
    preflight?: boolean;
    session: TxBuildSession;
    throwOnRefusal?: boolean;
  } {
    return {
      hashMode: this.hashMode,
      session: this.txBuildSession,
      ...(this.preflight !== undefined && { preflight: this.preflight }),
      // Only ever switched on here, so a call that sets it itself is not overridden.
      ...(this.throwOnRefusal && { throwOnRefusal: true }),
    };
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

  // Reserve (Vault) account keys — see KeypairService.
  //
  // A new vault: `newVaultKeypair()` for the vault key, a recovery key kept
  // apart from it (`newRecoveryKey()`, `recoveryKeyFromPasskeyPrf()`, or an
  // address from another wallet), then `registerReserveAccount(vault, {
  // recoveryAddress })`. The `restoreLegacyWebWallet*` functions exist only to
  // find vaults the Flutter web wallet made; those vaults have NO theft
  // protection, because their recovery key is derived from the main key.

  /** A new vault key (xRBX) from the CSPRNG, with no recovery key attached. */
  public newVaultKeypair = (): VaultKeypair => {
    return this.keypairService.newVaultKeypair();
  };

  /** The vault for a vault private key, without inventing a recovery key for it. */
  public vaultKeypairFromPrivateKey = (vaultPrivateKey: string): VaultKeypair => {
    return this.keypairService.vaultKeypairFromPrivateKey(vaultPrivateKey);
  };

  /** A new random recovery key. Store it apart from the wallet; register only its address. */
  public newRecoveryKey = (): Keypair => {
    return this.keypairService.newRecoveryKey();
  };

  /** A recovery key from a dedicated passkey's PRF output (see KeypairService for the rp_id caveat). */
  public recoveryKeyFromPasskeyPrf = (prfOutput: Uint8Array | ArrayBuffer): Keypair => {
    return this.keypairService.recoveryKeyFromPasskeyPrf(prfOutput);
  };

  /**
   * LEGACY. The recovery key the Flutter web wallet derived for a vault (from
   * the main key, the vault key, or an imported key's derivation text). Never
   * use it for a new vault; it falls with the vault key.
   */
  public deriveLegacyRecoveryKey = (source: LegacyVaultSource): Keypair & { vaultAddress: string } => {
    return this.keypairService.deriveLegacyRecoveryKey(source);
  };

  /**
   * LEGACY. Whether an account has a legacy web-wallet vault worth restoring:
   * derives the legacy vault and recovery address (as the Flutter wallet and
   * Core do) and asks Spyglass about them. Activity is any of:
   *
   *   - a balance or any transaction on the recovery address
   *     (`/addresses/{address}/`, `/transaction/address/{address}/`);
   *   - a balance, any transaction, or an activated vault record on the
   *     vault address (same two endpoints);
   *   - a `Register()` from the vault naming this recovery address (read from
   *     the vault's transactions to `Reserve_Base`, every page).
   *
   * Lookups are strict: an outage throws rather than reading as "nothing
   * there". The key is returned only with `includeKey: true`; a wallet
   * shows "Restore legacy vault" when `hasActivity` is true.
   */
  public findLegacyRecovery = async (
    source: LegacyVaultSource,
    opts: { includeKey?: boolean } = {},
  ): Promise<LegacyRecoveryLookup> => {
    const derived = this.keypairService.deriveLegacyRecoveryKey(source);
    const [recoveryDetails, vaultDetails, recoveryTxs, vaultTxs] = await Promise.all([
      this.addressApiClient.getAddressDetails(derived.address, { strict: true }),
      this.addressApiClient.getAddressDetails(derived.vaultAddress, { strict: true }),
      this.transactionApiClient.listTransactionsForAddress(derived.address, 1, 1, { strict: true }),
      this.transactionApiClient.listTransactionsForAddress(derived.vaultAddress, 1, LEGACY_VAULT_HISTORY_PAGE_SIZE, {
        strict: true,
      }),
    ]);
    const namesThisRecovery = (tx: Transaction) => {
      if (tx.to_address !== RESERVE_BASE_ADDRESS || tx.from_address !== derived.vaultAddress) return false;
      const data = parseTxData(tx.data);
      return data?.Function === 'Register()' && data?.RecoveryAddress === derived.address;
    };
    // The Register() is usually the vault's oldest transaction, so older
    // pages are read until it turns up or the history ends.
    let registeredWithThisRecovery = (vaultTxs?.results ?? []).some(namesThisRecovery);
    for (let page = 2; !registeredWithThisRecovery && page <= (vaultTxs?.num_pages ?? 1); page++) {
      const older = await this.transactionApiClient.listTransactionsForAddress(
        derived.vaultAddress,
        page,
        LEGACY_VAULT_HISTORY_PAGE_SIZE,
        { strict: true },
      );
      registeredWithThisRecovery = (older?.results ?? []).some(namesThisRecovery);
    }
    const summary = {
      recoveryBalance: largestBalance(recoveryDetails),
      recoveryTransactionCount: recoveryTxs?.count ?? 0,
      vaultBalance: largestBalance(vaultDetails),
      vaultTransactionCount: vaultTxs?.count ?? 0,
      vaultActivated: vaultDetails?.activated === true,
      registeredWithThisRecovery,
    };
    const hasActivity =
      summary.recoveryBalance > 0 ||
      summary.recoveryTransactionCount > 0 ||
      summary.vaultBalance > 0 ||
      summary.vaultTransactionCount > 0 ||
      summary.vaultActivated ||
      registeredWithThisRecovery;
    return {
      address: derived.address,
      vaultAddress: derived.vaultAddress,
      hasActivity,
      summary,
      ...(opts.includeKey && {
        recoveryKey: { privateKey: derived.privateKey, publicKey: derived.publicKey, address: derived.address },
      }),
    };
  };

  /** LEGACY, NO THEFT PROTECTION: the vault the Flutter web wallet pairs with this main private key. */
  public restoreLegacyWebWalletVault = (mainPrivateKey: string): ReserveKeypair => {
    return this.keypairService.restoreLegacyWebWalletVault(mainPrivateKey);
  };

  /**
   * LEGACY, NO THEFT PROTECTION: the vault the web wallet derives from a key's derivation text (an
   * imported key's historical text forms each give their own vault; see
   * `derivationTextCandidates`).
   */
  public restoreLegacyWebWalletVaultFromDerivationText = (derivationText: string): ReserveKeypair => {
    return this.keypairService.restoreLegacyWebWalletVaultFromDerivationText(derivationText);
  };

  /** LEGACY, NO THEFT PROTECTION: a web-wallet vault from its own key, with the recovery key derived from it. */
  public restoreLegacyWebWalletVaultFromVaultKey = (reservePrivateKey: string): ReserveKeypair => {
    return this.keypairService.restoreLegacyWebWalletVaultFromVaultKey(reservePrivateKey);
  };

  /** Restore a vault from the CLI / web wallet restore code. */
  public reserveKeypairFromRestoreCode = (restoreCode: string): ReserveKeypair => {
    return this.keypairService.reserveKeypairFromRestoreCode(restoreCode);
  };

  /** The xRBX address for a public key — how an HSM-held vault key's address is obtained. */
  public reserveAddressFromPublic = (publicKeyHex: string): string => {
    return this.keypairService.reserveAddressFromPublic(publicKeyHex);
  };

  public getSignature = (message: string, privateKey: string): string => {
    return this.keypairService.getSignature(message, privateKey);
  };

  /**
   * `getSignature` for any key source: a keypair, a bare `{ privateKey }`, or
   * an external Signer. The message is signed as given, in the same
   * `base64(DER).base58(publicKey)` format, so `verifySignature` accepts it;
   * the signer receives a `message` request carrying the text. A signer that
   * must never sign raw text (a browser extension prefixing its origin) is
   * free to refuse it.
   */
  public signMessage = async (signer: KeypairOrSigner | { privateKey: string }, message: string): Promise<string> => {
    const resolved = this.resolve(signer);
    return resolved.sign(message, { kind: 'message', flowId: newFlowId(), message });
  };

  /**
   * Whether `signature` is `address`'s signature of `message`, accepting
   * exactly what the platform's verifier does. Never throws. The network is
   * read from the address (`x` testnet, otherwise mainnet), not this client's.
   */
  public verifySignature = (message: string, signature: string, address: string): boolean => {
    return this.keypairService.verifySignature(message, signature, address);
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
    options: SendCoinOptions = {},
  ): Promise<string | null> => {
    const signer = this.resolve(keypair);
    const recipient = await this.resolveRecipient(toAddress, 'sendCoin');
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: recipient,
      amount: amount,
      unlockTime: this.unlockTimeFor(signer, options.unlockHours),
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      ...(options.throwOnRefusal !== undefined && { throwOnRefusal: options.throwOnRefusal }),
    });
    return await txBuilder.process(this.dryRun);
  };

  /**
   * The fee and total (amount + fee) `sendCoin` would take with these
   * arguments, before anything is signed. In 'both' and 'local' hashMode it
   * is exact: the local formula, which the send then uses, and the same
   * `fee` and `total` a signer's `approve` receives. In 'server' mode it is
   * Spyglass's `/raw/fee` for an upper-bound size; the send asks again with
   * the real nonce (unless the signer has `approve`), so treat it as an
   * estimate there.
   */
  public quoteSendCoin = async (
    keypair: KeypairOrSigner,
    toAddress: string,
    amount: number,
    options: ReserveSendOptions = {},
  ): Promise<{ fee: number; amount: number; total: number }> => {
    const signer = this.resolve(keypair);
    const recipient = await this.resolveRecipient(toAddress, 'quoteSendCoin');
    return new RawTransactionService({
      network: this.network,
      signer,
      toAddress: recipient,
      amount,
      unlockTime: this.unlockTimeFor(signer, options.unlockHours),
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
    }).quote();
  };

  /**
   * An offline upper bound on any transaction's fee from Core's size
   * formula (the node only checks that a fee is above its floor). For a
   * send, `quoteSendCoin` gives the exact fee it will carry.
   */
  public estimateTransactionFee = (tx: {
    fromAddress: string;
    toAddress: string;
    amount?: number;
    txType?: number;
    data?: unknown;
    unlockTime?: number | null;
  }): number => {
    return localTransactionFee({
      FromAddress: tx.fromAddress,
      ToAddress: tx.toAddress,
      Amount: tx.amount ?? 0,
      TransactionType: tx.txType ?? TxType.RbxTransfer,
      Data: tx.data ?? null,
      UnlockTime: tx.unlockTime ?? null,
      Timestamp: Math.floor(Date.now() / 1000) + 3600,
      Nonce: 999_999_999_999,
    });
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
      ...this.txBuildOptions,
    });

    return await txBuilder.process(this.dryRun);
  };

  /**
   * Register `domain` (.btc) for the Bitcoin address of `btcPrivateKey` (a
   * hex key, a WIF, or a BtcSigner whose `signDigest` signs the claim),
   * managed by the signer. The address is the key's P2WPKH address. Costs 5 VFX. That Bitcoin key signs the claim: from
   * Core's BtcNameSignerOwnsAddressHeight (read against the latest block on
   * Spyglass) over `<unix seconds>:<signer address>:<name>.btc`, below it over
   * the bare timestamp. Throws when the latest block height cannot be read.
   */
  public buyBtcDomain = async (
    keypair: KeypairOrSigner,
    domain: string,
    btcPrivateKey: string | BtcSigner,
  ): Promise<string | null> => {
    domain = cleanBtcDomain(domain);

    if (!isValidBtcDomain(domain)) {
      throw new Error(`Invalid btc domain: ${domain}`);
    }
    const signer = this.resolve(keypair);
    this.assertNotReserve(signer, 'buyBtcDomain');

    // strict: an API outage must fail the purchase, not read as available.
    const available = await this.addressApiClient.domainAvailable(domain, { strict: true });

    if (!available) {
      throw new Error(`Domain already exists: ${domain}`);
    }

    // Core switches the message at BtcNameSignerOwnsAddressHeight, and each side
    // refuses the other's, so an unknown height must fail rather than guess.
    let latestBlockHeight: number;
    try {
      latestBlockHeight = await this.blockApiClient.getLatestHeight();
    } catch (e) {
      throw new Error(
        `buyBtcDomain: could not read the latest block height, which decides the BTC signature message: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const message = btcNameSignedMessagesActive(this.network, latestBlockHeight)
      ? btcNameAcceptanceMessage(timestamp, signer.address, domain)
      : `${timestamp}`;
    const btcClient = new BtcClient(this.network);

    const btcKeyHex = isBtcSigner(btcPrivateKey) ? null : btcPrivateKeyHex(btcPrivateKey, this.network);
    const signature =
      btcKeyHex === null
        ? await btcClient.getSignatureWithSigner(message, btcPrivateKey as BtcSigner, 'btc-name-claim')
        : btcClient.getSignature(message, btcKeyHex);
    const btcAddress =
      btcKeyHex === null ? (btcPrivateKey as BtcSigner).address : btcClient.addressFromPrivate(btcKeyHex).address;

    const data = {
      Function: 'BTCAdnrCreate()',
      Name: domainWithoutSuffix(domain),
      BTCAddress: btcAddress,
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
      ...this.txBuildOptions,
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
    const recipientAddress = toAddress ? await this.resolveRecipient(toAddress, 'transferVfxDomain') : toAddress;
    if (!recipientAddress || recipientAddress === signer.address) {
      throw new Error('transferVfxDomain requires a recipient other than the sender');
    }

    const domain = await this.ownedVfxDomain(signer.address, 'transferVfxDomain');
    const recipient = await this.addressApiClient.getAddressDetails(recipientAddress, { strict: true });
    if (recipient?.adnr) {
      throw new Error(`Recipient already has a domain: ${recipient.adnr}`);
    }

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: recipientAddress,
      amount: DOMAIN_TRANSFER_COST,
      txType: TxType.Adnr,
      data: { Function: 'AdnrTransfer()', Name: domain },
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
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
      ...this.txBuildOptions,
    });
    return txBuilder.process(this.dryRun);
  };

  /**
   * Move a .btc domain to another Bitcoin address, managed by `vfxToAddress`
   * from then on. Costs 5 VFX. The signer must be the VFX account that
   * currently manages the domain for `btcFromAddress`; the node checks that
   * pairing and that `btcToAddress` has no domain.
   *
   * From the network's BtcNameSignerOwnsAddressHeight the receiving Bitcoin
   * address must accept the name: pass the `btcToMessage` and `btcToSignature`
   * the receiver made with signBtcNameTransferAcceptance (or parsed from their
   * acceptance code with parseBtcNameAcceptanceCode). The acceptance must name
   * `vfxToAddress` and be under 24 hours old. Before that height they are
   * optional and the node ignores them.
   */
  public transferBtcDomain = async (
    keypair: KeypairOrSigner,
    params: {
      btcFromAddress: string;
      btcToAddress: string;
      vfxToAddress: string;
      btcToMessage?: string;
      btcToSignature?: string;
    },
  ): Promise<string | null> => {
    const signer = this.resolve(keypair);
    assertNotReserveSender(signer, 'transferBtcDomain');
    if (!params.btcFromAddress || !params.btcToAddress || !params.vfxToAddress) {
      throw new Error('transferBtcDomain requires btcFromAddress, btcToAddress and vfxToAddress');
    }
    if (!params.btcToMessage !== !params.btcToSignature) {
      throw new Error('transferBtcDomain takes btcToMessage and btcToSignature together, or neither');
    }
    const vfxToAddress = await this.resolveRecipient(params.vfxToAddress, 'transferBtcDomain');
    if (params.btcToMessage) {
      const problem = btcNameAcceptanceProblem(params.btcToMessage, { owner: vfxToAddress });
      if (problem) {
        throw new Error(`transferBtcDomain: ${problem}`);
      }
    }

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: vfxToAddress,
      amount: DOMAIN_TRANSFER_COST,
      txType: TxType.Adnr,
      data: {
        Function: 'BTCAdnrTransfer()',
        BTCToAddress: params.btcToAddress,
        BTCFromAddress: params.btcFromAddress,
        ...(params.btcToMessage ? { BTCToMessage: params.btcToMessage, BTCToSignature: params.btcToSignature } : {}),
      },
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
    });
    return txBuilder.process(this.dryRun);
  };

  /**
   * The receiving side of a .btc name transfer: the key of the Bitcoin
   * address the name moves to signs that it accepts `name` for `newOwner`
   * (the VFX address that will manage it). Hand `code` to the sender, who
   * passes its message and signature to transferBtcDomain. Good for 24 hours.
   */
  public signBtcNameTransferAcceptance = (params: {
    /** Private key of the receiving Bitcoin address: 64 hex characters or a WIF. */
    btcPrivateKey: string;
    name: string;
    newOwner: string;
    /** Unix seconds to sign at; defaults to now. */
    timestamp?: number;
  }): { message: string; signature: string; code: string } => {
    if (!params.btcPrivateKey || !params.name || !params.newOwner) {
      throw new Error('signBtcNameTransferAcceptance requires btcPrivateKey, name and newOwner');
    }
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
    const message = btcNameAcceptanceMessage(timestamp, params.newOwner, params.name);
    const signature = new BtcClient(this.network).getSignature(
      message,
      btcPrivateKeyHex(params.btcPrivateKey, this.network),
    );
    return { message, signature, code: buildBtcNameAcceptanceCode(message, signature) };
  };

  /**
   * `signBtcNameTransferAcceptance` with a BtcSigner for the receiving
   * Bitcoin address instead of its private key. The signer gets a
   * `btc-message` request with purpose `btc-name-transfer-acceptance`.
   */
  public signBtcNameTransferAcceptanceWithSigner = async (params: {
    btcSigner: BtcSigner;
    name: string;
    newOwner: string;
    /** Unix seconds to sign at; defaults to now. */
    timestamp?: number;
  }): Promise<{ message: string; signature: string; code: string }> => {
    if (!params.btcSigner || !params.name || !params.newOwner) {
      throw new Error('signBtcNameTransferAcceptanceWithSigner requires btcSigner, name and newOwner');
    }
    const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
    const message = btcNameAcceptanceMessage(timestamp, params.newOwner, params.name);
    const signature = await new BtcClient(this.network).getSignatureWithSigner(
      message,
      params.btcSigner,
      'btc-name-transfer-acceptance',
    );
    return { message, signature, code: buildBtcNameAcceptanceCode(message, signature) };
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
      ...this.txBuildOptions,
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

  /** Transactions to or from any of `addresses`, newest first, in one list. Failures throw. */
  public listTransactionsForAddresses = async (
    addresses: string[],
    page = 1,
    limit = 10,
  ): Promise<PaginatedResponse<Transaction>> => {
    return this.transactionApiClient.listTransactionsForAddresses(addresses, page, limit);
  };

  /** One transaction by hash, or null when Spyglass has none. Other failures throw. */
  public getTransaction = async (hash: string): Promise<Transaction | null> => {
    return this.transactionApiClient.getTransaction(hash);
  };

  /** The newest block Spyglass has indexed. */
  public getLatestBlock = async (): Promise<VfxBlock> => {
    return this.blockApiClient.getLatestBlock();
  };

  /** Height of the newest block Spyglass has indexed. */
  public getLatestBlockHeight = async (): Promise<number> => {
    return this.blockApiClient.getLatestHeight();
  };

  /** A block by height, or null when Spyglass has none. */
  public getBlock = async (height: number): Promise<VfxBlock | null> => {
    return this.blockApiClient.getBlock(height);
  };

  /** A block by hash, or null when Spyglass has none. */
  public getBlockByHash = async (hash: string): Promise<VfxBlock | null> => {
    return this.blockApiClient.getBlockByHash(hash);
  };

  /** The latest USDT price of VFX or BTC (CoinMarketCap via Spyglass). */
  public getCoinPrice = async (coin: PricedCoin = 'vfx'): Promise<CoinPrice> => {
    return this.priceApiClient.getPrice(coin);
  };

  /** Up to the last 1,000 recorded prices of VFX or BTC, newest first. */
  public getCoinPriceHistory = async (coin: PricedCoin = 'vfx'): Promise<CoinPricePoint[]> => {
    return this.priceApiClient.getPriceHistory(coin);
  };

  /** Identifiers of the NFTs `ownerAddress` has listed for sale on the shop. */
  public listListedNftIds = async (ownerAddress: string): Promise<string[]> => {
    return this.nftListingApiClient.listListedNftIds(ownerAddress);
  };

  // ---------------------------------------------------------------------------
  // vBTC V2
  // ---------------------------------------------------------------------------

  /**
   * `address`'s withdrawal requests on a vault that the chain still treats as
   * its active one, so the wallet should resume them rather than start a new
   * one. Judged by block height (the latest block, and each request
   * transaction's height), falling back to 90 minutes from `created_at`
   * for any request whose height cannot be read.
   */
  public getLiveResumableWithdrawals = async (
    tokenOrScIdentifier: VbtcV2Token | string,
    address: string,
  ): Promise<VbtcWithdrawalRequest[]> => {
    const token =
      typeof tokenOrScIdentifier === 'string'
        ? await this.vbtcV2ApiClient.getTokenDetail(tokenOrScIdentifier)
        : tokenOrScIdentifier;
    const candidates = resumableWithdrawalsFor(token, address);
    if (candidates.length === 0) return [];
    const currentBlockHeight = await this.blockApiClient.getLatestHeight().catch(() => null);
    const requestBlockHeights: Record<string, number> = {};
    if (currentBlockHeight !== null) {
      // A few lookups at a time, so one slow request does not hold up the rest.
      const hashes = candidates.map((request) => request.request_transaction_hash).filter((hash) => !!hash);
      for (let i = 0; i < hashes.length; i += WITHDRAWAL_HEIGHT_LOOKUP_CONCURRENCY) {
        await Promise.all(
          hashes.slice(i, i + WITHDRAWAL_HEIGHT_LOOKUP_CONCURRENCY).map(async (hash) => {
            const tx = await this.transactionHeightApiClient
              .makeJsonRequest(`/${encodeURIComponent(hash)}/`)
              .catch(() => null);
            if (typeof tx?.height === 'number') requestBlockHeights[hash] = tx.height;
          }),
        );
      }
    }
    return liveResumableWithdrawalsFor(token, address, { currentBlockHeight, requestBlockHeights });
  };

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

  /**
   * Hand a vBTC vault to `toAddress`: its contract, and with it the right to
   * withdraw its Bitcoin (a Type 18 transaction, Core
   * `GetVBTCOwnershipTransferData`). The owner signs the contract id so the
   * node can push the vault's media to a beacon for the recipient; a vault
   * with no media (the default placeholder) transfers with locator "NA" when
   * no beacon answers. From a vault (xRBX) the transfer waits `unlockHours`
   * (24 minimum) and can be called back until then.
   */
  public transferVbtcOwnership = async (
    params: {
      scIdentifier: string;
      toAddress: string;
      /** Local key to sign with. Pass either this or `signer`. */
      privateKey?: string;
      /** External signer (HSM, MPC) to sign with instead of a local key. */
      signer?: Signer;
    } & ReserveSendOptions,
  ): Promise<string | null> => {
    this.assertNotDryRun('transferVbtcOwnership');
    const signer = this.signerFor(params, 'transferVbtcOwnership');
    const toAddress = await this.resolveRecipient(params.toAddress, 'transferVbtcOwnership');
    assertRecipientOnNetwork(toAddress, this.network, 'transferVbtcOwnership toAddress');
    if (toAddress === signer.address) {
      throw new Error('transferVbtcOwnership requires a recipient other than the owner');
    }
    const unlockTime = this.unlockTimeFor(signer, params.unlockHours);
    const flowId = await this.approveFlow(signer, {
      action: 'vbtc-ownership-transfer',
      scIdentifier: params.scIdentifier,
      fromAddress: signer.address,
      toAddress,
    });

    const beaconSignature = await signer.sign(params.scIdentifier, {
      kind: 'vbtc-beacon-upload',
      flowId,
      message: params.scIdentifier,
      scIdentifier: params.scIdentifier,
      toAddress,
    });
    let locator = await this.vbtcV2ApiClient
      .beaconUpload(params.scIdentifier, toAddress, beaconSignature)
      .catch(() => null);
    if (!locator) {
      // A vault with no media has nothing to ship, so a dead beacon need not
      // stop it; the node forces "NA" for such contracts itself. One that has
      // media must not move without it.
      const token = await this.vbtcV2ApiClient.getTokenDetail(params.scIdentifier);
      if (!vbtcContractHasNoMedia(token?.nft)) {
        throw new Error(
          `transferVbtcOwnership: the beacon upload for ${params.scIdentifier} failed and the vault has media, ` +
            'so it was not transferred; try again when a beacon is reachable',
        );
      }
      locator = 'NA';
    }

    const data = await this.vbtcV2ApiClient.getOwnershipTransferData(params.scIdentifier, toAddress, locator);
    // The node builds the instruction; the signer approved this vault and this
    // recipient, so anything else (another contract, another recipient, a
    // different function, extra entries) is refused before signing.
    const instruction = data.length === 1 ? data[0] : null;
    if (
      !instruction ||
      instruction.Function !== 'Transfer()' ||
      instruction.ContractUID !== params.scIdentifier ||
      instruction.ToAddress !== toAddress
    ) {
      throw new Error(
        `transferVbtcOwnership: the node's transfer data does not match ${params.scIdentifier} to ${toAddress}; ` +
          `nothing was signed: ${JSON.stringify(data)}`,
      );
    }
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress,
      amount: 0,
      txType: TxType.TokenizationTx,
      data,
      unlockTime,
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      flowId,
      approved: true,
    });
    return txBuilder.process(false);
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
    const toAddress = await this.resolveRecipient(params.toAddress, 'transferVbtc');
    assertRecipientOnNetwork(toAddress, this.network, 'transferVbtc toAddress');
    const flowId = await this.approveFlow(signer, {
      action: 'vbtc-transfer',
      scIdentifier: params.scIdentifier,
      fromAddress: params.fromAddress,
      toAddress,
      amount: params.amount,
    });
    const prepared = await this.vbtcV2ApiClient.prepareTransfer({
      sc_identifier: params.scIdentifier,
      from_address: params.fromAddress,
      to_address: toAddress,
      amount: params.amount,
    });
    this.assertPrepared(prepared, 'transferVbtc:prepare');

    const sent = await this.signAndSend(prepared, signer, (body) => this.vbtcV2ApiClient.sendTransfer(body), flowId);
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
    const toAddress = await this.resolveRecipient(params.toAddress, 'transferVbtcMulti');

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
        toAddress,
        amount: single.amount,
        privateKey: params.privateKey,
        signer: params.signer,
      });
      return { transactionHash: sent.transactionHash, inputs };
    }

    const data = vbtcMultiTransferData({
      fromAddress: signer.address,
      toAddress,
      totalAmount: params.totalAmount,
      inputs,
    });
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress,
      amount: 0,
      txType: TxType.VbtcV2Transfer,
      data,
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
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
    // Approved before the ceremony is prepared: its messages carry timestamps.
    const flowId = await this.approveFlow(signer, {
      action: 'vbtc-create',
      ownerAddress: params.ownerAddress,
      name: params.name,
      description: params.description,
      ticker: params.ticker,
    });

    // Phase 1: MPC ceremony
    const ceremonyPrep = await this.vbtcV2ApiClient.prepareCeremony(params.ownerAddress);
    if (!ceremonyPrep?.success) {
      throw new Error(`createVbtcToken ceremony prepare failed: ${JSON.stringify(ceremonyPrep)}`);
    }

    const ceremony = {
      kind: 'vbtc-ceremony' as const,
      flowId,
      ceremonyId: ceremonyPrep.ceremony_id,
      sessionId: ceremonyPrep.session_id,
      ownerAddress: params.ownerAddress,
    };
    const [startSignature, shareSignature] = await signMessages(signer, [
      {
        message: ceremonyPrep.messages_to_sign.start_message,
        request: {
          ...ceremony,
          step: 'start',
          message: ceremonyPrep.messages_to_sign.start_message,
          timestamp: ceremonyPrep.messages_to_sign.start_timestamp,
        },
      },
      {
        message: ceremonyPrep.messages_to_sign.share_distribution_message,
        request: {
          ...ceremony,
          step: 'share',
          message: ceremonyPrep.messages_to_sign.share_distribution_message,
          timestamp: ceremonyPrep.messages_to_sign.share_distribution_timestamp,
        },
      },
    ]);

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
    const ownerSignature = await signer.sign(ownershipMessage, {
      kind: 'vbtc-ownership',
      flowId,
      message: ownershipMessage,
      ownerAddress: params.ownerAddress,
      name: params.name,
      description: params.description,
      ticker: params.ticker,
      ceremonyId: ceremonyPrep.ceremony_id,
      timestamp,
      uniqueId,
    });

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

    const sent = await this.signAndSend(createPrep, signer, (body) => this.vbtcV2ApiClient.sendCreate(body), flowId);
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
    const floor = withdrawalFeeFloorError(
      params.amount,
      params.feeRate,
      `Withdrawal from vault ${params.scIdentifier}`,
    );
    if (floor) throw new Error(`requestWithdrawal: ${floor}`);
    // One approval covers the request and its completion: declining after the
    // request is on chain would strand it.
    const flowId = await this.approveFlow(signer, {
      action: 'vbtc-withdrawal-request',
      ownerAddress: params.requestorAddress,
      btcAddress: params.btcAddress,
      amount: params.amount,
      feeRate: params.feeRate,
      inputs: [{ scIdentifier: params.scIdentifier, amount: params.amount }],
    });

    // Step 1: Request (Type 27)
    const requestPrep = await this.vbtcV2ApiClient.prepareWithdrawRequest({
      sc_identifier: params.scIdentifier,
      requestor_address: params.requestorAddress,
      btc_address: params.btcAddress,
      amount: params.amount,
      fee_rate: params.feeRate,
    });
    this.assertPrepared(requestPrep, 'requestWithdrawal:request:prepare');

    const requestSent = await this.signAndSend(
      requestPrep,
      signer,
      (body) => this.vbtcV2ApiClient.sendWithdrawRequest(body),
      flowId,
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
      return await this.completeWithdrawalInFlow({ ...params, withdrawalRequestHash }, { flowId });
    } catch (error) {
      // A post-broadcast failure already carries the txid and the correct
      // (do-not-re-sign) recovery instruction. Re-wrapping it as merely
      // "incomplete" would tell the caller to resume via completeWithdrawal,
      // which is the one thing that can pay the destination twice.
      if (error instanceof VbtcWithdrawalUnrecordedError) throw error;
      // A watched vault's withdrawal closed unpaid: that is where it stands,
      // not something completeWithdrawal could resume.
      if (error instanceof VbtcWithdrawalClosedError) throw error;
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
   *
   * On a vault the chain watches (Core 9.0 Bitcoin attestation) there is no
   * ceremony and no completion transaction: the chain pays the withdrawal,
   * which takes Bitcoin confirmations. This sends nothing. It waits (up to
   * `timeoutMs`) until the node has recorded the request, then resolves with
   * `paid: true` and the paying txid if Bitcoin has paid it, or `paid: false`
   * and its state in `watched` while it is being paid; follow that with
   * getWithdrawalPin, or call this again. It throws VbtcWithdrawalClosedError
   * if the withdrawal closed unpaid.
   */
  public completeWithdrawal = async (params: CompleteWithdrawalParams): Promise<VbtcWithdrawalResult> => {
    return this.completeWithdrawalInFlow(params);
  };

  /** `completeWithdrawal` inside a user action that was already approved (`flow`), or on its own. */
  private completeWithdrawalInFlow = async (
    params: CompleteWithdrawalParams,
    flow?: ApprovedFlow,
  ): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('completeWithdrawal');
    const signer = this.signerFor(params, 'completeWithdrawal');
    const onProgress = params.onProgress ?? (() => undefined);
    const pollIntervalMs = params.pollIntervalMs ?? 5000;
    const timeoutMs = params.timeoutMs ?? 3 * 60 * 1000;
    const frostTimeoutMs = params.frostTimeoutMs ?? timeoutMs;
    const withdrawalRequestHash = params.withdrawalRequestHash;
    // Approved before FROST is prepared: its start and share messages carry timestamps.
    const flowId = await this.approveFlow(
      signer,
      {
        action: 'vbtc-withdrawal-complete',
        scIdentifier: params.scIdentifier,
        ownerAddress: params.requestorAddress,
        withdrawalRequestHash,
      },
      flow,
    );

    if (params.resumeJobId) {
      // A job is only resumed while the explorer still knows it; "Job not
      // found" means it is gone and a fresh call (without resumeJobId) is the
      // way on. Any other answer, or a transient error, resumes polling.
      const probe = await this.vbtcV2ApiClient.getWithdrawCompleteStatus(params.resumeJobId).catch(() => undefined);
      if ((probe as { success?: boolean; message?: string } | undefined)?.message === 'Job not found') {
        throw new VbtcFrostJobNotFoundError(withdrawalRequestHash, params.resumeJobId);
      }
      onProgress({ phase: 'frost_polling', message: `Resuming FROST job ${params.resumeJobId}` });
      return this.finishFrostJob(params, params.resumeJobId, { flowId, frostTimeoutMs, pollIntervalMs });
    }

    // Step 2: Prepare FROST
    onProgress({ phase: 'frost_preparing', message: 'Preparing FROST signing ceremony' });

    // The first read decides between a watched vault and FROST, so a read
    // that got no answer (a dropped request, a 5xx, Spyglass unable to reach
    // the node) is asked again until the deadline rather than taken as either.
    const deadline = Date.now() + timeoutMs;
    let answer: Record<string, unknown> | undefined;
    for (;;) {
      try {
        answer = await this.vbtcV2ApiClient.getWithdrawCompleteAnswer({
          sc_identifier: params.scIdentifier,
          withdrawal_request_hash: withdrawalRequestHash,
          owner_address: params.requestorAddress,
        });
        if (!isUnreachableAnswer(answer)) break;
        if (Date.now() + pollIntervalMs > deadline) throw new VbtcNodeUnreachableError(JSON.stringify(answer));
      } catch (error) {
        if (!isTransientReadError(error) || Date.now() + pollIntervalMs > deadline) throw error;
      }
      await sleep(pollIntervalMs);
    }
    const watched = parseWatchedWithdrawal(answer);
    if (watched) {
      return this.watchedWithdrawalResult({
        scIdentifier: params.scIdentifier,
        requestorAddress: params.requestorAddress,
        withdrawalRequestHash,
        first: watched,
        onProgress,
        pollIntervalMs,
        deadline,
      });
    }
    const frostPrep = answer as unknown as WithdrawCompletePrepareResponse;
    if (!frostPrep?.success) {
      throw new Error(`completeWithdrawal frost prepare failed: ${JSON.stringify(frostPrep)}`);
    }

    if (params.resignGuard) {
      const row = await this.vbtcV2ApiClient
        .getWithdrawals(params.scIdentifier)
        .then((rows) => rows.find((r) => r.request_transaction_hash === withdrawalRequestHash) ?? null)
        .catch(() => null);
      const action = frostResumeActionFor(row);
      if (action === 'completion-only' && row) {
        return this.recordWithdrawalCompletionInFlow(
          {
            scIdentifier: params.scIdentifier,
            requestorAddress: params.requestorAddress,
            withdrawalRequestHash,
            btcTransactionHash: row.btc_transaction_hash,
            amount: params.amount,
            btcDestination: params.btcAddress,
            privateKey: params.privateKey,
            signer: params.signer,
            onProgress,
          },
          { flowId },
        );
      }
      if (action === 'refuse') {
        throw new VbtcWithdrawalAlreadySignedError(withdrawalRequestHash);
      }
    }

    // Multi-input withdrawals (caster-upgrade nodes) return one start message
    // per vault UTXO. StartMessages[0] is byte-identical to the legacy
    // StartMessage and is already covered by the start signature; every later
    // entry is signed verbatim — the validators verify the exact Message
    // strings the node returned, so they must never be reconstructed locally.
    // Signing fewer inputs than the transaction needs fails Execute with
    // InputCountMismatch (retryable via a fresh prepare).
    const frost = {
      kind: 'frost-withdrawal' as const,
      flowId,
      scIdentifier: params.scIdentifier,
      withdrawalRequestHash,
      ownerAddress: params.requestorAddress,
      sessionId: frostPrep.SessionId,
    };
    const extraInputs = (frostPrep.StartMessages ?? []).filter((entry) => entry.InputIndex > 0);
    const [frostStartSig, frostShareSig, ...extraSignatures] = await signMessages(signer, [
      {
        message: frostPrep.StartMessage,
        request: { ...frost, step: 'start', message: frostPrep.StartMessage, timestamp: frostPrep.StartTimestamp },
      },
      {
        message: frostPrep.ShareDistributionMessage,
        request: {
          ...frost,
          step: 'share',
          message: frostPrep.ShareDistributionMessage,
          timestamp: frostPrep.ShareDistributionTimestamp,
        },
      },
      ...extraInputs.map((entry) => ({
        message: entry.Message,
        request: {
          ...frost,
          step: 'input' as const,
          message: entry.Message,
          sessionId: entry.SessionId ?? frostPrep.SessionId,
          timestamp: entry.Timestamp,
          inputIndex: entry.InputIndex,
        },
      })),
    ]);
    const extraStartSignatures = extraInputs.map((entry, index) => ({
      input_index: entry.InputIndex,
      signature: extraSignatures[index],
    }));

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
    await this.reportWithdrawalCheckpoint(params, {
      kind: 'frost-job-started',
      scIdentifier: params.scIdentifier,
      withdrawalRequestHash,
      jobId: frostExec.job_id,
      amount: params.amount,
      btcAddress: params.btcAddress,
    });

    return this.finishFrostJob(params, frostExec.job_id, { flowId, frostTimeoutMs, pollIntervalMs });
  };

  private async reportWithdrawalCheckpoint(
    params: CompleteWithdrawalParams,
    checkpoint: VbtcWithdrawalCheckpoint,
  ): Promise<void> {
    if (!params.onCheckpoint) return;
    try {
      await params.onCheckpoint(checkpoint);
    } catch (error) {
      params.onProgress?.({
        phase: 'checkpoint_failed',
        message: `Could not save the ${checkpoint.kind} checkpoint: ${
          error instanceof Error ? error.message : String(error)
        }`,
        data: checkpoint,
      });
    }
  }

  /**
   * Poll a FROST signing job to its signed Bitcoin transaction, broadcast it,
   * and record the completion (Type 28). Shared by a fresh withdrawal and a
   * resumed `resumeJobId`.
   */
  private async finishFrostJob(
    params: CompleteWithdrawalParams,
    jobId: string,
    opts: { flowId: string; frostTimeoutMs: number; pollIntervalMs: number },
  ): Promise<VbtcWithdrawalResult> {
    const { flowId, pollIntervalMs } = opts;
    const timeoutMs = opts.frostTimeoutMs;
    const onProgress = params.onProgress ?? (() => undefined);
    const withdrawalRequestHash = params.withdrawalRequestHash;

    // The failed-status diagnostics (failure_code, retryable, ...) ride on
    // the polled status object; captured here so the thrown error can say
    // whether retrying is worthwhile instead of just dumping JSON.
    let lastFrostFailure: { failure_code?: string | null; retryable?: boolean | null } | undefined;

    let frostFinal;
    try {
      frostFinal = await this.pollUntilDone({
        getStatus: () => this.vbtcV2ApiClient.getWithdrawCompleteStatus(jobId),
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
    // A job names the withdrawal it signed. One restored from storage for a
    // different withdrawal would otherwise broadcast that one's Bitcoin and
    // record it against this one, so a mismatch stops before the broadcast.
    const jobVault = frostFinal.sc_identifier;
    const jobRequest = frostFinal.withdrawal_request_hash;
    if ((jobVault && jobVault !== params.scIdentifier) || (jobRequest && jobRequest !== withdrawalRequestHash)) {
      throw new Error(
        `completeWithdrawal: FROST job ${jobId} signed withdrawal ${jobRequest ?? '?'} on ${jobVault ?? '?'}, ` +
          `not ${withdrawalRequestHash} on ${params.scIdentifier}; nothing was broadcast`,
      );
    }

    onProgress({ phase: 'frost_complete', message: 'FROST signing complete' });

    // Broadcast BTC tx.
    //
    // The two failure modes here are opposites and must not be collapsed:
    // a rejected broadcast leaves the coins untouched and is safe to re-drive,
    // while an accepted broadcast that returns no txid means the coins are
    // already gone and re-signing would risk a second payout. A request that
    // fails outright (lost response, timeout, or the 5xx Spyglass returns for
    // both a refusal and a provider timeout) is the third case: the
    // transaction may be on the network, so it is treated as possibly
    // broadcast and the signed transaction travels with the error. Re-sending
    // that exact transaction can never pay twice; re-signing can.
    const signedBtcTxHex = frostFinal.signed_btc_tx_hex;
    let broadcast: BroadcastResponse;
    try {
      broadcast = await this.vbtcV2ApiClient.broadcastBtc(signedBtcTxHex);
    } catch (error) {
      throw new VbtcWithdrawalUnrecordedError(withdrawalRequestHash, btcTxidFromHex(signedBtcTxHex), error, {
        signedBtcTxHex,
      });
    }
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
    // Recorded before the Type 28 is attempted: from here the Bitcoin has
    // left the vault, and what finishes the withdrawal is this txid alone.
    await this.reportWithdrawalCheckpoint(params, {
      kind: 'btc-broadcast',
      scIdentifier: params.scIdentifier,
      withdrawalRequestHash,
      jobId,
      btcTransactionHash: broadcast.txid,
      signedBtcTxHex,
      amount: params.amount,
      btcAddress: params.btcAddress,
    });

    // Step 4: Record completion (Type 28).
    //
    // Past this point the BTC has left the vault, so a failure here is not the
    // same kind of failure as anything above it: the caller must record the
    // completion for the txid we already have, never re-run the ceremony.
    try {
      return await this.recordWithdrawalCompletionInFlow(
        {
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
        },
        { flowId },
      );
    } catch (error) {
      throw new VbtcWithdrawalUnrecordedError(withdrawalRequestHash, broadcast.txid, error);
    }
  }

  /**
   * Where a withdrawal from a vault the chain watches stands: its pinned
   * Bitcoin transaction and fee rate, whether it is paid, and whether its fee
   * can be raised (bumpWithdrawalFee) or it can be released
   * (releaseWithdrawal). Null when the vault is not watched; its withdrawal is
   * completed with completeWithdrawal as before. Throws when Spyglass could not
   * reach the node, since that answer says neither.
   */
  public getWithdrawalPin = async (params: {
    scIdentifier: string;
    withdrawalRequestHash: string;
    requestorAddress: string;
  }): Promise<VbtcWatchedWithdrawal | null> => {
    const answer = await this.vbtcV2ApiClient.getWithdrawCompleteAnswer({
      sc_identifier: params.scIdentifier,
      withdrawal_request_hash: params.withdrawalRequestHash,
      owner_address: params.requestorAddress,
    });
    if (isUnreachableAnswer(answer)) {
      throw new VbtcNodeUnreachableError(JSON.stringify(answer));
    }
    return parseWatchedWithdrawal(answer);
  };

  /**
   * Raise the Bitcoin fee of a pinned withdrawal on a watched vault that is not
   * confirming. One Type 44 transaction from the requester to itself; the
   * chain then pins a replacement that spends the same coins, and the higher
   * fee comes out of the withdrawal's amount. `feeRate` (sat/vB) must be above
   * the rate the pinned transaction pays (`minimumNextFeeRate` from
   * getWithdrawalPin). The withdrawal is read first and the call refused
   * unless it is pinned with a fee that can be raised and `feeRate` is high
   * enough; a refusal by the node throws TransactionRefusedError with its
   * reason. Resolves to the transaction hash.
   */
  public bumpWithdrawalFee = async (params: {
    scIdentifier: string;
    withdrawalRequestHash: string;
    feeRate: number;
    /** Local key of the requester. Pass either this or `signer`. */
    privateKey?: string;
    signer?: Signer;
  }): Promise<string | null> => {
    return this.sendWatchedFeeBump(params, false, 'bumpWithdrawalFee');
  };

  /**
   * Give up a pinned withdrawal on a watched vault: the chain pins a Bitcoin
   * transaction that returns its coins to the vault, and once Bitcoin confirms
   * it the vBTC is returned to the requester, less that transaction's fee. If
   * one of its payments confirms first it is paid instead. `feeRate` follows
   * the same rule as bumpWithdrawalFee, and the node also refuses a release
   * whose fee does not beat the pinned transaction's by its relay cost (that
   * refusal comes back as TransactionRefusedError with the node's reason).
   */
  public releaseWithdrawal = async (params: {
    scIdentifier: string;
    withdrawalRequestHash: string;
    feeRate: number;
    privateKey?: string;
    signer?: Signer;
  }): Promise<string | null> => {
    return this.sendWatchedFeeBump(params, true, 'releaseWithdrawal');
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
  public recordWithdrawalCompletion = async (
    params: RecordWithdrawalCompletionParams,
  ): Promise<VbtcWithdrawalResult> => {
    return this.recordWithdrawalCompletionInFlow(params);
  };

  /** `recordWithdrawalCompletion` inside a user action that was already approved (`flow`), or on its own. */
  private recordWithdrawalCompletionInFlow = async (
    params: RecordWithdrawalCompletionParams,
    flow?: ApprovedFlow,
  ): Promise<VbtcWithdrawalResult> => {
    this.assertNotDryRun('recordWithdrawalCompletion');
    const signer = this.signerFor(params, 'recordWithdrawalCompletion');
    const onProgress = params.onProgress ?? (() => undefined);

    if (!params.btcTransactionHash) {
      throw new Error('recordWithdrawalCompletion requires the broadcast btcTransactionHash');
    }
    const flowId = await this.approveFlow(
      signer,
      {
        action: 'vbtc-withdrawal-record',
        scIdentifier: params.scIdentifier,
        ownerAddress: params.requestorAddress,
        withdrawalRequestHash: params.withdrawalRequestHash,
        btcTransactionHash: params.btcTransactionHash,
        amount: params.amount,
        btcDestination: params.btcDestination,
      },
      flow,
    );

    const completionPrep = await this.vbtcV2ApiClient.prepareWithdrawCompleteTx({
      sc_identifier: params.scIdentifier,
      from_address: params.requestorAddress,
      withdrawal_request_hash: params.withdrawalRequestHash,
      btc_transaction_hash: params.btcTransactionHash,
      amount: params.amount,
      btc_destination: params.btcDestination,
    });
    this.assertPrepared(completionPrep, 'recordWithdrawalCompletion:prepare');

    const completionSent = await this.signAndSend(
      completionPrep,
      signer,
      (body) => this.vbtcV2ApiClient.sendWithdrawCompleteTx(body),
      flowId,
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
      paid: true,
      watched: null,
    };
  };

  /**
   * Withdraw `totalAmount` vBTC to one Bitcoin address from several vaults at
   * once: one Type 27 transaction, one signature. The chain opens one share
   * per vault under the request's hash and each share is paid by its own
   * Bitcoin transaction, so `feeRate` is paid once per share, out of that
   * share. Follow the shares with getWithdrawalShares / followWithdrawalShares;
   * raise a share's fee or release it with bumpWithdrawalFee /
   * releaseWithdrawal, or cancel a Waiting share with cancelWithdrawal, each
   * naming the share's vault and the request's hash.
   *
   * The vaults and amounts are `inputs` when given; otherwise they are chosen
   * from the requester's spendable balances on Spyglass (largest first, at
   * most 10 vaults), limited to `vaults` when given. When one vault covers
   * the total, the ordinary single-vault request is sent instead, as the node
   * does. Before signing, the SDK checks the Bitcoin address is on this
   * network, every share clears the fee floor, and the transaction it is
   * about to sign is the requester's own Type 27 carrying exactly these
   * shares and a VFX fee no higher than `maxFee`. This sends only the
   * request; it does not wait for payment.
   */
  public requestWithdrawalMulti = async (params: {
    btcAddress: string;
    totalAmount: number;
    /** Bitcoin fee rate (sat/vB), charged once per share. */
    feeRate: number;
    /** Local key of the requester. Pass either this or `signer`. */
    privateKey?: string;
    signer?: Signer;
    /** The exact vaults and amounts; skips the balance lookup. Must sum to `totalAmount`. */
    inputs?: VbtcAllocationInput[];
    /** Allocate only from these vaults (for example the ones the chain watches). */
    vaults?: string[];
    /** Refuse to sign when the VFX fee is above this. Default 0.01. */
    maxFee?: number;
  }): Promise<VbtcMultiWithdrawalResult> => {
    const label = 'requestWithdrawalMulti';
    this.assertNotDryRun(label);
    const signer = this.signerFor(params, label);
    assertNotReserveSender(signer, label);
    if (!(params.totalAmount > 0)) {
      throw new Error(`${label} requires a positive totalAmount`);
    }
    if (!Number.isInteger(params.feeRate) || params.feeRate <= 0) {
      throw new Error(`${label}: feeRate must be a whole number of sat/vB greater than zero`);
    }
    assertBtcAddressOnNetwork(params.btcAddress, this.network, label);
    const maxFee = params.maxFee ?? VBTC_MULTI_WITHDRAWAL_DEFAULT_MAX_FEE;

    let inputs = params.inputs;
    if (!inputs) {
      const tokens = await this.vbtcV2ApiClient.getTokensForAddress(signer.address);
      const allowed = params.vaults ? new Set(params.vaults) : null;
      const balances: Record<string, number> = {};
      for (const token of tokens) {
        if (allowed && !allowed.has(token.sc_identifier)) continue;
        balances[token.sc_identifier] =
          token.available_balances?.[signer.address] ?? token.addresses?.[signer.address] ?? 0;
      }
      const allocation = allocateVbtcInputs(balances, params.totalAmount, VBTC_MULTI_WITHDRAWAL_MAX_INPUTS);
      if (allocation.failure === 'insufficientBalance') {
        throw new Error(
          `${label}: insufficient vBTC: ${allocation.available} available across ${
            Object.keys(balances).length
          } vaults, ${params.totalAmount} requested`,
        );
      }
      if (allocation.failure === 'tooManyInputs') {
        throw new Error(
          `${label}: withdrawing ${params.totalAmount} would need more than ${VBTC_MULTI_WITHDRAWAL_MAX_INPUTS} vaults; withdraw less`,
        );
      }
      inputs = allocation.inputs;
    }
    if (inputs.length === 0) {
      throw new Error(`${label}: no vault to withdraw from`);
    }

    const flowId = await this.approveFlow(signer, {
      action: 'vbtc-withdrawal-request',
      ownerAddress: signer.address,
      btcAddress: params.btcAddress,
      amount: params.totalAmount,
      feeRate: params.feeRate,
      inputs: inputs.map((input) => ({ scIdentifier: input.scIdentifier, amount: input.amount })),
    });

    if (inputs.length === 1) {
      return this.requestSingleShare(signer, params, inputs[0], maxFee, label, flowId);
    }

    // Throws for anything the node would refuse (cap, duplicates, decimals,
    // fee floor, total drift) before anything is built.
    const data = vbtcMultiWithdrawalData({
      requestorAddress: signer.address,
      btcAddress: params.btcAddress,
      totalAmount: params.totalAmount,
      feeRate: params.feeRate,
      inputs,
    });
    const expectedInputs = JSON.stringify(data.Inputs);
    let fee = 0;
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: signer.address,
      amount: 0,
      txType: TxType.VbtcV2WithdrawalRequest,
      data,
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      flowId,
      approved: true,
      throwOnRefusal: true,
      beforeSign: (tx) => {
        const txData = tx.Data as Record<string, unknown>;
        const problems: string[] = [];
        if (tx.FromAddress !== signer.address || tx.ToAddress !== signer.address)
          problems.push('not to and from the requester');
        if (tx.TransactionType !== TxType.VbtcV2WithdrawalRequest) problems.push(`type ${tx.TransactionType}`);
        if (tx.Amount !== 0) problems.push(`amount ${tx.Amount}`);
        if (txData?.Function !== VBTC_MULTI_WITHDRAWAL_FUNCTION) problems.push('not a multi-vault request');
        if (txData?.BTCAddress !== params.btcAddress) problems.push(`destination ${String(txData?.BTCAddress)}`);
        if (JSON.stringify(txData?.Inputs) !== expectedInputs) problems.push('shares differ from the allocation');
        const txFee = typeof tx.Fee === 'number' ? tx.Fee : NaN;
        if (!(txFee > 0) || txFee > maxFee) problems.push(`fee ${tx.Fee} VFX (limit ${maxFee})`);
        if (problems.length > 0) {
          throw new PreSignCheckError(`${label}: refused to sign: ${problems.join('; ')}`);
        }
        fee = txFee;
      },
    });
    const withdrawalRequestHash = await txBuilder.process(false);
    if (!withdrawalRequestHash) {
      throw new Error(`${label}: the request was not sent (it failed before reaching the node)`);
    }
    return {
      withdrawalRequestHash,
      inputs,
      totalAmount: data.TotalAmount as number,
      btcAddress: params.btcAddress,
      feeRate: params.feeRate,
      fee,
    };
  };

  /**
   * Where each share of a withdrawal request stands, read from the node (the
   * completion route answers per vault). `shares` are the vaults and amounts
   * the request opened, as requestWithdrawalMulti returned them (`inputs`);
   * a single-vault request has one. Throws when Spyglass cannot reach the node.
   */
  public getWithdrawalShares = async (params: {
    withdrawalRequestHash: string;
    requestorAddress: string;
    shares: VbtcAllocationInput[];
  }): Promise<VbtcWithdrawalShare[]> => {
    if (!params.withdrawalRequestHash || params.shares.length === 0) {
      throw new Error('getWithdrawalShares requires withdrawalRequestHash and at least one share');
    }
    return Promise.all(
      params.shares.map(async (share) => {
        const watched = await this.getWithdrawalPin({
          scIdentifier: share.scIdentifier,
          withdrawalRequestHash: params.withdrawalRequestHash,
          requestorAddress: params.requestorAddress,
        });
        return {
          scIdentifier: share.scIdentifier,
          amount: share.amount,
          outcome: shareOutcome(watched),
          watched,
          pinnedBtcTransactionHash: watched?.pinnedBtcTransactionHash ?? null,
          btcTransactionHash: watched?.btcTransactionHash ?? null,
        };
      }),
    );
  };

  /**
   * Read the shares until every one is final (paid, released, cancelled,
   * closed, or on a vault the chain does not watch) or `timeoutMs` passes,
   * reporting each read through `onProgress`. Reads that get no answer are
   * asked again until the deadline. Paying takes Bitcoin confirmations, so a
   * short timeout usually returns `settled: false` with the shares as they
   * stand; call it again later.
   */
  public followWithdrawalShares = async (params: {
    withdrawalRequestHash: string;
    requestorAddress: string;
    shares: VbtcAllocationInput[];
    onProgress?: (shares: VbtcWithdrawalShare[]) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<VbtcWithdrawalSharesResult> => {
    const pollIntervalMs = params.pollIntervalMs ?? 15_000;
    const deadline = Date.now() + (params.timeoutMs ?? 10 * 60 * 1000);
    let shares: VbtcWithdrawalShare[] | null = null;
    let lastError: string | undefined;
    for (;;) {
      try {
        shares = await this.getWithdrawalShares(params);
        lastError = undefined;
        params.onProgress?.(shares);
        if (shares.every((share) => isFinalShareOutcome(share.outcome))) {
          return { withdrawalRequestHash: params.withdrawalRequestHash, shares, settled: true };
        }
      } catch (error) {
        if (!isTransientReadError(error)) throw error;
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (Date.now() + pollIntervalMs > deadline) {
        return {
          withdrawalRequestHash: params.withdrawalRequestHash,
          shares: shares ?? [],
          settled: false,
          ...(lastError ? { lastError } : {}),
        };
      }
      await sleep(pollIntervalMs);
    }
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
    const flowId = await this.approveFlow(signer, {
      action: 'vbtc-withdrawal-cancel',
      scIdentifier: params.scIdentifier,
      ownerAddress: params.ownerAddress,
      withdrawalRequestHash: params.withdrawalRequestHash,
    });
    const prepared = await this.vbtcV2ApiClient.prepareWithdrawCancel({
      sc_identifier: params.scIdentifier,
      owner_address: params.ownerAddress,
      withdrawal_request_hash: params.withdrawalRequestHash,
    });
    this.assertPrepared(prepared, 'cancelWithdrawal:prepare');

    const sent = await this.signAndSend(
      prepared,
      signer,
      (body) => this.vbtcV2ApiClient.sendWithdrawCancel(body),
      flowId,
    );
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
      ...this.txBuildOptions,
    });
    const transactionHash = await txBuilder.process(this.dryRun);
    return transactionHash ? { transactionHash, scIdentifier } : null;
  };

  /**
   * Owner only; the token must be mintable. Tokens are credited to the signer.
   * Throws before building when the network would refuse the mint: a paused
   * token, more decimal places than the token's, or a supply or balance past
   * the largest amount, judged against the token as Spyglass last indexed it.
   */
  public mintToken = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; amount: number; ticker?: string; name?: string } & ReserveSendOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    assertPositiveAmount(params.amount);
    const { token, holders } = await this.tokenApiClient.getToken(params.scIdentifier);
    const refusal = tokenMintRefusal(token, params.amount, holders[resolved.address] ?? 0);
    if (refusal) {
      throw new Error(refusal);
    }
    const data = tokenMintData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      amount: params.amount,
      ticker: params.ticker ?? token.ticker,
      name: params.name ?? token.name,
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
    const toAddress = await this.resolveRecipient(params.toAddress, 'transferToken');
    const identity = await this.tokenIdentity(params);
    const data = tokenTransferData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      toAddress,
      amount: params.amount,
      ...identity,
    });
    return this.sendTokenTx(resolved, toAddress, data, params.unlockHours);
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
    const toAddress = await this.resolveRecipient(params.toAddress, 'transferTokenOwnership');
    const data = tokenOwnerChangeData({
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      toAddress,
    });
    return this.sendTokenTx(resolved, toAddress, data, params.unlockHours);
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

  // ---------------------------------------------------------------------------
  // NFTs (VFX10 smart contracts)
  //
  // The node builds every NFT transaction's Data (compile, transfer, evolve,
  // burn) through Spyglass, and the SDK signs and sends it like any other
  // transaction, so local hashing and every key source apply. Each method is
  // one approved action for a signer with `approve`.
  // ---------------------------------------------------------------------------

  /**
   * Upload a media file to Spyglass for use in `mintNft`. Resolves to the
   * asset to pass as `asset` or in `additionalAssets`.
   */
  public uploadNftAsset = async (file: Blob, fileName: string): Promise<NftAssetInput> => {
    if (this.dryRun) {
      throw new Error('uploadNftAsset does not support dryRun mode: Spyglass stores the file for real');
    }
    const named = typeof File !== 'undefined' && file instanceof File ? file : new File([file], fileName);
    const result = await this.mediaApiClient.uploadAsset(named);
    if (!result?.url) {
      throw new Error(`uploadNftAsset: Spyglass did not store ${fileName}`);
    }
    const dot = fileName.lastIndexOf('.');
    return {
      url: result.url,
      name: fileName,
      extension: dot > 0 ? fileName.slice(dot + 1) : '',
      fileSize: file.size,
    };
  };

  /** Mint an NFT owned by the signer. Resolves to the mint hash and the new contract id. */
  public mintNft = async (
    signer: KeypairOrSigner,
    params: NftMintParams,
    options: RefusalOptions = {},
  ): Promise<{ transactionHash: string; scIdentifier: string } | null> => {
    const resolved = this.resolve(signer);
    this.assertNotReserve(resolved, 'mintNft');
    const flowId = await this.approveFlow(resolved, {
      action: 'nft-mint',
      minterAddress: resolved.address,
      names: [params.name],
    });
    return this.mintOneNft(resolved, params, flowId, options);
  };

  /**
   * Mint several NFTs, one transaction each, in order, under one approval.
   * Stops at the first one that fails and throws NftBulkMintError carrying
   * the ones already minted.
   */
  public mintNfts = async (
    signer: KeypairOrSigner,
    items: NftMintParams[],
    options: RefusalOptions = {},
  ): Promise<Array<{ transactionHash: string; scIdentifier: string }>> => {
    const resolved = this.resolve(signer);
    this.assertNotReserve(resolved, 'mintNfts');
    if (items.length === 0) {
      return [];
    }
    // Every payload is checked before anything is approved or sent.
    for (const item of items) {
      nftMintPayload({ ...item, minterAddress: resolved.address });
    }
    const flowId = await this.approveFlow(resolved, {
      action: 'nft-mint',
      minterAddress: resolved.address,
      names: items.map((item) => item.name),
    });
    const minted: Array<{ transactionHash: string; scIdentifier: string }> = [];
    for (const [index, item] of items.entries()) {
      let result: { transactionHash: string; scIdentifier: string } | null;
      try {
        result = await this.mintOneNft(resolved, item, flowId, options);
      } catch (error) {
        throw new NftBulkMintError(index, minted, error);
      }
      if (!result) {
        throw new NftBulkMintError(index, minted, new Error('the mint was rejected before it reached the node'));
      }
      minted.push(result);
    }
    return minted;
  };

  private async mintOneNft(
    signer: ResolvedSigner,
    params: NftMintParams,
    flowId: string,
    options: RefusalOptions,
  ): Promise<{ transactionHash: string; scIdentifier: string } | null> {
    const payload = nftMintPayload({ ...params, minterAddress: signer.address });
    const data = await this.rawTransactionApiClient.getSmartContractDeployData(payload);
    const scIdentifier = data[0].ContractUID as string;
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: signer.address,
      amount: 0,
      txType: TxType.NftMint,
      data,
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      ...refusalOverride(options),
      flowId,
      approved: true,
    });
    const transactionHash = await txBuilder.process(this.dryRun);
    return transactionHash ? { transactionHash, scIdentifier } : null;
  }

  /**
   * Transfer an NFT the signer owns. From a vault (xRBX) the transfer waits
   * `unlockHours` (24 minimum) and can be called back until then.
   *
   * The node hands the media to the recipient through a beacon: the owner
   * signs the contract id and the node pushes the files. An NFT without
   * media skips that (locator "NA"). Pass `locator` to use one already
   * obtained.
   */
  public transferNft = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; toAddress: string; locator?: string } & ReserveSendOptions & RefusalOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const toAddress = await this.resolveRecipient(params.toAddress, 'transferNft');
    assertRecipientOnNetwork(toAddress, this.network, 'transferNft toAddress');
    const unlockTime = this.unlockTimeFor(resolved, params.unlockHours);
    const flowId = await this.approveFlow(resolved, {
      action: 'nft-transfer',
      scIdentifier: params.scIdentifier,
      fromAddress: resolved.address,
      toAddress,
      unlockHours:
        unlockTime === null ? null : Math.max(params.unlockHours ?? RESERVE_MIN_UNLOCK_HOURS, RESERVE_MIN_UNLOCK_HOURS),
    });

    let locator = params.locator;
    if (!locator) {
      const nft = await this.nftApiClient.getNft(params.scIdentifier);
      if (nft.owner_address && nft.owner_address !== resolved.address) {
        throw new Error(
          `transferNft: ${params.scIdentifier} is owned by ${nft.owner_address}, not ${resolved.address}`,
        );
      }
      if (nftIsMedialess(nft)) {
        locator = 'NA';
      } else if (this.dryRun) {
        // The beacon upload pushes the files to the recipient for real, so a
        // dry run must not trigger it.
        throw new Error(
          'transferNft: a dry run of an NFT with media needs a `locator`; requesting one would push the files',
        );
      } else {
        const beaconSignature = await resolved.sign(params.scIdentifier, {
          kind: 'nft-beacon-upload',
          flowId,
          message: params.scIdentifier,
          scIdentifier: params.scIdentifier,
          toAddress,
        });
        locator = await this.rawTransactionApiClient.beaconUploadRequest(
          params.scIdentifier,
          toAddress,
          beaconSignature,
        );
      }
    }

    const data = await this.rawTransactionApiClient.getNftTransferData(params.scIdentifier, toAddress, locator);
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer: resolved,
      toAddress,
      amount: 0,
      txType: TxType.NftTx,
      data,
      unlockTime,
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      ...refusalOverride(params),
      flowId,
      approved: true,
    });
    return txBuilder.process(this.dryRun);
  };

  /**
   * Move an evolving NFT to `stage` (1 is the first phase; a lower stage
   * than the current one devolves it). Only the minter can do this, for an
   * NFT wherever it is held; the transaction goes to the current owner,
   * read from Spyglass unless `ownerAddress` is given. The NFT is read from
   * Spyglass first and the call throws, before anything is signed, when
   * Core's rules would refuse it (`nftEvolveRefusal`).
   */
  public evolveNft = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; stage: number; ownerAddress?: string } & RefusalOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    if (!Number.isInteger(params.stage) || params.stage < 0) {
      throw new Error('evolveNft: stage must be a whole number, 0 or more');
    }
    const nft = await this.nftApiClient.getNft(params.scIdentifier);
    const refusal = nftEvolveRefusal(nft, resolved.address, params.stage);
    if (refusal) {
      throw new Error(`evolveNft: ${refusal}`);
    }
    const ownerAddress = params.ownerAddress ?? nft.owner_address;
    const flowId = await this.approveFlow(resolved, {
      action: 'nft-evolve',
      scIdentifier: params.scIdentifier,
      minterAddress: resolved.address,
      ownerAddress,
      stage: params.stage,
    });
    const data = await this.rawTransactionApiClient.getNftEvolveData(params.scIdentifier, ownerAddress, params.stage);
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer: resolved,
      toAddress: ownerAddress,
      amount: 0,
      txType: TxType.NftTx,
      data,
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      ...refusalOverride(params),
      flowId,
      approved: true,
    });
    return txBuilder.process(this.dryRun);
  };

  /**
   * The beacon locators the node last recorded for an NFT's media, "NA" when
   * it has none, or null when the node has no answer for it.
   */
  public getNftLocators = async (scIdentifier: string): Promise<string | null> => {
    return this.rawTransactionApiClient.getLocators(scIdentifier);
  };

  /**
   * After receiving an NFT with media, ask the node to fetch the files from
   * the beacons the sender pushed them to (the wallet does this when the
   * transfer lands). The new owner signs the contract id. Returns the
   * locators used, or `pulled: false` for an NFT without media (locator
   * "NA"), which has nothing to fetch. Spyglass shows the new media URLs
   * about 30 s after a pull.
   */
  public pullNftBeaconAssets = async (
    signer: KeypairOrSigner,
    scIdentifier: string,
  ): Promise<{ locators: string; pulled: boolean }> => {
    const resolved = this.resolve(signer);
    if (this.dryRun) {
      throw new Error('pullNftBeaconAssets does not support dryRun mode: the node fetches the files for real');
    }
    const locators = await this.rawTransactionApiClient.getLocators(scIdentifier);
    if (!locators) {
      throw new Error(`pullNftBeaconAssets: the node has no beacon locators for ${scIdentifier}`);
    }
    if (locators === 'NA') {
      return { locators, pulled: false };
    }
    const signature = await resolved.sign(scIdentifier, {
      kind: 'nft-beacon-download',
      flowId: newFlowId(),
      message: scIdentifier,
      scIdentifier,
      locators,
    });
    await this.rawTransactionApiClient.beaconAssetsRequest(scIdentifier, locators, resolved.address, signature);
    return { locators, pulled: true };
  };

  /**
   * Read the VFX-SHH message in an NFT: the one in its current evolve
   * stage's description, else in its own description, as the wallet looks.
   * Needs the recipient's private key (a Keypair): a Signer only signs, and
   * decryption needs the key itself. Returns null when the NFT carries no
   * message; throws when `keypair` is not the recipient or the message does
   * not decrypt.
   */
  public decryptNftMessage = async (
    keypair: Keypair,
    nftOrScIdentifier: VfxNft | string,
  ): Promise<{ recipientAddress: string; message: string } | null> => {
    const nft =
      typeof nftOrScIdentifier === 'string' ? await this.nftApiClient.getNft(nftOrScIdentifier) : nftOrScIdentifier;
    const current = nftEvolveStages(nft).find((stage) => stage.IsCurrentState);
    const encrypted =
      (current && parseVfxShhMessage(String(current.Description ?? ''))) ?? parseVfxShhMessage(nft.description ?? '');
    if (!encrypted) {
      return null;
    }
    if (keypair.address !== encrypted.recipientAddress) {
      throw new Error(`decryptNftMessage: the message is for ${encrypted.recipientAddress}, not ${keypair.address}`);
    }
    const message = await decryptVfxShh(encrypted.encryptedData, keypair.privateKey);
    return { recipientAddress: encrypted.recipientAddress, message };
  };

  /** Burn an NFT the signer owns. */
  public burnNft = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string } & RefusalOptions,
  ): Promise<string | null> => {
    const resolved = this.resolve(signer);
    const flowId = await this.approveFlow(resolved, {
      action: 'nft-burn',
      scIdentifier: params.scIdentifier,
      ownerAddress: resolved.address,
    });
    const data = await this.rawTransactionApiClient.getNftBurnData(params.scIdentifier, resolved.address);
    const txBuilder = new RawTransactionService({
      network: this.network,
      signer: resolved,
      toAddress: resolved.address,
      amount: 0,
      txType: TxType.NftBurn,
      data,
      unlockTime: this.unlockTimeFor(resolved),
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      ...refusalOverride(params),
      flowId,
      approved: true,
    });
    return txBuilder.process(this.dryRun);
  };

  /**
   * A proof that the signer owns `scIdentifier`, in the wallet's format
   * (`address<>message<>signature<>scIdentifier`), for anyone to check with
   * `verifyNftOwnership`. The message is a random string and the time.
   */
  public proveNftOwnership = async (signer: KeypairOrSigner, scIdentifier: string): Promise<string> => {
    const resolved = this.resolve(signer);
    const message = `${generateRandomStringSecure(8, OWNERSHIP_NONCE_CHARSET)}.${Math.round(Date.now() / 1000)}`;
    const signature = await resolved.sign(message, {
      kind: 'nft-ownership-proof',
      flowId: newFlowId(),
      message,
      scIdentifier,
    });
    return nftOwnershipProof(resolved.address, message, signature, scIdentifier);
  };

  /** Whether the node accepts an ownership proof from `proveNftOwnership` (or the wallet). */
  public verifyNftOwnership = async (proof: string): Promise<boolean> => {
    if (proof.split('<>').length !== 4) {
      throw new Error('verifyNftOwnership: expected address<>message<>signature<>scIdentifier');
    }
    return this.nftApiClient.verifyOwnership(proof);
  };

  /**
   * Replace the URLs Spyglass serves an NFT's media from, as its owner. The
   * signer signs a session message for a Spyglass token first.
   */
  public associateNftMedia = async (
    signer: KeypairOrSigner,
    params: { scIdentifier: string; mediaMap: Record<string, string> },
  ): Promise<void> => {
    const resolved = this.resolve(signer);
    if (this.dryRun) {
      throw new Error("associateNftMedia does not support dryRun mode: it replaces the NFT's live media URLs");
    }
    const message = `${generateRandomStringSecure(16, OWNERSHIP_NONCE_CHARSET)}.${Math.round(Date.now() / 1000)}`;
    const signature = await resolved.sign(message, { kind: 'spyglass-auth', flowId: newFlowId(), message });
    const { token } = await this.authApiClient.signToken(resolved.address, message, signature);
    await this.mediaApiClient.associateMedia(params.scIdentifier, params.mediaMap, token);
  };

  /** NFTs by owner and/or minter, newest first, as Spyglass indexes them. */
  public listNfts = async (query: NftListQuery = {}): Promise<PaginatedResponse<VfxNft>> => {
    return this.nftApiClient.listNfts(query);
  };

  /** NFTs owned by any of these addresses (a main account and its vault, say). */
  public listNftsForAddresses = async (
    addresses: string[],
    query: Omit<NftListQuery, 'ownerAddress' | 'minterAddress'> = {},
  ): Promise<PaginatedResponse<VfxNft>> => {
    return this.nftApiClient.listNftsForAddresses(addresses, query);
  };

  public getNft = async (scIdentifier: string): Promise<VfxNft> => {
    return this.nftApiClient.getNft(scIdentifier);
  };

  public getNftHistory = async (scIdentifier: string): Promise<unknown> => {
    return this.nftApiClient.getNftHistory(scIdentifier);
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
      ...this.txBuildOptions,
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
  // the delay to VFX, vBTC and NFT sends. It refuses fungible-token
  // transfers and burns from a vault (LedgerIntegrityRules.ReserveTokenTransfer),
  // since those would move at once and could not be called back.
  // ---------------------------------------------------------------------------

  /**
   * Activate a funded reserve account on the network: a 4 VFX Register()
   * naming the recovery address. The vault must already hold the 4 VFX plus
   * the fee plus the 0.5 VFX floor the node keeps on reserve accounts.
   *
   * `recoveryAddress` is always given explicitly and is the address of a key
   * kept apart from the vault's: `newRecoveryKey()`,
   * `recoveryKeyFromPasskeyPrf()`, or an account in another wallet. The SDK
   * never makes the recovery key here. It refuses the recovery address the
   * Flutter web wallet would have derived from this vault key, since that
   * key falls with the vault key.
   */
  public registerReserveAccount = async (
    signer: KeypairOrSigner,
    params: { recoveryAddress: string },
  ): Promise<string | null> => {
    const resolved = this.resolveReserve(signer, 'registerReserveAccount');
    const recoveryAddress = this.checkedRecoveryAddress(signer, resolved, params?.recoveryAddress);
    return this.sendReserveTx(
      resolved,
      { Function: 'Register()', RecoveryAddress: recoveryAddress },
      {
        amount: RESERVE_ACTIVATION_COST,
        unlockTime: null,
      },
    );
  };

  /** The recovery address Register() will accept, or a throw saying why not. */
  private checkedRecoveryAddress(
    signer: KeypairOrSigner,
    resolved: ResolvedSigner,
    recoveryAddress: string | undefined,
  ): string {
    if (!recoveryAddress) {
      throw new Error(
        'registerReserveAccount requires a recoveryAddress: the address of a recovery key kept apart from the vault key',
      );
    }
    if (recoveryAddress === resolved.address || recoveryAddress.startsWith(RESERVE_ADDRESS_PREFIX)) {
      throw new Error('recoveryAddress must be an ordinary account, not a reserve account');
    }
    assertRecipientOnNetwork(recoveryAddress, this.network, 'registerReserveAccount recoveryAddress');
    const vaultPrivateKey = (signer as Partial<Keypair>).privateKey;
    if (
      vaultPrivateKey &&
      this.keypairService.restoreLegacyWebWalletVaultFromVaultKey(vaultPrivateKey).recoveryAddress === recoveryAddress
    ) {
      throw new Error(
        'recoveryAddress is derived from the vault key (the legacy web-wallet scheme), so it gives no protection ' +
          'against theft; use newRecoveryKey(), recoveryKeyFromPasskeyPrf() or another wallet',
      );
    }
    return recoveryAddress;
  }

  /**
   * Fund a new vault and activate it, the Flutter wallet's "fund then
   * activate": `funder` sends `amount` VFX (default 5: the 4 VFX Register()
   * plus the 0.5 VFX floor and the fee) to the vault, the call waits until
   * Spyglass shows the vault holding it, then the vault registers with
   * `recoveryAddress`. Throws on timeout (default 30 minutes, the wallet's
   * auto-activation window) with the funding hash, so the activation can be
   * sent later with registerReserveAccount; a registration that fails after
   * funding throws with the funding hash too. The recovery address and the
   * amount are checked before anything is sent. Not available in dryRun mode.
   */
  public fundAndRegisterVault = async (
    funder: KeypairOrSigner,
    vault: KeypairOrSigner,
    params: { recoveryAddress: string; amount?: number; pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<{ fundingHash: string; registrationHash: string | null }> => {
    // Everything that can refuse the registration is checked before any
    // money moves, so a bad setting never leaves a funded, inactive vault.
    if (this.dryRun) {
      throw new Error(
        'fundAndRegisterVault does not support dryRun mode: it waits for the funding to land on chain. ' +
          'Dry-run sendCoin and registerReserveAccount separately instead',
      );
    }
    const amount = params.amount ?? VAULT_FUND_AND_ACTIVATE_AMOUNT;
    const minimum = RESERVE_ACTIVATION_COST + RESERVE_MIN_REMAINING_BALANCE + VAULT_REGISTER_FEE_ALLOWANCE;
    if (!(amount >= minimum)) {
      throw new Error(
        `fundAndRegisterVault: the vault needs at least ${minimum} VFX: ${RESERVE_ACTIVATION_COST} to register, ` +
          `${RESERVE_MIN_REMAINING_BALANCE} left over and ${VAULT_REGISTER_FEE_ALLOWANCE} for the fee`,
      );
    }
    const resolvedVault = this.resolveReserve(vault, 'fundAndRegisterVault');
    const recoveryAddress = this.checkedRecoveryAddress(vault, resolvedVault, params.recoveryAddress);
    const fundingHash = await this.sendCoin(funder, resolvedVault.address, amount);
    if (!fundingHash) {
      throw new Error('fundAndRegisterVault: the funding send was refused; nothing was sent');
    }
    const pollIntervalMs = params.pollIntervalMs ?? 10_000;
    const deadline = Date.now() + (params.timeoutMs ?? 30 * 60 * 1000);
    for (;;) {
      const details = await this.addressApiClient.getAddressDetails(resolvedVault.address).catch(() => null);
      if (details && details.balance >= amount) break;
      if (Date.now() + pollIntervalMs > deadline) {
        throw new Error(
          `fundAndRegisterVault: funding ${fundingHash} has not reached ${resolvedVault.address} yet; ` +
            'call registerReserveAccount once it has',
        );
      }
      await sleep(pollIntervalMs);
    }
    try {
      const registrationHash = await this.registerReserveAccount(vault, { recoveryAddress });
      return { fundingHash, registrationHash };
    } catch (e) {
      // A registration that may have reached the node keeps its type and
      // hash, so callers check the chain before retrying.
      if (e instanceof TransactionDispatchError) {
        e.message = `fundAndRegisterVault: funding ${fundingHash} landed; registration: ${e.message}`;
        throw e;
      }
      throw new VaultRegistrationError(fundingHash, e);
    }
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

    const flowId = newFlowId();
    // Approved before the recovery message is stamped: the node accepts it for ten minutes.
    const intent = {
      action: 'reserve-recovery' as const,
      flowId,
      reserveAddress: resolved.address,
      recoveryAddress,
    };
    await approveIntent(resolved, intent);
    if (recovery !== resolved) {
      await approveIntent(recovery, intent);
    }

    const signatureTime = Math.round(Date.now() / 1000);
    const recoveryMessage = `${signatureTime}${recoveryAddress}`;
    const recoverySigScript = await recovery.sign(recoveryMessage, {
      kind: 'reserve-recovery',
      flowId,
      message: recoveryMessage,
      reserveAddress: resolved.address,
      recoveryAddress,
      signatureTime,
    });

    return this.sendReserveTx(
      resolved,
      {
        Function: 'Recover()',
        RecoveryAddress: recoveryAddress,
        RecoverySigScript: recoverySigScript,
        SignatureTime: signatureTime,
      },
      { amount: 0, unlockTime: 0 },
      flowId,
    );
  };

  private async sendReserveTx(
    signer: ResolvedSigner,
    data: Record<string, unknown>,
    opts: { amount: number; unlockTime: number | null },
    approvedFlowId?: string,
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
      ...this.txBuildOptions,
      ...(approvedFlowId && { flowId: approvedFlowId, approved: true }),
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
    const requested = unlockHours ?? RESERVE_MIN_UNLOCK_HOURS;
    if (typeof requested !== 'number' || !Number.isFinite(requested)) {
      throw new Error(`unlockHours must be a number of hours, got ${requested}`);
    }
    // Below the network's minimum is raised to it, as the Flutter wallet does
    // (send_form_provider.dart), rather than refused.
    const hours = Math.max(requested, RESERVE_MIN_UNLOCK_HOURS);
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

  /**
   * The single-vault shape of requestWithdrawalMulti, for an allocation one
   * vault covers: the ordinary request through Spyglass, as the node's own
   * builder does. Sends only the request.
   */
  private async requestSingleShare(
    signer: ResolvedSigner,
    params: { btcAddress: string; feeRate: number; privateKey?: string; signer?: Signer },
    input: VbtcAllocationInput,
    maxFee: number,
    label: string,
    flowId: string,
  ): Promise<VbtcMultiWithdrawalResult> {
    const floor = withdrawalFeeFloorError(input.amount, params.feeRate, `Withdrawal from vault ${input.scIdentifier}`);
    if (floor) throw new Error(`${label}: ${floor}`);
    const prepared = await this.vbtcV2ApiClient.prepareWithdrawRequest({
      sc_identifier: input.scIdentifier,
      requestor_address: signer.address,
      btc_address: params.btcAddress,
      amount: input.amount,
      fee_rate: params.feeRate,
    });
    this.assertPrepared(prepared, `${label}:prepare`);
    const fee = typeof prepared.Fee === 'number' ? prepared.Fee : NaN;
    if (!(fee > 0) || fee > maxFee) {
      throw new PreSignCheckError(`${label}: refused to sign: fee ${prepared.Fee} VFX (limit ${maxFee})`);
    }
    const sent = await this.signAndSend(
      prepared,
      signer,
      (body) => this.vbtcV2ApiClient.sendWithdrawRequest(body),
      flowId,
    );
    this.assertSent(sent, `${label}:send`);
    return {
      withdrawalRequestHash: sent.Hash,
      inputs: [input],
      totalAmount: input.amount,
      btcAddress: params.btcAddress,
      feeRate: params.feeRate,
      fee,
    };
  }

  private async sendWatchedFeeBump(
    params: {
      scIdentifier: string;
      withdrawalRequestHash: string;
      feeRate: number;
      privateKey?: string;
      signer?: Signer;
    },
    release: boolean,
    label: string,
  ): Promise<string | null> {
    const signer = this.signerFor(params, label);
    if (!params.scIdentifier || !params.withdrawalRequestHash) {
      throw new Error(`${label} requires scIdentifier and withdrawalRequestHash`);
    }
    assertWatchedFeeRate(params.feeRate, label);

    const withdrawal = await this.getWithdrawalPin({
      scIdentifier: params.scIdentifier,
      withdrawalRequestHash: params.withdrawalRequestHash,
      requestorAddress: signer.address,
    });
    if (!withdrawal) {
      throw new Error(
        `${label}: the vault is not one the chain watches; there is nothing to ${release ? 'release' : 'raise'}`,
      );
    }
    const allowed = release ? withdrawal.canRelease : withdrawal.canRaiseFee;
    if (!allowed) {
      throw new Error(
        `${label}: the withdrawal cannot be ${release ? 'released' : 'raised'} now (${
          withdrawal.state ?? withdrawal.status
        }): ` + `${withdrawal.summary ?? withdrawal.message ?? 'no detail'}`,
      );
    }
    if (params.feeRate < withdrawal.minimumNextFeeRate) {
      throw new Error(
        `${label}: feeRate must be at least ${withdrawal.minimumNextFeeRate} sat/vB, above the ${withdrawal.feeRate} the pinned transaction pays`,
      );
    }

    const txBuilder = new RawTransactionService({
      network: this.network,
      signer,
      toAddress: signer.address,
      amount: 0,
      txType: TxType.VbtcV2CoinPin,
      data: watchedWithdrawalFeeBumpData({
        scIdentifier: params.scIdentifier,
        withdrawalRequestHash: params.withdrawalRequestHash,
        feeRate: params.feeRate,
        release,
      }),
      apiOptions: this.apiOptions,
      ...this.txBuildOptions,
      throwOnRefusal: true,
    });
    return txBuilder.process(this.dryRun);
  }

  /**
   * Where a watched vault's withdrawal stands, as completeWithdrawal reports
   * it. Waits only while the node has not recorded the request yet; a failed
   * request or an answer saying Spyglass could not reach the node is asked
   * again until `timeoutMs`. Stops on a real answer that the vault is not
   * watched, which cannot happen to a vault once watched.
   */
  private async watchedWithdrawalResult(opts: {
    scIdentifier: string;
    requestorAddress: string;
    withdrawalRequestHash: string;
    first: VbtcWatchedWithdrawal;
    onProgress: (event: VbtcProgressEvent) => void;
    pollIntervalMs: number;
    deadline: number;
  }): Promise<VbtcWithdrawalResult> {
    const deadline = opts.deadline;
    let withdrawal = opts.first;
    let lastError: unknown = null;
    for (;;) {
      opts.onProgress({
        phase: 'watched_polling',
        message: withdrawal.summary ?? withdrawal.message ?? withdrawal.status,
        data: withdrawal,
      });
      if (withdrawal.paid && withdrawal.btcTransactionHash) {
        return {
          withdrawalRequestHash: opts.withdrawalRequestHash,
          btcTransactionHash: withdrawal.btcTransactionHash,
          completionTransactionHash: withdrawal.completionTransactionHash ?? '',
          paid: true,
          watched: withdrawal,
        };
      }
      if (withdrawal.closed) {
        throw new VbtcWithdrawalClosedError(opts.withdrawalRequestHash, withdrawal);
      }
      if (!withdrawal.notMinedYet || Date.now() + opts.pollIntervalMs > deadline) {
        return {
          withdrawalRequestHash: opts.withdrawalRequestHash,
          btcTransactionHash: '',
          completionTransactionHash: '',
          paid: false,
          watched: withdrawal,
        };
      }

      // Not mined yet: ask again, riding out failed requests until the deadline.
      let next: VbtcWatchedWithdrawal | null | undefined;
      while (next === undefined) {
        await sleep(opts.pollIntervalMs);
        try {
          next = await this.getWithdrawalPin(opts);
        } catch (error) {
          if (!isTransientReadError(error)) throw error;
          lastError = error;
          if (Date.now() + opts.pollIntervalMs > deadline) {
            return {
              withdrawalRequestHash: opts.withdrawalRequestHash,
              btcTransactionHash: '',
              completionTransactionHash: '',
              paid: false,
              watched: withdrawal,
              lastError: error instanceof Error ? error.message : String(error),
            };
          }
        }
      }
      if (next === null) {
        throw new Error(
          `completeWithdrawal: withdrawal request ${opts.withdrawalRequestHash} was on a watched vault but the node ` +
            `now answers that it is not${lastError ? ` (after: ${String(lastError)})` : ''}`,
        );
      }
      withdrawal = next;
    }
  }

  private resolve(input: KeypairOrSigner | ResolvedSigner | { privateKey: string }): ResolvedSigner {
    return resolveSigner(input, this.keypairService);
  }

  /**
   * The address a `.vfx`/`.rbx` recipient names; any other recipient as given.
   * The network refuses a transaction addressed to a name, since it would
   * credit the name string itself, so the name is resolved before building.
   * The lookup is strict: an outage fails the call rather than reading as
   * "no such name".
   */
  private async resolveRecipient(toAddress: string, label: string): Promise<string> {
    if (!isNameRecipient(toAddress)) return toAddress;
    const name = toAddress.trim().toLowerCase();
    const address = await this.addressApiClient.lookupDomain(name, { strict: true });
    if (!address) {
      throw new Error(`${label}: no account holds the name ${toAddress}`);
    }
    // Send only when the address's own record agrees that it holds the name.
    // Both reads come from the same Spyglass index, so this does not detect an
    // index that lags the chain; it refuses a lookup that disagrees with it.
    const holder = await this.addressApiClient.getAddressDetails(address, { strict: true });
    if (holder?.adnr?.toLowerCase() !== name) {
      throw new Error(
        `${label}: ${toAddress} resolved to ${address}, whose own record names ${holder?.adnr ?? 'no domain'}; ` +
          `the two disagree, so nothing was sent`,
      );
    }
    return address;
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
    flowId: string,
  ): Promise<SentTransactionResponse> {
    const hash = prepared.Hash;
    const signature = await signer.sign(hash, this.preparedSigningRequest(prepared, flowId));
    // The prepare endpoint chose this transaction's nonce, so the session's
    // cached next nonce for the sender can no longer be trusted, whatever the
    // send's outcome.
    this.txBuildSession.forgetNonce(signer.address);
    // Same contract as RawTransactionService.process(): a failure once the
    // send request has gone out (a lost response, a timeout, or a 5xx that
    // Spyglass also returns when its own call to the node times out) leaves it
    // unknown whether the transaction was accepted. A plain error here would
    // read as "not sent" and invite a resend, so it carries the hash instead.
    // An explicit `success: false` body is a definite refusal: left to
    // assertSent, or with throwOnRefusal raised here as
    // TransactionRefusedError carrying the prepared hash and the reason.
    let sent: SentTransactionResponse;
    try {
      sent = await sendFn({ hash, signature, public_key: signer.publicKey });
    } catch (error) {
      throw new TransactionDispatchError(hash, error);
    }
    if (this.throwOnRefusal && sent?.success === false) {
      const body = sent as unknown as { message?: unknown; Message?: unknown };
      const reason = [body.message, body.Message].find((m) => typeof m === 'string' && m !== '') as string | undefined;
      throw new TransactionRefusedError(hash, reason ?? null);
    }
    return sent;
  }

  /**
   * Ask the signer to approve one user action and return its flow id. Inside
   * a flow that was already approved (`flow`), returns that flow's id
   * without asking again.
   */
  private async approveFlow(
    signer: ResolvedSigner,
    intent: DistributiveOmit<SigningIntent, 'flowId'>,
    flow?: ApprovedFlow,
  ): Promise<string> {
    if (flow) {
      return flow.flowId;
    }
    const flowId = newFlowId();
    await approveIntent(signer, { ...intent, flowId } as SigningIntent);
    return flowId;
  }

  /**
   * What a prepared (Spyglass-built) transaction says about itself, for the
   * signer. When the builder returned its `HashPreimage`, the hash is checked
   * against it first unless hashMode is 'server', so the SDK never signs a
   * hash that does not belong to the transaction it was shown.
   */
  private preparedSigningRequest(prepared: PreparedTransactionResponse, flowId: string): SigningRequest {
    const preimage = typeof prepared.HashPreimage === 'string' ? prepared.HashPreimage : undefined;
    if (preimage !== undefined && this.hashMode !== 'server') {
      const recomputed = hashPreimage(preimage);
      if (recomputed !== prepared.Hash) {
        throw new TransactionHashMismatchError(recomputed, prepared.Hash, preimage);
      }
    }
    const txType =
      typeof prepared.TransactionType === 'number'
        ? prepared.TransactionType
        : CORE_TX_TYPE_NAMES.indexOf(String(prepared.TransactionType ?? ''));
    const transaction: SigningTransaction = {
      Hash: prepared.Hash,
      FromAddress: String(prepared.FromAddress ?? ''),
      ToAddress: String(prepared.ToAddress ?? ''),
      TransactionType: txType,
      Amount: Number(prepared.Amount ?? 0),
      Fee: Number(prepared.Fee ?? 0),
      Nonce: Number(prepared.Nonce ?? 0),
      Timestamp: Number(prepared.Timestamp ?? 0),
      Data: prepared.Data ?? null,
      UnlockTime: typeof prepared.UnlockTime === 'number' ? prepared.UnlockTime : null,
    };
    return {
      kind: 'transaction',
      flowId,
      message: prepared.Hash,
      transaction,
      hashSource: 'prepared',
      ...(preimage !== undefined && { hashPreimage: preimage }),
    };
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

/**
 * A read that got no answer: a dropped or timed-out request, a 5xx, or
 * Spyglass saying it could not reach the node. Worth asking again; a 4xx or a
 * malformed answer is not.
 */
function isTransientReadError(error: unknown): boolean {
  if (error instanceof VbtcNodeUnreachableError) return true;
  if (error instanceof VfxApiError) return error.status === undefined || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

/** The txid of a signed Bitcoin transaction, or null if the hex does not parse. */
function btcTxidFromHex(hex: string): string | null {
  try {
    return BitcoinTransaction.fromHex(hex).getId();
  } catch {
    return null;
  }
}
