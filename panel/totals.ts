/** Token counters the panel shows for the watched session. */
export type TokenTotals = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  generated: number;
};

/** Running session totals from `session.usage.updated`, the only real counters OpenCode 2 publishes live. */
export type SessionUsage = TokenTotals & {
  cost: number;
  /** `generated - output`: tokens spent thinking, which the panel does not show. */
  reasoning: number;
};

/** A value that came back from host storage, checked before it is trusted as a baseline. */
export const isTokenTotals = (value: unknown): value is TokenTotals => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['input', 'cacheRead', 'cacheWrite', 'output', 'generated'].every((key) => typeof record[key] === 'number');
};

/**
 * Share of the prompt the provider served from its cache. `input` counts
 * uncached prompt tokens only, so the cache reads are added back in.
 */
export const cacheHitShare = (usage: TokenTotals): number | null => {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  if (prompt <= 0) return null;
  return Math.min(1, Math.max(0, usage.cacheRead / prompt));
};

export const formatCacheHitRate = (usage: TokenTotals): string => {
  const share = cacheHitShare(usage);
  return share === null ? '—' : `${(share * 100).toFixed(1)}%`;
};

/**
 * Red at 0% through amber to green at 100%. oklch keeps one lightness across
 * the ramp, so the colour reads the same on the light and the dark theme.
 */
export const hitRateColor = (share: number): string => {
  const clamped = Math.min(1, Math.max(0, share));
  return `oklch(0.68 0.16 ${Math.round(25 + clamped * 125)})`;
};

/**
 * Totals counted from a reset. `null` means the counters went backwards — the
 * session restarted, or another run took over the id — so the caller drops the
 * baseline rather than clamping every figure to zero.
 */
export const subtractTotals = (usage: SessionUsage, baseline: TokenTotals | null): SessionUsage | null => {
  if (!baseline) return usage;
  const regressed = usage.input < baseline.input
    || usage.cacheRead < baseline.cacheRead
    || usage.output < baseline.output
    || usage.generated < baseline.generated;
  if (regressed) return null;
  const generated = usage.generated - baseline.generated;
  const output = usage.output - baseline.output;
  return {
    cost: usage.cost,
    input: usage.input - baseline.input,
    output,
    reasoning: Math.max(0, generated - output),
    cacheRead: usage.cacheRead - baseline.cacheRead,
    cacheWrite: usage.cacheWrite - baseline.cacheWrite,
    generated,
  };
};

/**
 * Cost in USD as the provider reports it. A subscription reports 0, and a short
 * session lands far under a cent, so small values keep their digits instead of
 * rounding to $0.00.
 */
export const formatCost = (cost: number): string => {
  if (!Number.isFinite(cost) || cost <= 0) return '$0.00';
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
};

/** What a Reset stores: exactly the figures the panel counts up. */
export const totalsOf = (usage: SessionUsage | null): TokenTotals => (
  usage
    ? {
      input: usage.input,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      output: usage.output,
      generated: usage.generated,
    }
    : { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, generated: 0 }
);

/**
 * Tokens from characters streamed since the last settlement, so the figure
 * moves while the model is still writing. The next `session.usage.updated`
 * replaces it with the provider's own count.
 */
export const liveTotals = (
  usage: SessionUsage | null,
  pendingChars: number,
  charsPerToken: number,
): { output: number; generated: number; provisional: boolean } => {
  const chars = Number.isFinite(pendingChars) ? Math.max(0, pendingChars) : 0;
  const ratio = Number.isFinite(charsPerToken) ? Math.max(0, charsPerToken) : 0;
  const extra = chars * ratio;
  return {
    output: (usage?.output ?? 0) + extra,
    generated: (usage?.generated ?? 0) + extra,
    provisional: extra >= 1,
  };
};
