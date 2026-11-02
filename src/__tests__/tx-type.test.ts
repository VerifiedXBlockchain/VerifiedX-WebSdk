import { TxType } from '../constants';

// Core 9.0.1 Models/Transaction.cs TransactionType, in order.
const CORE_TRANSACTION_TYPES = [
  'TX',
  'NODE',
  'NFT_MINT',
  'NFT_TX',
  'NFT_BURN',
  'NFT_SALE',
  'ADNR',
  'DSTR',
  'VOTE_TOPIC',
  'VOTE',
  'RESERVE',
  'SC_MINT',
  'SC_TX',
  'SC_BURN',
  'FTKN_MINT',
  'FTKN_TX',
  'FTKN_BURN',
  'TKNZ_MINT',
  'TKNZ_TX',
  'TKNZ_BURN',
  'TKNZ_WD_ARB',
  'TKNZ_WD_OWNER',
  'VBTC_V2_VALIDATOR_REGISTER',
  'VBTC_V2_VALIDATOR_HEARTBEAT',
  'VBTC_V2_VALIDATOR_EXIT',
  'VBTC_V2_CONTRACT_CREATE',
  'VBTC_V2_TRANSFER',
  'VBTC_V2_WITHDRAWAL_REQUEST',
  'VBTC_V2_WITHDRAWAL_COMPLETE',
  'VBTC_V2_WITHDRAWAL_CANCEL',
  'VBTC_V2_WITHDRAWAL_VOTE',
  'VFX_SHIELD',
  'VFX_UNSHIELD',
  'VFX_PRIVATE_TRANSFER',
  'VBTC_V2_SHIELD',
  'VBTC_V2_UNSHIELD',
  'VBTC_V2_PRIVATE_TRANSFER',
  'VBTC_V2_BRIDGE_LOCK',
  'VBTC_V2_BRIDGE_UNLOCK',
  'VBTC_V2_BRIDGE_POOL_UNLOCK',
  'VBTC_V2_BRIDGE_EXIT_TO_BTC',
  'VBTC_V2_BRIDGE_EXIT_TO_BTC_COMPLETE',
  'VBTC_V2_BRIDGE_EXIT_TO_BTC_FAIL',
  'VBTC_V2_BTC_REPORT',
  'VBTC_V2_COIN_PIN',
  'VBTC_V2_BTC_REORG',
  'VBTC_V2_VAULT_REKEY',
];

const numericValues = Object.values(TxType).filter((v): v is number => typeof v === 'number');

test('TxType covers every Core TransactionType value exactly once', () => {
  expect([...numericValues].sort((a, b) => a - b)).toEqual(CORE_TRANSACTION_TYPES.map((_, i) => i));
});

test('existing member names keep their values', () => {
  expect(TxType.RbxTransfer).toBe(0);
  expect(TxType.Adnr).toBe(6);
  expect(TxType.Reserve).toBe(10);
  expect(TxType.TokenTx).toBe(15);
  expect(TxType.TokenDeploy).toBe(17);
  expect(TxType.VbtcV2ContractCreate).toBe(25);
  expect(TxType.VbtcV2WithdrawalCancel).toBe(29);
  expect(TxType.VbtcV2CoinPin).toBe(44);
});

test('new members line up with Core', () => {
  expect(TxType.ScMint).toBe(CORE_TRANSACTION_TYPES.indexOf('SC_MINT'));
  expect(TxType.FungibleTokenBurn).toBe(CORE_TRANSACTION_TYPES.indexOf('FTKN_BURN'));
  expect(TxType.VbtcV2WithdrawalVote).toBe(CORE_TRANSACTION_TYPES.indexOf('VBTC_V2_WITHDRAWAL_VOTE'));
  expect(TxType.VbtcV2BridgeExitToBtcFail).toBe(CORE_TRANSACTION_TYPES.indexOf('VBTC_V2_BRIDGE_EXIT_TO_BTC_FAIL'));
  expect(TxType.VbtcV2BtcReport).toBe(43);
  expect(TxType.VbtcV2BtcReorg).toBe(45);
  expect(TxType.VbtcV2VaultRekey).toBe(46);
});
