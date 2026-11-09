#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Generates src/__tests__/compat/tx-hash-vectors.json: transactions and the
 * hash the live TESTNET node returns for each through Spyglass `/raw/hash`.
 * The local port (src/services/transaction-hash.ts) must reproduce every
 * one. Testnet only; nothing is signed or sent.
 *
 *   node scripts/gen-tx-hash-vectors.js > src/__tests__/compat/tx-hash-vectors.json
 *
 * Env: VFX_HASH_API (default https://data-testnet.verifiedx.io/api).
 */
const crypto = require('crypto');

const api = process.env.VFX_HASH_API || 'https://data-testnet.verifiedx.io/api';
if (api.includes('data.verifiedx.io')) {
  throw new Error('gen-tx-hash-vectors runs against testnet only');
}

const FROM = 'xHoSVXZ3cpM25XJC2qif3hCbzUFwYe2MLp';
const TO = 'xRimtLcd4oLRKzirpBLedsGMqdX8mhd699';
const RESERVE_FROM = 'xRBXJF6Fbnj9UzGhFmtzN5fxrHmwRVdmoE';

const amounts = [
  0, 1, 2, 10, 100, 1000000, 123456789, 0.1, 0.5, 1.5, 0.2 + 0.1, 0.00001, 0.000001, 0.0000001, 0.00000001,
  1.23456789, 12345.678901, 0.00025, 99.99999999, 1e-9, 1.1e-5, 3.0000001, 199999999.12345678, 1e15, 2.5e15,
];
const fees = [0, 0.000003, 0.000004, 0.00001, 0.00002, 0.00025, 0.0000425, 0.00012345, 0.1, 1, 0.00000999];
const dataCases = [
  null,
  { Function: 'Transfer()', Amount: 1.5, Ticker: 'ABC' },
  { Function: 'Transfer()', Amount: 1, Nested: { a: [1, 2.5, 0.00001, 1e-7, true, false, null] } },
  [{ Function: 'Mint()', ContractUID: 'abc:123', Data: 'x' }],
  { Text: 'quote " backslash \\ slash / tab \t newline \n return \r' },
  { Text: 'control \u0001\u001f del \u007f next \u0085 seps \u2028\u2029' },
  { Text: 'unicode ñ é 漢字 🙂 <tag> & \'apostrophe\'' },
  { Big: 12345678901234567000, Float: 1e21, Small: -0.5, Neg: -3, Zero: 0, NegZero: -0 },
  { Floats: [0.1, 0.30000000000000004, 123456789012345.6, 1234567890123456.7, 1e15, 1e14 + 0.5, 1e-5, 1e-6] },
  { Edge: [0.0001, 1e21, 1.5e22, 1e300, 2.5e-300, -1e-5, -0.5, 12345678901234.5] },
  { '1': 'numeric key', b: 'b', a: 'a' },
  { Empty: {}, List: [], Str: '' },
];
const types = [0, 1, 2, 3, 6, 10, 12, 15, 17, 25, 26, 27, 28, 29, 37, 40, 43, 46];

function rng(label) {
  return parseInt(crypto.createHash('sha256').update(label).digest('hex').slice(0, 8), 16);
}

const cases = [];
let i = 0;
for (const amount of amounts) {
  cases.push({ Amount: amount, Fee: fees[rng(`fee:${i}`) % fees.length], TransactionType: 0, Data: null });
  i++;
}
for (const fee of fees) {
  cases.push({ Amount: 1, Fee: fee, TransactionType: 0, Data: null });
}
for (const data of dataCases) {
  for (const txType of [15, 26]) {
    cases.push({ Amount: 0, Fee: 0.00004, TransactionType: txType, Data: data });
  }
}
for (const txType of types) {
  cases.push({ Amount: 0.5, Fee: 0.00002, TransactionType: txType, Data: { Function: 'Op()' } });
}
cases.push({ Amount: 1, Fee: 0.00002, TransactionType: 0, Data: null, UnlockTime: 0, FromAddress: RESERVE_FROM });
cases.push({ Amount: 1, Fee: 0.00002, TransactionType: 0, Data: null, UnlockTime: 1767225600, FromAddress: RESERVE_FROM });
cases.push({ Amount: 0, Fee: 0.00002, TransactionType: 10, Data: { Function: 'Recover()' }, UnlockTime: 0 });

async function serverHash(tx) {
  const response = await fetch(`${api}/raw/hash/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: tx }),
  });
  const body = await response.json();
  if (body?.Result !== 'Success') {
    throw new Error(`/raw/hash refused ${JSON.stringify(tx)}: ${JSON.stringify(body)}`);
  }
  return body.Hash;
}

(async () => {
  const vectors = [];
  for (const [index, c] of cases.entries()) {
    const tx = {
      Hash: '',
      ToAddress: TO,
      FromAddress: c.FromAddress ?? FROM,
      TransactionType: c.TransactionType,
      Amount: c.Amount,
      Nonce: rng(`nonce:${index}`) % 5000,
      Fee: c.Fee,
      Timestamp: 1762600000 + index,
      Signature: '',
      Height: 0,
      Data: c.Data,
      UnlockTime: c.UnlockTime ?? null,
    };
    vectors.push({ transaction: tx, hash: await serverHash(tx) });
  }
  // JSON allows raw U+2028/U+2029 but TypeScript's JSON import does not.
  const json = JSON.stringify({ source: `${api}/raw/hash`, generatedAt: new Date().toISOString(), vectors }, null, 1);
  process.stdout.write(json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
