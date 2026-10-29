# Token Meter

An OpenChamber extension that measures how fast the open session generates and
what it has spent: a rolling **tokens-per-second** readout, the session's live
token totals, its cache behaviour, and the API cost.

Everything is read from OpenChamber's own event stream. The panel is a thin
view; a small local service does the measuring.

| | |
| --- | --- |
| **Rail panel** | full readout: rate, last turn, token grid, cost, session details |
| **Session panel row** | compact row beside Context and Usage: rate, input, cache hit, output |
| **Engine** | OpenChamber **2.2.0+** (OpenCode 2 event stream) |
| **Permissions** | a local service. Nothing else — no files, no prompts, no sessions |
| **Money** | [AICostBudget pricing dataset](https://github.com/aicostbudget/ai-api-pricing-data) (CC BY 4.0) |

## Install

Settings → Extensions → **Folder, ZIP, or URL**, paste the repository URL, and
choose **Add**. Approve the permissions dialog: it asks for **Run a local
service**, which is what the meter needs.

```
https://github.com/aaxyat/openchamber-tps
```

A Git install updates itself: bump `version` in `package.json`, rebuild, and
push; OpenChamber offers the update the next time Settings → Extensions opens.
Add `#v1.8.0` or `#main` to pin a tag or branch. To work on the extension
itself, install the absolute path of your checkout instead — a folder install
runs straight from that folder and never updates on its own.

Extensions load on OpenChamber web and desktop only; VS Code and the mobile app
do not load them.

> **After an update, reopen the panel.** OpenChamber does not reload a panel's
> iframe when the extension underneath it changes, so an open panel keeps
> running the previous build. Close it and open it again (or restart
> OpenChamber) to pick up new code.

## What the panel shows

**The rate.** A large `tok/s` number over the last five seconds, a bar that
tracks the recent peak, the session title, and whether the session is
`generating`, `idle`, `waiting for permission` or `waiting for answer`.

**Last turn average.** When a turn finishes, its average is shown separately, so
the live number and the completed result never overwrite each other. The figure
is tokens divided by *generation* time only — tool calls, retries and time spent
waiting on you are excluded (see [Turn average](#turn-average)).

**Current.** The session's real totals, from OpenCode's own usage events:

| | |
| --- | --- |
| Input tokens | prompt tokens the provider did not serve from cache |
| Cached tokens | prompt tokens it did serve from cache |
| Input cache hit rate | cache reads over the whole prompt, coloured red → amber → green |
| Output tokens | tokens generated, growing live while the model writes |

**Reset tokens** records the current totals as a baseline and counts up from
zero. The baseline is stored per session in host storage, so it survives closing
the panel; if the counters ever go backwards the baseline is dropped rather than
pinning the display at zero.

**API cost** is the provider's own figure when it reports one. When it reports
`0` — a subscription, or a provider with no price table — the service prices the
session itself from the pricing dataset and marks the number `est.`.

**Details.** Characters/s, chars per token, session tokens, model, status, last
event, events seen, and the pricing dataset's build date.

## Pricing

Token counts come from OpenCode. Money comes from
[aicostbudget/ai-api-pricing-data](https://github.com/aicostbudget/ai-api-pricing-data),
which publishes the whole dataset as one file:
`https://aicostbudget.github.io/ai-api-pricing-data/api/v1/prices.json`.

- Fetched when the service starts, then every 6 hours. A failed refresh keeps
  the last good copy and retries in 20 minutes, so a stale price beats no price.
- A session's model id is matched to a record by exact id, then by the id after
  an aggregator prefix (`ocg/deepseek-v4.1-flash` → `deepseek-v4.1-flash`), then
  by the record's display name ignoring case and punctuation — which is how
  OpenCode's `deepseek-v4.1-flash` reaches the dataset's `deepseek-flash`
  (*DeepSeek V4.1 Flash*).
- Cost is `(input × input + cached × cached_input + cache_write × cache_write +
  output × output) / 1M`, in USD per million tokens. A bucket the dataset leaves
  `null` contributes nothing and the estimate is reported as a floor, never as a
  guess.
- The **Prices** row shows the dataset's build date, so a stale copy is visible
  rather than silent.

These are the provider's *list* prices. A subscription or a reseller may bill
differently.

## The Session panel row

The extension contributes a `statusSection`, so the same numbers appear in the
Session panel beside Context and Usage — without opening the rail panel:

```
9.5 tok/s      Input 435.0k   Cache hit 99.3%   Output ~70.0k
```

Figures are compact for the narrow panel; each cell's tooltip carries the exact
count. Below 470 px the rate takes its own line and the three figures share the
next.

## How it measures

```
panel / session row (sandboxed iframes)
  │  POST /watch { origin, sessionId, model }   ← origin comes from location.href
  │  GET  /rate                                 ← polled every 150 ms
  ▼
host loopback proxy  ──►  service process (127.0.0.1)
                              │  GET <origin>/api/global/event   (Server-Sent Events)
                              ▼
                         OpenChamber event stream
```

Two properties of that stream matter:

- It forwards OpenCode 2 wire events (`{ id, created, type, data }`). A proxy that
  wraps them as `{ payload, directory, eventId }` is unwrapped too.
- `/api/event` is the directory-scoped sibling: without a `directory` parameter
  it carries only the server's default directory, so an open project never sees
  its own session events there. That is why the global stream is used.

**Characters → tokens.** `session.text.delta` and `session.reasoning.delta` are
the primary source; `session.tool.input.delta` carries tool input, not
generation, and is ignored. `session.text.ended` / `session.reasoning.ended`
full-value boundaries are the fallback for a service that attached after the
deltas went by — a part is counted by exactly one of the two paths.

**Live totals.** Characters streamed since the last settlement are converted
with the calibrated chars-per-token and added to the output and session figures,
so they move while the model writes. A `~` marks that part; the next
`session.usage.updated` replaces it with the provider's own count, so the number
never doubles up.

**The rate** is `charsPerSecond × charsPerToken`. It is an estimate of
generation throughput, because the live stream carries text fragments only; real
token counts arrive per settled step. Each settled step (`session.step.ended`,
or `session.step.failed` with counts) reports `tokens.output + tokens.reasoning`
and recalibrates chars-per-token, smoothed with an exponential moving average and
clamped to `0.05 .. 1`.

### Turn average

A turn spans `session.execution.started` until `session.execution.succeeded` or
`session.execution.failed`. An interruption with reason `shutdown` keeps the turn
open, because OpenCode resumes the same turn after a restart; every other
interruption ends it. Its average divides tokens by generation time only:

- Time between consecutive streamed characters counts as generation up to a
  1-second threshold. A longer gap is a pause — tool execution, a retry — and is
  excluded.
- A pending permission or question excludes the wait outright, even when you
  answer within that threshold. OpenCode keeps the session `busy` while an agent
  waits, so `permission.*` and `form.*` events are what the panel reports as
  `waiting for permission` / `waiting for answer`.
- Time to the first token is excluded when the first character arrives more than
  a second after the turn started.

The turn reports `tokens`, `activeMs`, `wallMs`, `pausedMs` and `tokensPerSecond`,
with `source: tokens` when real counts existed and `estimate` otherwise. The panel
shows the active time and adds `paused` once a turn excluded at least a second.

## Development

```bash
npm install                 # or bun install
bun run build               # all three bundles
bun run build:panel         # panel/main.js   (IIFE)
bun run build:status        # status/main.js  (IIFE, the Session row)
bun run build:service       # service/main.js (Node ESM)
```

All three use `openchamber-guest-bundle` from `@openchamber/sdk`. **Commit the
built files** — OpenChamber never compiles an extension at install time. Build
with the SDK version in `bun.lock` so the minified bundles stay close to what was
reviewed.

```bash
node --test tests/*.test.ts   # unit tests: token math, reset baselines, pricing
node scripts/smoke.mjs        # end-to-end: mock stream + built service
```

`tests/` covers the pure parts — live token counting, reset baselines, cache hit
rate, cost formatting, and the dataset's id matching. `scripts/smoke.mjs` starts a
mock OpenChamber event stream and the built service, then asserts the counted
characters, rolling rate, calibration, per-step and per-session token counts, the
finished-turn average, wait accounting, and session filtering.

## Limitations

- **OpenChamber UI password.** The service reads `/api/global/event` without a
  session. With an instance UI password the stream answers `401` and the panel
  shows a reconnect notice instead of a rate.
- **Relay frames.** Under the private relay the panel runs from `srcDoc` with no
  usable origin, so it cannot find the event stream and says so.
- **Managed OpenCode auth.** OpenChamber starts its managed OpenCode server with a
  generated password the service never receives. That is why the service reads
  OpenChamber's own proxy rather than OpenCode directly — and why a UI password
  blocks it.
- **Input and cached tokens step, output ticks.** The provider reports prompt
  tokens once per settled step; there is nothing to interpolate them from.
- **No per-token streaming.** Deltas carry characters. The rolling number is a
  calibrated estimate; real counts arrive per settled step.
- **Reasoning counts as output.** Reasoning text is generated text, so its deltas
  are counted. That matches `tokens.output + reasoning`, but it is not the same as
  visible answer characters.

## License

MIT — see [LICENSE](LICENSE). The pricing data is
[CC BY 4.0](https://github.com/aicostbudget/ai-api-pricing-data/blob/main/LICENSE-DATA)
and belongs to AICostBudget.

Forked from [airtaxi/openchamber-tps](https://github.com/airtaxi/openchamber-tps).
