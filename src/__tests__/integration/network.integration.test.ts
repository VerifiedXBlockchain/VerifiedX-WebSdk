import { VfxClient, btc } from '../../index';
import { Network } from '../../constants';

/**
 * Live-network integration checks. Opt-in only:
 *
 *   npm run test:integration
 *
 * Rules that keep these from rotting when testnet is reset:
 *  - assert response SHAPES, not on-chain state (balances, ownership);
 *  - derive addresses from keys instead of hardcoding funded fixtures;
 *  - anything state-dependent reads env vars and skips when they're absent.
 */

jest.setTimeout(30_000);

const client = new VfxClient(Network.Testnet, true);

describe('VFX data API', () => {
  test('getAddressDetails returns a well-formed VfxAddress for a fresh address', async () => {
    const address = client.addressFromPrivate(client.generatePrivateKey());
    const details = await client.getAddressDetails(address);

    expect(details).toBeTruthy();
    expect(details?.address).toBe(address);
    expect(typeof details?.balance).toBe('number');
    expect(typeof details?.activated).toBe('boolean');
  });

  test('domainAvailable returns a boolean', async () => {
    const availability = await client.domainAvailable('test.vfx');
    expect(typeof availability).toBe('boolean');
  });

  test('lookupDomain returns a string address or null', async () => {
    const resolved = await client.lookupDomain('test.vfx');
    expect(resolved === null || typeof resolved === 'string').toBe(true);
  });

  test('listTransactionsForAddress returns a paginated shape', async () => {
    const address = client.addressFromPrivate(client.generatePrivateKey());
    const page = await client.listTransactionsForAddress(address);
    if (page !== null) {
      expect(Array.isArray(page.results)).toBe(true);
      expect(typeof page.count).toBe('number');
    }
  });
});

describe('mempool.space API', () => {
  const btcClient = new btc.BtcClient('testnet', true);

  test('getFeeRates returns the recommended-fees shape', async () => {
    const rates = await btcClient.getFeeRates();
    expect(rates).toBeTruthy();
    expect(typeof rates?.economyFee).toBe('number');
    expect(typeof rates?.fastestFee).toBe('number');
  });

  test('getAddressInfo returns totals for a fresh address', async () => {
    const keypair = btcClient.generatePrivateKey();
    const info = await btcClient.getAddressInfo(keypair.address as string);
    expect(info.balance).toBe(0);
    expect(info.txCount).toBe(0);
  });
});

// State-dependent checks: run only when the environment provides fixtures
// that are known to exist on the CURRENT testnet.
const fundedAddress = process.env.FUNDED_ADDRESS;
(fundedAddress ? describe : describe.skip)('funded-address checks (FUNDED_ADDRESS)', () => {
  test('funded address reports a positive balance', async () => {
    const details = await client.getAddressDetails(fundedAddress as string);
    expect(details?.balance ?? 0).toBeGreaterThan(0);
  });
});

const registeredDomain = process.env.REGISTERED_DOMAIN;
(registeredDomain ? describe : describe.skip)('registered-domain checks (REGISTERED_DOMAIN)', () => {
  test('registered domain resolves to an address', async () => {
    const resolved = await client.lookupDomain(registeredDomain as string);
    expect(typeof resolved).toBe('string');
  });

  test('registered domain reports unavailable', async () => {
    expect(await client.domainAvailable(registeredDomain as string)).toBe(false);
  });
});
