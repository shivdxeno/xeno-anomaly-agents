/** Minimal `--key=value` / `--flag` parsing. No dependency earns its place for this. */
export const parseArgs = (argv: Array<string>): Record<string, string | true> => {
  const out: Record<string, string | true> = {};

  for (const token of argv) {
    if (!token.startsWith('--')) {
      continue;
    }

    const [key, ...rest] = token.slice(2).split('=');

    out[key] = rest.length === 0 ? true : rest.join('=');
  }

  return out;
};

export const requireArg = (args: Record<string, string | true>, key: string): string => {
  const value = args[key];

  if (typeof value !== 'string' || value === '') {
    throw new Error(`BLOCKED: --${key} is required`);
  }

  return value;
};

export const todayIst = (): string => {
  const now = new Date();
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);

  return ist.toISOString().slice(0, 10);
};
