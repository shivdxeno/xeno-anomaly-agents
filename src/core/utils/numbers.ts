/** Round for humans: the report never prints a decimal it did not need. */
export const roundForHumans = (value: number): number => {
  if (value >= 10000) {
    return Math.round(value / 100) * 100;
  }

  if (value >= 1000) {
    return Math.round(value / 10) * 10;
  }

  return Math.round(value);
};

export const formatCount = (value: number): string => roundForHumans(value).toLocaleString('en-US');

/**
 * Percentage change, negative for a decline. Returns -100 when the baseline was positive and
 * the observation is zero, and 0 when there was no baseline to compare against.
 */
export const changePct = (obsDaily: number, baseDaily: number): number => {
  if (baseDaily <= 0) {
    return 0;
  }

  return ((obsDaily - baseDaily) / baseDaily) * 100;
};

/**
 * `Change` prints as a direction and a number, in words — never `-100%`, which makes the
 * reader work out which way it points.
 */
export const changeLabel = (pct: number): string => {
  const magnitude = Math.abs(Math.round(pct));

  return pct <= 0 ? `down ${magnitude}%` : `up ${magnitude}%`;
};

export const median = (values: Array<number>): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return (sorted[mid - 1] + sorted[mid]) / 2;
};
