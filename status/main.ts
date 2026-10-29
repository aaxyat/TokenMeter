/**
 * The Session panel's compact row: the same numbers the rail panel shows, at a
 * glance — rate, input, cache hit rate and output for the open session.
 *
 * It is a thin view over the same local service: it watches the session this
 * surface was opened for and polls `GET /rate`, exactly like the panel.
 */
import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';

import { cacheHitShare, formatCacheHitRate, hitRateColor, liveTotals, type SessionUsage } from '../panel/totals.ts';

type RateResponse = {
  connection: 'idle' | 'connecting' | 'live' | 'error';
  sessionId: string | null;
  tokensPerSecond: number;
  charsPerToken: number;
  pendingChars: number;
  sessionUsage: SessionUsage | null;
};

const LABELS = {
  en: { input: 'Input', cache: 'Cache hit', output: 'Output' },
  ko: { input: '입력', cache: '캐시 적중', output: '출력' },
};

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');

const host = connectHost();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let labels = LABELS.en;
let origin: string | null = null;
let sessionId: string | null = null;
let model: string | null = null;
let configuredKey = '';
let polling = false;
let stopped = false;
let mounted = false;

const rateEl = el('span', 'tm-num', '0.0');
const unitEl = el('span', 'tm-unit', 'tok/s');
const inputEl = el('span', 'tm-value', '—');
const cacheEl = el('span', 'tm-value', '—');
const outputEl = el('span', 'tm-value', '—');
const inputLabelEl = el('span', 'tm-label');
const cacheLabelEl = el('span', 'tm-label');
const outputLabelEl = el('span', 'tm-label');

const compact = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`;
  if (Math.abs(rounded) >= 10_000) return `${(rounded / 1_000).toFixed(1)}k`;
  return rounded.toLocaleString();
};

const resolveOrigin = (): string | null => {
  try {
    const url = new URL(window.location.href);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  } catch {
    // about:srcdoc or an opaque sandbox origin: nothing usable.
  }
  return null;
};

const setStat = (element: HTMLElement, text: string, full: string, empty = false): void => {
  element.textContent = text;
  element.title = full;
  element.dataset.empty = empty ? 'true' : 'false';
};

const render = (rate: RateResponse | null): void => {
  const tps = rate && Number.isFinite(rate.tokensPerSecond) ? rate.tokensPerSecond : 0;
  rateEl.textContent = tps.toFixed(1);

  const usage = rate?.sessionUsage ?? null;
  const live = liveTotals(usage, rate?.pendingChars ?? 0, rate?.charsPerToken ?? 0);
  const mark = live.provisional ? '~' : '';
  const showTokens = usage !== null || live.provisional;

  if (showTokens) {
    setStat(inputEl, compact(usage?.input ?? 0), `${Math.round(usage?.input ?? 0).toLocaleString()} input tokens`, usage === null);
    setStat(outputEl, `${mark}${compact(live.output)}`, `${mark}${Math.round(live.output).toLocaleString()} output tokens`, false);
  } else {
    setStat(inputEl, '—', '', true);
    setStat(outputEl, '—', '', true);
  }

  const share = usage ? cacheHitShare(usage) : null;
  cacheEl.style.color = share === null ? '' : hitRateColor(share);
  setStat(
    cacheEl,
    usage ? formatCacheHitRate(usage) : '—',
    share === null ? '' : `${(share * 100).toFixed(1)}% of the prompt served from cache`,
    share === null,
  );
};

const configure = async (): Promise<void> => {
  if (!origin) return;
  const key = `${origin}|${sessionId ?? ''}|${model ?? ''}`;
  if (key === configuredKey) return;
  try {
    await host.serviceRequest({
      method: 'POST',
      path: '/watch',
      body: JSON.stringify({ origin, sessionId, model }),
    });
    configuredKey = key;
  } catch {
    configuredKey = '';
  }
};

const poll = async (): Promise<void> => {
  if (stopped || polling || !origin) return;
  polling = true;
  try {
    const result = await host.serviceRequest({ method: 'GET', path: '/rate' });
    if (result.status < 400) {
      const rate = JSON.parse(result.body) as RateResponse;
      // A service that restarted has forgotten the watch; its own view of the
      // session id is the cue to ask again.
      if (rate.connection === 'live' && !rate.sessionId) {
        configuredKey = '';
        await configure();
      }
      render(rate);
    }
  } catch {
    render(null);
  } finally {
    polling = false;
  }
};

const mount = (): void => {
  const container = el('div', 'tm-status');
  const rate = el('div', 'tm-rate');
  rate.append(rateEl, unitEl);

  const stats = el('div', 'tm-stats');
  const stat = (label: HTMLElement, value: HTMLElement) => {
    const box = el('div', 'tm-stat');
    box.append(label, value);
    return box;
  };
  stats.append(
    stat(inputLabelEl, inputEl),
    stat(cacheLabelEl, cacheEl),
    stat(outputLabelEl, outputEl),
  );

  container.append(rate, stats);
  root.append(container);

  inputLabelEl.textContent = labels.input;
  cacheLabelEl.textContent = labels.cache;
  outputLabelEl.textContent = labels.output;
  render(null);

  void configure();
  void poll();

  const loop = (): void => {
    if (stopped) return;
    window.setTimeout(async () => {
      await poll();
      loop();
    }, document.hidden ? 1000 : 150);
  };
  loop();
};

host.onReady((next) => {
  labels = next.locale.toLowerCase().startsWith('ko') ? LABELS.ko : LABELS.en;
  applyHostReady(next, document.documentElement);
  sessionId = next.session?.id ?? null;
  model = next.session?.model ?? null;
  origin = resolveOrigin();
  if (!mounted) {
    mounted = true;
    mount();
    return;
  }
  void configure();
});

host.onSession((session) => {
  sessionId = session?.id ?? null;
  model = session?.model ?? null;
  void configure();
});
