import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheHitShare, formatCacheHitRate, formatCost, hitRateColor, isTokenTotals, liveTotals, subtractTotals, totalsOf, type SessionUsage } from '../panel/totals.ts';

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  cost: 0,
  input: 1_000,
  output: 200,
  reasoning: 50,
  cacheRead: 9_000,
  cacheWrite: 0,
  generated: 250,
  ...over,
});

test('without a reset the session totals are shown as they are', () => {
  const current = usage();
  assert.deepEqual(subtractTotals(current, null), current);
});

test('a reset zeroes every counted figure and counts up from there', () => {
  const reset = usage();
  const atReset = subtractTotals(reset, totalsOf(reset));
  assert.equal(atReset?.input, 0);
  assert.equal(atReset?.cacheRead, 0);
  assert.equal(atReset?.output, 0);
  assert.equal(atReset?.generated, 0);
  assert.equal(formatCacheHitRate(atReset!), '—');

  const later = usage({ input: 1_200, output: 260, generated: 320, cacheRead: 9_400 });
  const since = subtractTotals(later, totalsOf(reset))!;
  assert.equal(since.input, 200);
  assert.equal(since.output, 60);
  assert.equal(since.generated, 70);
  assert.equal(since.cacheRead, 400);
  assert.equal(formatCacheHitRate(since), '66.7%', '400 / (200 + 400 + 0)');
});

test('reasoning is whatever the generated delta leaves after output', () => {
  const baseline = totalsOf(usage({ output: 200, reasoning: 50, generated: 250 }));
  const since = subtractTotals(usage({ output: 230, reasoning: 95, generated: 325 }), baseline)!;
  assert.equal(since.output, 30);
  assert.equal(since.generated, 75);
  assert.equal(since.reasoning, 45);
});

test('counters that went backwards drop the baseline instead of clamping', () => {
  const baseline = totalsOf(usage());
  assert.equal(subtractTotals(usage({ input: 500 }), baseline), null);
  assert.equal(subtractTotals(usage({ cacheRead: 0 }), baseline), null);
  assert.equal(subtractTotals(usage({ output: 10, generated: 10 }), baseline), null);
});

test('the hit rate treats input as uncached, so cache reads join the denominator', () => {
  assert.equal(formatCacheHitRate(usage({ input: 1_000, cacheRead: 9_000 })), '90.0%');
  assert.equal(formatCacheHitRate(usage({ input: 0, cacheRead: 5_000 })), '100.0%');
  assert.equal(formatCacheHitRate(usage({ input: 100, cacheRead: 0 })), '0.0%');
  assert.equal(formatCacheHitRate(usage({ input: 0, cacheRead: 0, cacheWrite: 0 })), '—');
});

test('cache writes count as prompt tokens too', () => {
  const withWrite = usage({ input: 0, cacheRead: 1_000, cacheWrite: 1_000 });
  assert.equal(formatCacheHitRate(withWrite), '50.0%');
});

test('the hit rate reads red at nothing cached and green at everything cached', () => {
  assert.equal(cacheHitShare(usage({ input: 1_000, cacheRead: 9_000 })), 0.9);
  assert.equal(cacheHitShare(usage({ input: 0, cacheRead: 0, cacheWrite: 0 })), null);
  assert.equal(hitRateColor(0), 'oklch(0.68 0.16 25)');
  assert.equal(hitRateColor(1), 'oklch(0.68 0.16 150)');
  assert.equal(hitRateColor(0.5), 'oklch(0.68 0.16 88)');
  assert.equal(hitRateColor(-3), 'oklch(0.68 0.16 25)', 'clamped low');
  assert.equal(hitRateColor(4), 'oklch(0.68 0.16 150)', 'clamped high');
});

test('streamed characters move the token figures before the provider settles', () => {
  const settled = usage({ output: 1_000, generated: 1_200 });
  const live = liveTotals(settled, 4_000, 0.25);
  assert.equal(live.output, 2_000, '4000 chars × 0.25 tokens per char');
  assert.equal(live.generated, 2_200);
  assert.equal(live.provisional, true);
});

test('with nothing pending the figures are the settled counts', () => {
  const settled = usage({ output: 1_000, generated: 1_200 });
  const live = liveTotals(settled, 0, 0.25);
  assert.equal(live.output, 1_000);
  assert.equal(live.provisional, false);
});

test('a live count can stand alone before any settlement arrives', () => {
  const live = liveTotals(null, 800, 0.5);
  assert.equal(live.output, 400);
  assert.equal(live.generated, 400);
  assert.equal(live.provisional, true);
  assert.equal(liveTotals(null, 0, 0.5).provisional, false);
});

test('nonsense counts cannot push the figure backwards', () => {
  const live = liveTotals(usage({ output: 10, generated: 10 }), Number.NaN, Number.NaN);
  assert.equal(live.output, 10);
  assert.equal(liveTotals(usage({ output: 10, generated: 10 }), -5, 0.25).output, 10);
});

test('cost keeps the digits a short session earns, and shows a plain zero', () => {
  assert.equal(formatCost(0), '$0.00', 'a subscription reports 0 and still gets a figure');
  assert.equal(formatCost(Number.NaN), '$0.00');
  assert.equal(formatCost(0.00042), '$0.0004');
  assert.equal(formatCost(0.0123), '$0.012');
  assert.equal(formatCost(0.5), '$0.500');
  assert.equal(formatCost(2.3456), '$2.35');
});

test('stored baselines are validated before use', () => {
  assert.equal(isTokenTotals(totalsOf(usage())), true);
  assert.equal(isTokenTotals(totalsOf(null)), true);
  assert.equal(isTokenTotals(null), false);
  assert.equal(isTokenTotals('reset-totals'), false);
  assert.equal(isTokenTotals({ input: 1 }), false);
  assert.equal(isTokenTotals({ input: 1, cacheRead: 2, cacheWrite: 3, output: '4', generated: 5 }), false);
});

test('totalsOf keeps only the counted figures', () => {
  assert.deepEqual(Object.keys(totalsOf(usage())).sort(), ['cacheRead', 'cacheWrite', 'generated', 'input', 'output']);
  assert.deepEqual(totalsOf(null), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, generated: 0 });
});
