/**
 * Pricing from the AICostBudget dataset (github.com/aicostbudget/ai-api-pricing-data),
 * the file the extension keeps refreshed at `api/v1/prices.json`.
 *
 * The dataset keys a record by its provider and its own model id — DeepSeek V4.1
 * Flash is `deepseek-flash`, not `deepseek-v4.1-flash` — so a lookup tries the
 * ids a runtime hands us, then the human name the record carries.
 */

export type PriceRow = {
  input: number | null;
  output: number | null;
  cached_input: number | null;
  cache_write: number | null;
  /** `1M tokens`, the only unit the dataset publishes for token pricing. */
  unit?: string;
  currency?: string;
};

export type PricingRecord = {
  provider_id: string;
  model_id: string;
  display_name: string;
  pricing: PriceRow;
  status?: string;
};

export type PriceIndex = {
  /** `model`, `provider/model`, and the same keys normalized. */
  byKey: Map<string, PricingRecord>;
  byName: Map<string, PricingRecord>;
};

/** Case and punctuation stop mattering: `deepseek-v4.1-flash` and `DeepSeek V4.1 Flash` agree. */
export const normalizeModelKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

export const buildPriceIndex = (models: PricingRecord[]): PriceIndex => {
  const byKey = new Map<string, PricingRecord>();
  const byName = new Map<string, PricingRecord>();
  for (const record of models) {
    if (!record?.pricing || record.pricing.unit !== undefined && record.pricing.unit !== '1M tokens') continue;
    byKey.set(record.model_id, record);
    byKey.set(`${record.provider_id}/${record.model_id}`, record);
    byKey.set(normalizeModelKey(record.model_id), record);
    if (record.display_name) byName.set(normalizeModelKey(record.display_name), record);
  }
  return { byKey, byName };
};

/** The ids a runtime may show for one model: `ocg/x`, `provider/x`, or plain `x`. */
export const modelKeyCandidates = (modelId: string): string[] => {
  const trimmed = modelId.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  const slash = trimmed.lastIndexOf('/');
  if (slash > 0 && slash < trimmed.length - 1) candidates.push(trimmed.slice(slash + 1));
  return candidates;
};

export const matchPrice = (index: PriceIndex, modelId: string | null): PricingRecord | null => {
  if (!modelId) return null;
  for (const candidate of modelKeyCandidates(modelId)) {
    const direct = index.byKey.get(candidate) ?? index.byKey.get(normalizeModelKey(candidate));
    if (direct) return direct;
    const named = index.byName.get(normalizeModelKey(candidate));
    if (named) return named;
  }
  return null;
};

type CountedUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type CostEstimate = {
  cost: number;
  /** A bucket carried tokens the dataset prices as null, so the figure is a floor. */
  partial: boolean;
};

/** List price for a session's counts. Rates are USD per 1M tokens. */
export const estimateCost = (usage: CountedUsage, record: PricingRecord): CostEstimate | null => {
  const row = record.pricing;
  if (row.input === null || row.output === null) return null;
  let partial = false;
  const bill = (tokens: number, rate: number | null): number => {
    if (tokens <= 0) return 0;
    if (rate === null) {
      partial = true;
      return 0;
    }
    return (tokens * rate) / 1_000_000;
  };
  const cost = bill(usage.input, row.input)
    + bill(usage.output, row.output)
    + bill(usage.cacheRead, row.cached_input)
    + bill(usage.cacheWrite, row.cache_write);
  return { cost, partial };
};
