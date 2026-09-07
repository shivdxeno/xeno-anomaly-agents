import type { TUmbrella } from '../../../core/types';

/**
 * The closed list the IncidentKey slug comes from. Append-only in practice: renaming a slug
 * makes every open ticket filed under the old one unfindable, so the next run classifies them
 * all NEW and re-files the entire set.
 */
export const journeyUmbrellas: Array<TUmbrella> = [
  {
    slug: 'journey-stopped-sending',
    label: 'the journey stopped sending',
    shape: 'messages have stopped going out altogether',
    errors: [],
    errorPrefixes: [],
  },
  {
    slug: 'intermediate-processing-failing',
    label: 'intermediate processing is failing',
    shape: 'customers drop out before any message is created',
    errors: [
      'Request failed with status code 503',
      'Request failed with status code 500',
      'Request failed with status code 404',
      'Request failed with status code 401',
      'socket hang up',
      'read ECONNRESET',
      'No customer found',
    ],
    errorPrefixes: ['connect ECONNREFUSED', 'Error shortening links batch:'],
  },
  {
    slug: 'coupon-lookup-timing-out',
    label: 'coupon and offer lookup is timing out',
    shape: 'customers drop out before any message is created',
    errors: [],
    errorPrefixes: ['Exception while fetchCouponAndOfferDistributionDetailsByCouponId'],
  },
  {
    slug: 'content-variant-stopped',
    label: 'one content variant stopped going out',
    shape: 'one content variant stopped going out',
    errors: [],
    errorPrefixes: ['Variable not replaced:'],
  },
  {
    slug: 'delivery-receipts-not-returning',
    label: 'DLRs are not coming back',
    shape: 'no delivery confirmation is coming back',
    errors: [],
    errorPrefixes: [],
  },
  {
    slug: 'uncategorised',
    label: 'uncategorised',
    shape: 'customers drop out before any message is created',
    errors: [],
    errorPrefixes: [],
  },
];
