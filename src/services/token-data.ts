import {
  SMART_CONTRACT_DEFAULT_ASSET_LOCATION,
  SMART_CONTRACT_PLACEHOLDER_UUID,
  TOKEN_DEFAULT_DECIMAL_PLACES,
  TOKEN_FEATURE_ID,
  TOKEN_MAX_DECIMAL_PLACES,
  TOKEN_MIN_DECIMAL_PLACES,
  TOKEN_TICKER_MAX_LENGTH,
} from '../constants';
import { DeployTokenParams } from '../types';

/**
 * Builders for the `Data` payload of every fungible-token transaction, and
 * for the compiler payload a deploy is built from. Field names and order
 * mirror the web wallet, which is the reference implementation the node has
 * been accepting these from in production.
 *
 * The node validates ContractUID, FromAddress, ToAddress and Amount; ticker
 * and name ride along for indexers and wallets that read them off the chain.
 */

export type TokenTxData = Record<string, unknown>;

export function assertPositiveAmount(amount: number, label = 'amount'): void {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive number, got ${String(amount)}`);
  }
}

export function assertAddress(address: string, label: string): void {
  if (typeof address !== 'string' || address.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

export function assertScIdentifier(scIdentifier: string): void {
  if (typeof scIdentifier !== 'string' || scIdentifier.trim().length === 0) {
    throw new Error('scIdentifier is required');
  }
}

export function tokenMintData(params: {
  scIdentifier: string;
  fromAddress: string;
  amount: number;
  ticker: string;
  name: string;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  assertPositiveAmount(params.amount);
  return {
    Function: 'TokenMint()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    Amount: params.amount,
    TokenTicker: params.ticker,
    TokenName: params.name,
  };
}

export function tokenTransferData(params: {
  scIdentifier: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  ticker: string;
  name: string;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  assertAddress(params.toAddress, 'toAddress');
  assertPositiveAmount(params.amount);
  return {
    Function: 'TokenTransfer()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    ToAddress: params.toAddress,
    Amount: params.amount,
    TokenTicker: params.ticker,
    TokenName: params.name,
  };
}

export function tokenBurnData(params: {
  scIdentifier: string;
  fromAddress: string;
  amount: number;
  ticker: string;
  name: string;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  assertPositiveAmount(params.amount);
  return {
    Function: 'TokenBurn()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    Amount: params.amount,
    TokenTicker: params.ticker,
    TokenName: params.name,
  };
}

/**
 * The node ignores `Pause` and toggles the current state, but indexers and
 * wallets read it as the resulting state (paused or resumed). Send the state
 * the toggle produces, as the node's own PauseTokenContract endpoint does.
 */
export function tokenPauseData(params: { scIdentifier: string; fromAddress: string; pause: boolean }): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  return {
    Function: 'TokenPause()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    Pause: params.pause,
  };
}

export function tokenBanAddressData(params: {
  scIdentifier: string;
  fromAddress: string;
  banAddress: string;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  assertAddress(params.banAddress, 'address to ban');
  return {
    Function: 'TokenBanAddress()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    BanAddress: params.banAddress,
  };
}

export function tokenOwnerChangeData(params: {
  scIdentifier: string;
  fromAddress: string;
  toAddress: string;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  assertAddress(params.toAddress, 'toAddress');
  return {
    Function: 'TokenContractOwnerChange()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    ToAddress: params.toAddress,
  };
}

export function tokenVoteTopicCreateData(params: {
  scIdentifier: string;
  fromAddress: string;
  topicUid: string;
  name: string;
  description: string;
  minimumVoteRequirement: number;
  blockHeight: number;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds. */
  votingEndsAt: number;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  if (!params.name || params.name.length > 128) {
    throw new Error('topic name is required and must be at most 128 characters');
  }
  if (params.description.length > 1600) {
    throw new Error('topic description must be at most 1600 characters');
  }
  if (params.votingEndsAt <= params.createdAt) {
    throw new Error('voting must end after it starts');
  }
  return {
    Function: 'TokenVoteTopicCreate()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    TokenVoteTopic: {
      SmartContractUID: params.scIdentifier,
      TopicUID: params.topicUid,
      TopicName: params.name,
      TopicDescription: params.description,
      MinimumVoteRequirement: params.minimumVoteRequirement,
      BlockHeight: params.blockHeight,
      TokenHolderCount: 1,
      TopicCreateDate: params.createdAt,
      VotingEndDate: params.votingEndsAt,
      VoteYes: 0,
      VoteNo: 0,
      TotalVotes: 0,
      PercentVotesYes: 0,
      PercentVotesNo: 0,
      PercentInFavor: 0,
      PercentAgainst: 0,
    },
  };
}

export function tokenVoteCastData(params: {
  scIdentifier: string;
  fromAddress: string;
  topicUid: string;
  vote: boolean;
}): TokenTxData {
  assertScIdentifier(params.scIdentifier);
  if (!params.topicUid) {
    throw new Error('topicUid is required');
  }
  return {
    Function: 'TokenVoteTopicCast()',
    ContractUID: params.scIdentifier,
    FromAddress: params.fromAddress,
    TopicUID: params.topicUid,
    VoteType: params.vote ? 1 : 0,
  };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1) : '';
}

function fileNameOf(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0];
  const segment = withoutQuery
    .split('/')
    .filter((s) => s.length > 0)
    .pop();
  return segment ?? 'asset';
}

/**
 * Validate deploy parameters and build the compiler payload the node turns
 * into a token contract. Throws on anything the node or the indexer would
 * reject later, when the reason is much harder to see.
 */
export function tokenDeployPayload(params: DeployTokenParams & { minterAddress: string }): Record<string, unknown> {
  const name = params.name?.trim();
  if (!name) {
    throw new Error('name is required');
  }
  const ticker = params.ticker?.trim().toUpperCase();
  if (!ticker || ticker.length > TOKEN_TICKER_MAX_LENGTH) {
    throw new Error(`ticker is required and must be at most ${TOKEN_TICKER_MAX_LENGTH} characters`);
  }
  const decimalPlaces = params.decimalPlaces ?? TOKEN_DEFAULT_DECIMAL_PLACES;
  if (
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < TOKEN_MIN_DECIMAL_PLACES ||
    decimalPlaces > TOKEN_MAX_DECIMAL_PLACES
  ) {
    throw new Error(`decimalPlaces must be an integer from ${TOKEN_MIN_DECIMAL_PLACES} to ${TOKEN_MAX_DECIMAL_PLACES}`);
  }
  const mintable = params.mintable ?? false;
  const initialSupply = params.initialSupply ?? 0;
  if (!Number.isInteger(initialSupply) || initialSupply < 0) {
    throw new Error('initialSupply must be a whole number of tokens (0 or more)');
  }
  if (mintable && initialSupply > 0) {
    throw new Error(
      'A mintable token has an open-ended supply and must be deployed with initialSupply 0; mint the opening balance with mintToken after deploy',
    );
  }
  if (!mintable && initialSupply === 0) {
    throw new Error('A non-mintable token with initialSupply 0 could never have any supply');
  }

  const image = params.image;
  const assetName = image ? image.name ?? fileNameOf(image.url) : SMART_CONTRACT_DEFAULT_ASSET_LOCATION;
  const asset = {
    AssetId: SMART_CONTRACT_PLACEHOLDER_UUID,
    Name: assetName,
    AssetAuthorName: params.minterAddress,
    Location: image ? image.url : SMART_CONTRACT_DEFAULT_ASSET_LOCATION,
    Extension: image ? image.extension ?? extensionOf(assetName) : '',
    FileSize: image ? image.fileSize ?? 0 : 0,
  };

  const tokenFeature = {
    TokenName: name,
    TokenTicker: ticker,
    TokenDecimalPlaces: decimalPlaces,
    TokenSupply: initialSupply,
    TokenBurnable: params.burnable ?? false,
    TokenMintable: mintable,
    TokenVoting: params.voting ?? false,
    TokenImageURL: image?.url ?? null,
    TokenImageBase: image?.thumbnailBase64 ?? null,
  };

  const description = (params.description?.trim() || name).replace(/\r/g, '').replace(/\n/g, '\\n');

  return {
    Name: name,
    MinterName: params.minterAddress,
    Description: description,
    SmartContractAsset: asset,
    IsPublic: false,
    Features: [{ FeatureName: TOKEN_FEATURE_ID, FeatureFeatures: tokenFeature }],
    MinterAddress: params.minterAddress,
    IsMinter: true,
    SCVersion: 1,
  };
}
