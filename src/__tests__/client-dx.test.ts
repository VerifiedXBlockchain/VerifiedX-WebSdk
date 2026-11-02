import { VfxClient, VfxApiError, VfxNetworkError, MediaApiClient } from '../index';
import type { MediaUploadResult } from '../index';
import { AddressApiClient } from '../client/address-api-client';
import { Network } from '../constants';
import { installFetch, jsonResponse } from './helpers/mock-fetch';

afterEach(() => {
  jest.resetAllMocks();
});

describe('constructor options', () => {
  test('boolean dryRun positional arg still works', () => {
    expect(() => new VfxClient('testnet', true)).not.toThrow();
    expect(() => new VfxClient('testnet')).not.toThrow();
  });

  test('baseUrl override routes every request to the custom origin', async () => {
    const { calls } = installFetch({
      'my-node.example.com': () => ({
        address: 'xA',
        balance: 1,
        balance_total: 1,
        balance_locked: 0,
        adnr: null,
        activated: true,
      }),
    });

    const client = new VfxClient('testnet', { baseUrl: 'https://my-node.example.com/api' });
    await client.getAddressDetails('xA');

    expect(calls[0].url).toBe('https://my-node.example.com/api/addresses/xA');
  });

  test('options object can set dryRun', async () => {
    const client = new VfxClient('testnet', { dryRun: true });
    await expect(
      client.transferVbtc({
        scIdentifier: 's',
        fromAddress: 'a',
        toAddress: 'b',
        amount: 1,
        privateKey: '00' + '11'.repeat(32),
      }),
    ).rejects.toThrow(/dryRun/);
  });
});

describe('VfxApiError', () => {
  test('carries status, url and body; message keeps the historical prefix', async () => {
    installFetch({ '/addresses/adnr/': () => jsonResponse({ detail: 'boom' }, 500) });

    const client = new AddressApiClient(Network.Testnet);
    const error: VfxApiError = await client.domainAvailable('x.vfx', { strict: true }).then(
      () => Promise.reject(new Error('expected a throw')),
      (e) => e,
    );

    expect(error).toBeInstanceOf(VfxApiError);
    expect(error.status).toBe(500);
    expect(error.url).toContain('/addresses/adnr/x.vfx/');
    expect(error.body).toContain('boom');
    expect(error.message).toMatch(/^HTTP error! status: 500/);
  });
});

describe('VfxNetworkError', () => {
  const failFetch = (cause: unknown) => {
    global.fetch = jest.fn(async () => {
      throw cause;
    }) as unknown as typeof fetch;
  };

  test('a fetch TypeError becomes a VfxNetworkError (a VfxApiError) with url and cause', async () => {
    const cause = new TypeError('fetch failed');
    failFetch(cause);
    const client = new AddressApiClient(Network.Testnet);

    const error = await client.domainAvailable('x.vfx', { strict: true }).then(
      () => Promise.reject(new Error('expected a throw')),
      (e) => e,
    );

    expect(error).toBeInstanceOf(VfxNetworkError);
    expect(error).toBeInstanceOf(VfxApiError);
    expect(error.name).toBe('VfxNetworkError');
    expect(error.status).toBeUndefined();
    expect(error.url).toContain('/addresses/adnr/x.vfx/');
    expect(error.cause).toBe(cause);
    expect(error.message).toMatch(/^HTTP error! status: network failure \(.*\) — fetch failed$/);
  });

  test('timeouts are wrapped too', async () => {
    const cause = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    failFetch(cause);
    const client = new AddressApiClient(Network.Testnet);
    await expect(client.lookupDomain('x.vfx', { strict: true })).rejects.toMatchObject({
      name: 'VfxNetworkError',
      cause,
    });
  });

  test('multipart uploads wrap transport failures', async () => {
    failFetch(new TypeError('getaddrinfo ENOTFOUND'));
    const client = new MediaApiClient(Network.Testnet);
    await expect(client.makeMultipartRequest('/', new FormData())).rejects.toBeInstanceOf(VfxNetworkError);
  });

  test('lenient reads keep their fallbacks', async () => {
    failFetch(new TypeError('fetch failed'));
    const client = new AddressApiClient(Network.Testnet);
    expect(await client.domainAvailable('x.vfx')).toBe(true);
    expect(await client.lookupDomain('x.vfx')).toBeNull();
  });
});

describe('strict mode', () => {
  test('domainAvailable: default stays true on server error, strict throws', async () => {
    installFetch({ '/addresses/adnr/': () => jsonResponse({ detail: 'down' }, 503) });
    const client = new AddressApiClient(Network.Testnet);

    expect(await client.domainAvailable('a.vfx')).toBe(true);
    await expect(client.domainAvailable('a.vfx', { strict: true })).rejects.toThrow(VfxApiError);
  });

  test('domainAvailable: strict still maps 404 to available', async () => {
    installFetch({ '/addresses/adnr/': () => jsonResponse({ detail: 'nope' }, 404) });
    const client = new AddressApiClient(Network.Testnet);
    expect(await client.domainAvailable('a.vfx', { strict: true })).toBe(true);
  });

  test('getAddressDetails: default stays zero-activity on server error, strict throws', async () => {
    installFetch({ '/addresses/xA': () => jsonResponse({ detail: 'down' }, 503) });
    const client = new AddressApiClient(Network.Testnet);

    const lenient = await client.getAddressDetails('xA');
    expect(lenient?.balance).toBe(0);
    await expect(client.getAddressDetails('xA', { strict: true })).rejects.toThrow(VfxApiError);
  });

  test('buyVfxDomain fails on API outage instead of proceeding', async () => {
    installFetch({ '/addresses/': () => jsonResponse({ detail: 'down' }, 503) });
    const client = new VfxClient('testnet', true);
    const privateKey = client.generatePrivateKey();
    const keypair = {
      privateKey,
      publicKey: client.publicFromPrivate(privateKey),
      address: client.addressFromPrivate(privateKey),
    };

    await expect(client.buyVfxDomain(keypair, 'newdomain.vfx')).rejects.toThrow(VfxApiError);
  });
});

describe('mnemonic alias', () => {
  test('privateKeyFromMnemonic === privateKeyFromMneumonic', () => {
    const client = new VfxClient('testnet', true);
    const phrase = client.generateMnemonic();
    expect(client.privateKeyFromMnemonic(phrase, 0)).toBe(client.privateKeyFromMneumonic(phrase, 0));
  });
});

describe('exports', () => {
  test('MediaApiClient is constructible from the public entrypoint', () => {
    expect(() => new MediaApiClient(Network.Testnet)).not.toThrow();
  });
});

describe('MediaApiClient.uploadAsset', () => {
  test('resolves to { url } as the media endpoint returns it', async () => {
    const { calls } = installFetch({ '/media/': () => ({ url: 'https://cdn.example.test/a.png' }) });
    const client = new MediaApiClient(Network.Testnet);

    const result: MediaUploadResult | null = await client.uploadAsset(new File(['x'], 'a.png'), { kind: 'nft' });

    expect(result).toEqual({ url: 'https://cdn.example.test/a.png' });
    expect(result?.url).toBe('https://cdn.example.test/a.png');
    expect(calls[0].method).toBe('POST');
  });

  test('resolves to null on failure', async () => {
    installFetch({ '/media/': () => jsonResponse({ detail: 'too big' }, 413) });
    const client = new MediaApiClient(Network.Testnet);
    expect(await client.uploadAsset(new File(['x'], 'a.png'))).toBeNull();
  });
});
