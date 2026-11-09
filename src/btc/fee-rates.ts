import { defaultApiBaseUrl } from './constants';
import type { IFeeRates } from './types';

/**
 * Fee tiers the Flutter wallet uses when the fee API cannot be reached
 * (`BtcRecommendedFees.fallback`): fixed stand-ins, marked `isEstimate`.
 */
export const BTC_FALLBACK_FEE_RATES: IFeeRates = {
  fastestFee: 30,
  halfHourFee: 27,
  hourFee: 25,
  economyFee: 12,
  minimumFee: 6,
};

/**
 * The Flutter wallet's testnet floors (`BtcFeeRateService`): testnet
 * estimators read 1-2 sat/vB, which left test transactions unconfirmed for
 * hours, so each tier is raised to at least these. Mainnet passes through.
 */
export const BTC_TESTNET_FEE_RATE_FLOORS: IFeeRates = {
  fastestFee: 10,
  halfHourFee: 8,
  hourFee: 5,
  economyFee: 5,
  minimumFee: 2,
};

/** How long `recommendedFeeRates` waits for the fee API before using the fallback table. */
export const DEFAULT_FEE_RATES_TIMEOUT_MS = 10_000;

export type RecommendedFeeRates = IFeeRates & {
  /** True when the API could not be reached and these are BTC_FALLBACK_FEE_RATES. */
  isEstimate: boolean;
};

/**
 * Recommended fee rates (sat/vB) the way the Flutter wallet shows them:
 * the Esplora `/v1/fees/recommended` table, testnet tiers floored at
 * BTC_TESTNET_FEE_RATE_FLOORS, and BTC_FALLBACK_FEE_RATES (with
 * `isEstimate: true`) when the API cannot be reached within `timeoutMs`
 * (default 10 s) or answers anything but positive rates. Never throws.
 * `BtcClient.getFeeRates` is unchanged and still returns the raw table or
 * null.
 */
export async function recommendedFeeRates(
  network: 'mainnet' | 'testnet',
  options: { apiBaseUrl?: string; timeoutMs?: number } = {},
): Promise<RecommendedFeeRates> {
  const isTestnet = network === 'testnet';
  const apiBaseUrl = options.apiBaseUrl ?? defaultApiBaseUrl(isTestnet);
  const timeoutMs = options.timeoutMs ?? DEFAULT_FEE_RATES_TIMEOUT_MS;
  let fees: IFeeRates | null = null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // One deadline covers both the request and reading its body, so a server
    // that accepts the request and then stalls still yields the fallback.
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, timeoutMs);
    });
    const lookup = (async () => {
      const response = await fetch(
        `${apiBaseUrl}/v1/fees/recommended`,
        controller ? { signal: controller.signal } : {},
      );
      return response.ok ? response.json() : null;
    })();
    const body = await Promise.race([lookup, deadline]);
    const tiers = ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee', 'minimumFee'] as const;
    // A tier must be a positive finite rate; anything else means the table is unusable.
    if (
      body &&
      tiers.every((tier) => typeof body[tier] === 'number' && Number.isFinite(body[tier]) && body[tier] > 0)
    ) {
      fees = Object.fromEntries(tiers.map((tier) => [tier, body[tier]])) as unknown as IFeeRates;
    }
  } catch {
    fees = null;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!fees) {
    return { ...BTC_FALLBACK_FEE_RATES, isEstimate: true };
  }
  if (!isTestnet) {
    return { ...fees, isEstimate: false };
  }
  return {
    fastestFee: Math.max(fees.fastestFee, BTC_TESTNET_FEE_RATE_FLOORS.fastestFee),
    halfHourFee: Math.max(fees.halfHourFee, BTC_TESTNET_FEE_RATE_FLOORS.halfHourFee),
    hourFee: Math.max(fees.hourFee, BTC_TESTNET_FEE_RATE_FLOORS.hourFee),
    economyFee: Math.max(fees.economyFee, BTC_TESTNET_FEE_RATE_FLOORS.economyFee),
    minimumFee: Math.max(fees.minimumFee, BTC_TESTNET_FEE_RATE_FLOORS.minimumFee),
    isEstimate: false,
  };
}
