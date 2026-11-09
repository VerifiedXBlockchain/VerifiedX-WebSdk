import {
  canHashLocally,
  coreDataString,
  coreDecimalString,
  transactionHash,
  transactionHashPreimage,
} from '../../services/transaction-hash';
import { TxType } from '../../constants';
import vectors from './tx-hash-vectors.json';

/**
 * Golden vectors from the live testnet node through Spyglass `/raw/hash`
 * (scripts/gen-tx-hash-vectors.js). The local hash must agree with every one:
 * a mismatch means `hashMode: 'local'` would sign a hash the node refuses.
 * Regenerate from the node, never by hand.
 */
describe('compat(node): local transaction hash matches /raw/hash', () => {
  test.each(vectors.vectors.map((v, index) => ({ ...v, index })))(
    'vector $index (type $transaction.TransactionType, amount $transaction.Amount, fee $transaction.Fee)',
    ({ transaction, hash }) => {
      expect(transactionHash(transaction)).toBe(hash);
    },
  );
});

describe('decimal and Data formatting', () => {
  test('whole numbers keep a point and fractions keep their digits', () => {
    expect(coreDecimalString(0)).toBe('0.0');
    expect(coreDecimalString(1)).toBe('1.0');
    expect(coreDecimalString(1.5)).toBe('1.5');
    expect(coreDecimalString(0.00002)).toBe('0.00002');
    expect(coreDecimalString(1e-9)).toBe('0.000000001');
    expect(coreDecimalString(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(coreDecimalString(1e15)).toBe('1000000000000000.0');
  });

  test('Data floats are written the .NET way and integers as written', () => {
    expect(coreDataString(null)).toBe('');
    expect(coreDataString({ a: 1, b: 1.5, c: 0.00001, d: 1e15 + 0.5, e: 1e21 })).toBe(
      '{"a":1,"b":1.5,"c":1E-05,"d":1000000000000000.5,"e":1E+21}',
    );
    expect(coreDataString({ s: 'a"b\\c\n\u0001\u2028' })).toBe('{"s":"a\\"b\\\\c\\n\\u0001\\u2028"}');
  });

  test('UnlockTime is appended only when set, including 0', () => {
    const base = {
      Timestamp: 1,
      FromAddress: 'a',
      ToAddress: 'b',
      Amount: 1,
      Fee: 0.00002,
      Nonce: 3,
      TransactionType: TxType.RbxTransfer,
    };
    expect(transactionHashPreimage({ ...base, UnlockTime: null })).toBe('1ab1.00.000023TX');
    expect(transactionHashPreimage({ ...base, UnlockTime: 0 })).toBe('1ab1.00.000023TX0');
  });

  test('privacy and unknown types are refused rather than hashed wrong', () => {
    expect(canHashLocally(TxType.RbxTransfer)).toBe(true);
    expect(canHashLocally(TxType.VfxShield)).toBe(false);
    expect(canHashLocally(999)).toBe(false);
    expect(() =>
      transactionHash({
        Timestamp: 1,
        FromAddress: 'a',
        ToAddress: 'b',
        Amount: 1,
        Fee: 0.00002,
        Nonce: 1,
        TransactionType: TxType.VfxShield,
      }),
    ).toThrow(/private hash/);
  });
});
