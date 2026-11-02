import { VfxClient } from '../index';
import { cleanAdnrName } from '../utils';
import { installFetch, jsonResponse } from './helpers/mock-fetch';

afterEach(() => {
  jest.resetAllMocks();
});

// Spyglass indexes names lowercase with the suffix: only `sdklanemvxrn80u.vfx`
// answers 200 on data-testnet; the uppercase and bare forms 404 (2026-11-01).
const indexOnly = (path: string, body: unknown) => (url: string) =>
  url.endsWith(path) ? body : jsonResponse({ detail: 'Not found.' }, 404);

describe('cleanAdnrName', () => {
  test.each([
    ['Name', 'name.vfx'],
    ['name', 'name.vfx'],
    ['name.vfx', 'name.vfx'],
    ['  NAME.VFX ', 'name.vfx'],
    ['Name.btc', 'name.btc'],
    ['Legacy.RBX', 'legacy.rbx'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanAdnrName(input)).toBe(expected);
  });
});

describe('VFX name lookups normalise like the buys', () => {
  const forms = ['SDKLaneMvxrn80u', 'sdklanemvxrn80u', 'sdklanemvxrn80u.vfx', 'SDKLANEMVXRN80U.VFX'];

  test.each(forms)('domainAvailable(%s) reports the taken name as taken', async (form) => {
    const { calls } = installFetch({
      '/addresses/adnr/': indexOnly('/addresses/adnr/sdklanemvxrn80u.vfx/', { address: 'xOwner' }),
    });
    const client = new VfxClient('testnet');
    expect(await client.domainAvailable(form, { strict: true })).toBe(false);
    expect(calls[0].url).toBe('https://data-testnet.verifiedx.io/api/addresses/adnr/sdklanemvxrn80u.vfx/');
  });

  test.each(forms)('lookupDomain(%s) finds the holder', async (form) => {
    installFetch({ '/addresses/adnr/': indexOnly('/addresses/adnr/sdklanemvxrn80u.vfx/', { address: 'xOwner' }) });
    const client = new VfxClient('testnet');
    expect(await client.lookupDomain(form, { strict: true })).toBe('xOwner');
  });

  test('a .btc name keeps its suffix in domainAvailable', async () => {
    const { calls } = installFetch({
      '/addresses/adnr/': indexOnly('/addresses/adnr/sdklmvxsfi4u.btc/', { address: 'xOwner' }),
    });
    const client = new VfxClient('testnet');
    expect(await client.domainAvailable('SDKLMVXSFI4U.btc')).toBe(false);
    expect(calls[0].url).toContain('/addresses/adnr/sdklmvxsfi4u.btc/');
  });
});

describe('lookupBtcDomain normalises to name.btc', () => {
  test.each(['SDKLmvxsfi4u', 'sdklmvxsfi4u', 'sdklmvxsfi4u.btc'])('%s resolves', async (form) => {
    const { calls } = installFetch({ '/adnr/': indexOnly('/adnr/sdklmvxsfi4u.btc/', { btc_address: 'tb1qowner' }) });
    const client = new VfxClient('testnet');
    expect(await client.lookupBtcDomain(form)).toBe('tb1qowner');
    expect(calls[0].url).toMatch(/\/adnr\/sdklmvxsfi4u\.btc\/$/);
  });
});
