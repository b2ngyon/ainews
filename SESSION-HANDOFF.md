# AINews — Session Handoff

Rewritten 2026-09-02 (evening). Disposable — delete once the next session has picked it up.

---

## State: count selector is BUILT and VERIFIED, uncommitted

Everything below is in the working tree, not committed. Last commit is `0b87b98`.

- **Backend: 72/72 passing** (`npm run test:api`) — was a suite that would not even load.
- **Frontend: 76/76 passing** (`npx ng test --watch=false --browsers=ChromeHeadless`).
- **`ng build` clean.**
- **Verified live in a browser against the real feeds**, not just in tests.

---

## The four settled decisions (do not reopen)

| | |
|---|---|
| Max count | **50**, not 100. Selector offers 12 / 25 / 50, default 12. |
| Architecture | Server-side `?limit`, client-side paging. Page turns do not refetch. |
| Persistence | `localStorage`, key `ainews.count.v1`. |
| `/starred` | Same paginator, page size 12. |

---

## Live verification results

Against the real feeds on 2026-09-02:

| Request | Items returned |
|---|---|
| `/api/news` (no param) | 12 |
| `?limit=12` / `?limit=25` / `?limit=50` | 12 / 25 / 50 |
| `?limit=999` | 50 (clamped) |
| `?limit=abc` | 12 (default) |

In the UI: selecting 50 gave "Showing 1–12 of 50 articles", "Page 1 of 5"; paging to the end gave
"Showing 49–50 of 50" with 2 cards on the partial last page. **Four page turns produced zero
`/api/news` requests.** `/starred` with 30 seeded items paged correctly and also issued no fetch.
No console errors.

---

## ⚠ The local OpenAI key is dead

`[rss] OpenAI enrichment request failed: Request failed with status code 401` — twice, for a
25-item request. Two calls is the chunking working correctly (20 + 5); the 401 is the key in
`.env` being invalid or expired.

Consequence: everything currently renders `severity: Unknown`, `enriched: false`. The degrade path
handled it cleanly — no crash, and `severity_index: 1` on every item, which is the bug fixed this
session. **Check the Vercel env vars too** (`OPENAI_API_KEY`, `OPENAI_MODEL`); the deploy has the
same exposure and nothing in the UI surfaces it.

---

## What changed, and why

**CTO review returned CHANGES REQUIRED, not approved.** Six blocking items, five accepted:

1. **Token budget ignored reasoning tokens.** `max_completion_tokens` on gpt-5.x covers reasoning
   AND output. The `n * 90 + 200` formula left nothing for reasoning, re-creating the exact
   truncation bug the chunking was written to fix. Now `enrichTokenBudget()` adds a 2000-token
   `REASONING_ALLOWANCE`.
2. **Truncation was undiagnosable.** `finish_reason === 'length'` is now detected explicitly and
   logged with `usage`, instead of surfacing as a generic JSON.parse failure.
3. **`severity_index` fixed** on the degraded path, plus the matching `star.service.ts` default
   (was 0, now 1 — a legacy starred item used to sort below a fresh Unknown one).
6. **In-flight coalescing added** — concurrent misses on one limit now share a single pipeline run
   instead of each paying for feeds and enrichment.
11. Dead comma expression in `clampSeverityIndex` removed.

**Diverged on item 4.** The CTO wanted one cache at 50 with narrowing. That contradicts what the
user was told when they chose server-side `?limit` ("default 12 stays cheap"), and the 1.7x figure
assumed all three limits are equally exercised — but the count is localStorage-persisted, so a
browser uses one. Kept the per-limit cache AND built `narrowItems()`, so a warm 50 entry serves 12
and 25 for free. Strictly better than either proposal, and it solves item 5's cold-start problem
for free.

**`narrowItems` is the load-bearing piece.** A naive `.slice(0, 12)` on a 50-item result returns
**3 AI articles instead of 12** — `selectArticles` re-sorts by date after backfilling. Measured,
not assumed, and there is a test asserting the naive version would be wrong.

---

## Also fixed along the way

- **`normalizeArticle` now prefers `isoDate` over `pubDate`.** rss-parser populates `isoDate` for
  Atom entries where `pubDate` can be absent; the old code dropped every such item.
- **`/api/news` no longer leaks raw internal error text** on 500. Two tests were asserting the
  leak; they now assert its absence.
- **Backend tests un-orphaned.** Moved `server/*.test.js` + fixtures to a top-level `tests/`, which
  keeps them out of Vercel's `api/` function detection. `test:api` is now
  `node --test "tests/**/*.test.js"` — the old `node --test api/` was executing production modules
  as tests.
- `X-News-Stale` is now read by the client and suppresses the "of N" count, so a stale 12-item body
  answering a request for 50 is not misreported as a supply shortfall.

---

## New files

```
api/                     rss.js (resolveLimit, narrowItems, enrichTokenBudget), index.js (per-limit cache)
src/app/services/        count.service.ts + spec
src/app/components/      paginator/ (ts, html, css, spec)
tests/                   rss.test.js, index.test.js, limits.test.js, fixtures/
```

---

## Outstanding

- **Nothing is committed.** 18 modified + 5 new paths.
- **`server/` is now dead** — only `fixtures/` (copied to `tests/`) and ~843 wrongly-tracked
  `node_modules` files remain. The CTO recommended deleting it. Left alone deliberately: deleting
  tracked files is the user's call.
- **`package-lock.json` still gitignored and untracked.** Vercel resolves `^17.0.0` fresh.
- **Vercel CDN query-string keying is unverified.** Query strings should be part of Vercel's edge
  cache key and survive the `/api/(.*)` rewrite, but this needs confirming on a preview deploy — if
  the rewrite drops the query string, every visitor silently gets 12.
- **No retry on 429/5xx** in `enrichChunk`. Three parallel calls make a burst 429 likelier, and one
  429 degrades 20 articles. Judged not blocking at this scale.
- Cost per refresh still unmeasured — blocked on the dead API key.

---

## Model note

`gpt-5.4-pro` is not a chat model — it 404s on `/v1/chat/completions` and only works on
`/v1/responses`. Every gpt-5.x model rejects `max_tokens` in favour of `max_completion_tokens`,
and that budget covers reasoning tokens too. The code runs `gpt-5.4` via `OPENAI_MODEL`.
