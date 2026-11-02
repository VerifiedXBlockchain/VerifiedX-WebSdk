import { VfxClient } from '../index';
import type { VbtcTransfer, VbtcV2Token, VbtcWithdrawalStatus } from '../index';
import { installFetch } from './helpers/mock-fetch';

// Shapes copied from live Spyglass responses (data-testnet and data,
// 2026-11-01). Object literals get excess-property checks, so a field the
// API returns but the type lacks fails to compile.
const liveToken: VbtcV2Token = {
  sc_identifier: 'd24c5dbc18b641ceb3a3e0b7ae37db2c:1793322242',
  name: 'Bfly vBTC',
  description: 'Bfly vBTC account',
  owner_address: 'xViC6b8EGxgnfmgHfXimGXewrVm7wtdpsf',
  pending_owner_address: null,
  is_watched: true,
  image_url: 'https://vfx-resources.s3.amazonaws.com/defaultvBTC.gif',
  deposit_address: 'tb1pp926x3jqv7qtfsjumeuhyxz3z5tgzf5gnr2y7dyy8w4kpz94m4jq5wx3gr',
  frost_group_public_key: '020955a346406780b4c25cde79721851151681268898d44f34843bab6088b5dd64',
  required_threshold: 51,
  proof_block_height: 48011,
  global_balance: 0,
  total_received: 0,
  total_sent: 0,
  tx_count: 0,
  is_pending_withdrawal: false,
  addresses: {},
  available_balances: {},
  nft: null,
  withdrawal_requests: [],
  created_at: '2026-10-29T12:00:00Z',
};

const liveTransfer: VbtcTransfer = {
  id: 1,
  from_address: 'xFrom',
  to_address: 'xTo',
  amount: '0.001',
  transaction_hash: 'abc',
  is_multi: true,
  refused_at_maturity: false,
  created_at: '2026-10-29T12:00:00Z',
};

test('VbtcWithdrawalStatus is exported from the public entrypoint', () => {
  const statuses: VbtcWithdrawalStatus[] = [
    'requested',
    'pending_btc',
    'completed',
    'cancelled',
    'cancellation_requested',
  ];
  expect(statuses).toHaveLength(5);
});

test('token and transfer fields from the live API pass through', async () => {
  installFetch({
    '/vbtc-v2/transfers/': () => ({ results: [liveTransfer] }),
    '/vbtc-v2/detail/': () => ({ ...liveToken, pending_owner_address: 'xNextOwner' }),
  });
  const client = new VfxClient('testnet');

  const [transfer] = await client.getVbtcTransfers(liveToken.sc_identifier);
  expect(transfer.is_multi).toBe(true);
  expect(transfer.refused_at_maturity).toBe(false);

  const detail = await client.getVbtcTokenDetail(liveToken.sc_identifier);
  expect(detail.pending_owner_address).toBe('xNextOwner');
});
