import { AddressApiClient } from '../client/address-api-client';
import { Network } from '../constants';
import { installFetch, jsonResponse } from './helpers/mock-fetch';

const client = new AddressApiClient(Network.Testnet);

afterEach(() => {
  jest.resetAllMocks();
});

describe('getAddressDetails', () => {
  test('maps API fields to VfxAddress', async () => {
    installFetch({
      '/addresses/xAbc': () => ({
        address: 'xAbc',
        balance: 12.5,
        balance_total: 20,
        balance_locked: 7.5,
        adnr: 'someone.vfx',
        activated: true,
      }),
    });

    const details = await client.getAddressDetails('xAbc');
    expect(details).toEqual({
      address: 'xAbc',
      balance: 12.5,
      balanceTotal: 20,
      balanceLocked: 7.5,
      adnr: 'someone.vfx',
      activated: true,
    });
  });

  test('returns the zero-activity shape for an unseen address (404)', async () => {
    installFetch({ '/addresses/xNew': () => jsonResponse({ detail: 'not found' }, 404) });

    const details = await client.getAddressDetails('xNew');
    expect(details).toEqual({
      address: 'xNew',
      balance: 0,
      balanceTotal: 0,
      balanceLocked: 0,
      adnr: null,
      activated: false,
    });
  });
});

describe('domainAvailable', () => {
  test('false when the domain resolves', async () => {
    installFetch({ '/addresses/adnr/taken.vfx/': () => ({ address: 'xOwner', domain: 'taken.vfx' }) });
    expect(await client.domainAvailable('taken.vfx')).toBe(false);
  });

  test('true when the domain 404s', async () => {
    installFetch({ '/addresses/adnr/free.vfx/': () => jsonResponse({ detail: 'not found' }, 404) });
    expect(await client.domainAvailable('free.vfx')).toBe(true);
  });
});

describe('lookupDomain', () => {
  test('returns the resolved address', async () => {
    installFetch({ '/addresses/adnr/someone.vfx/': () => ({ address: 'xOwner' }) });
    expect(await client.lookupDomain('someone.vfx')).toBe('xOwner');
  });

  test('returns null when the domain does not resolve', async () => {
    installFetch({ '/addresses/adnr/ghost.vfx/': () => jsonResponse({ detail: 'not found' }, 404) });
    expect(await client.lookupDomain('ghost.vfx')).toBeNull();
  });
});
