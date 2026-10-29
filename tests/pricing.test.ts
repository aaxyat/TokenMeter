import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPriceIndex, estimateCost, matchPrice, modelKeyCandidates, normalizeModelKey, type PricingRecord } from '../shared/pricing.ts';

// Shaped like the records in api/v1/prices.json, trimmed to the fields we read.
const deepseek = (over: Partial<PricingRecord> = {}): PricingRecord => ({
  provider_id: 'deepseek',
  model_id: 'deepseek-flash',
  display_name: 'DeepSeek V4.1 Flash',
  status: 'active',
  pricing: { input: 0.3, output: 1.2, cached_input: 0.006, cache_write: null, unit: '1M tokens', currency: 'USD' },
  ...over,
});

const index = buildPriceIndex([
  deepseek(),
  deepseek({ model_id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', pricing: { input: 1.32, output: 3.96, cached_input: 0.044, cache_write: null } }),
]);

test('a runtime id finds the dataset row by name when the ids differ', () => {
  // OpenCode calls it deepseek-v4.1-flash; the dataset's id is deepseek-flash.
  assert.equal(matchPrice(index, 'deepseek-v4.1-flash')?.model_id, 'deepseek-flash');
  assert.equal(matchPrice(index, 'opencode-go/deepseek-v4.1-flash')?.model_id, 'deepseek-flash');
  assert.equal(matchPrice(index, 'ocg/deepseek-v4.1-flash')?.model_id, 'deepseek-flash');
});

test('exact ids and display names match too', () => {
  assert.equal(matchPrice(index, 'deepseek-flash')?.model_id, 'deepseek-flash');
  assert.equal(matchPrice(index, 'deepseek/deepseek-v4-pro')?.model_id, 'deepseek-v4-pro');
  assert.equal(matchPrice(index, 'DeepSeek V4 Pro')?.model_id, 'deepseek-v4-pro');
  assert.equal(matchPrice(index, 'gpt-9-imaginary'), null);
  assert.equal(matchPrice(index, null), null);
});

test('ids are compared without case or punctuation', () => {
  assert.equal(normalizeModelKey('DeepSeek V4.1 Flash'), 'deepseekv41flash');
  assert.deepEqual(modelKeyCandidates('ocg/x/y'), ['ocg/x/y', 'y']);
  assert.deepEqual(modelKeyCandidates('  '), []);
});

test('cost is token counts times the list price, per million', () => {
  const estimate = estimateCost({ input: 400_000, output: 60_000, cacheRead: 50_000_000, cacheWrite: 0 }, deepseek());
  assert.ok(estimate);
  assert.equal(estimate.partial, false);
  // 0.12 + 0.072 + 0.30
  assert.equal(Number(estimate.cost.toFixed(6)), 0.492);
});

test('an unpriced bucket reports a floor, not a guess', () => {
  const noRates = deepseek({ pricing: { input: 0.3, output: 1.2, cached_input: null, cache_write: null } });
  const estimate = estimateCost({ input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }, noRates);
  assert.ok(estimate);
  assert.equal(estimate.partial, true);
  assert.equal(Number(estimate.cost.toFixed(6)), 0.3);
});

test('a row without input or output rates cannot price a session', () => {
  const half = deepseek({ pricing: { input: null, output: 1.2, cached_input: 0.006, cache_write: null } });
  assert.equal(estimateCost({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, half), null);
});

test('rows that are not per-million token prices stay out of the index', () => {
  const perImage = deepseek({ model_id: 'gpt-image', display_name: 'GPT Image', pricing: { input: null, output: null, cached_input: null, cache_write: null, unit: 'per_image' } });
  const mixed = buildPriceIndex([perImage]);
  assert.equal(matchPrice(mixed, 'gpt-image'), null);
});
