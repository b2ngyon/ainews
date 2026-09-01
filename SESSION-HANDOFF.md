# AINews — Session Handoff

Rewritten 2026-09-02. Disposable — delete once the next session has picked it up.
Durable versions of everything here also live in Claude's memory and load automatically.

---

## State: one file dirty, mid-change

The previous session's 20 uncommitted files **were committed** as `c1e76c2 feature update`.
That warning is resolved — do not go looking for it.

The only dirty file is `api/rss.js` (+101/−41). It **passes `node --check`** but is an
**incomplete implementation** of the count selector. Nothing is broken; nothing is finished.

---

## The count selector — all four open questions are now SETTLED

Asked and answered 2026-09-02. Do not re-open these.

| Question | Decision |
|---|---|
| Maximum count | **50**, not 100. Selector offers **12 / 25 / 50**, default 12. |
| Architecture | **Server-side `?limit`, client-side paging.** Per-limit cache. Page turns do not refetch. |
| Persistence | **localStorage**, same as starring. |
| `/starred` | **Yes, same paginator**, fixed page size. |

**Why 50 and not 100:** re-measured live on 2026-09-02 —
The Hacker News 200/50 items, **BleepingComputer 200/15 items (recovered — it was 403 yesterday)**,
Krebs 200/10 items. ~75 raw with all three healthy, ~60 when BleepingComputer is Cloudflare-blocked
again, which it intermittently is. 50 is the largest count that survives that outage. The user
accepted this over the original 100.

---

## What I actually changed in `api/rss.js`

**1. Limit constants + `resolveLimit()`** (new exports, above `AI_KEYWORDS`)
`ALLOWED_LIMITS = [12,25,50]`, `DEFAULT_LIMIT = 12`, `MAX_LIMIT = 50`.
`resolveLimit(requested)` snaps an arbitrary number onto the allowed set — unparseable → 12,
in-between → snaps up, over-ceiling → 50. Restricting the set keeps the per-limit cache bounded
and stops a public endpoint being used to run up an OpenAI bill one arbitrary integer at a time.

**2. `enrichArticles` rewritten to chunk** — this was a real latent bug, not a refactor.
The old code sent the entire batch in one call with a hardcoded `max_completion_tokens: 1500`.
At ~60 tokens of JSON per item that truncates somewhere around 20–25 items, and a truncated
response fails `JSON.parse`, which degraded **every** article to `severity: 'Unknown'` — not just
the overflowing one. So the feature as originally specced would have silently destroyed
enrichment the moment anyone picked 25 or 50.

Now: `ENRICH_CHUNK_SIZE = 20`, chunks run in parallel via `Promise.all`, budget is
`chunk.length * 90 + 200` tokens. Indices in each request/response are **chunk-local**, so a model
echoing a bad index cannot write into another chunk's slot. One failing chunk degrades only its
own articles.

Also removed the `[VERIFY-CALL-COUNT]` and `[TEMP-USAGE-LOG]` debug logging left over from an
earlier session, and the now-unused `SEVERITIES`-adjacent duplicate system-message string.

---

## ⚠ Bug found and deliberately NOT fixed

`degradedEnrichment()` (`api/rss.js:291`) does not set `severity_index`.
`fetchNewsFromRss` then reads `enrichment.severity_index` → `undefined`, and
`openapi.service.ts` sorts on it → `NaN` comparisons, so unenriched items sort unpredictably.

This is **pre-existing**, not something the chunking change introduced. It bites hardest exactly
when enrichment fails, which is when the OpenAI key is missing — i.e. the current Vercel deploy
if the env vars still aren't set. One-line fix: add `severity_index: 1` (what `clampSeverityIndex`
returns for unknown). I stopped before applying it.

---

## What is NOT built yet

**Backend**
- `api/index.js` still ignores the query string and the cache is a single object. Needs:
  `resolveLimit(req.query.limit)`, cache as `Map<limit, {data,timestamp}>`, `lastGood` as
  `Map<limit, data>`. Import `resolveLimit` from `./rss.js`.
- `fetchNewsFromRss` still hardcodes `selectArticles(deduped, 12)` at **line 477**. Needs to take
  `count` from its `deps` argument. `selectArticles(articles, count = 12)` already accepts it.

**Frontend — none of this is started**
- `OpenapiService.getNews()` takes no argument; needs `getNews(limit)`.
- No preferences service for the `localStorage` count (suggest key `ainews.count.v1`, mirroring
  `StarService`'s versioned-envelope + corrupt-JSON-guard pattern).
- No paginator component. Needs to be shared — dashboard and `/starred` both use it.
- Dashboard needs the 12/25/50 selector and a "Showing 1–12 of 47" line. That line matters: it is
  how a supply shortfall becomes visible instead of silent.
- Interaction with the 60s auto-refresh is undecided in code: changing the count must refetch,
  changing the page must not.

---

## Known outstanding issues (unchanged from before)

- **Vercel env vars** `OPENAI_API_KEY` and `OPENAI_MODEL` (`gpt-5.4`) must be set in project
  settings now that `.env` is excluded by `.vercelignore`. Without them the API still serves real
  headlines but every item degrades to `severity: 'Unknown'` — and see the `severity_index` bug above.
- **`package-lock.json` is gitignored and untracked** — Vercel resolves `^17.0.0` fresh, so
  deployed builds may not match local. Recommended committing it; still undecided.
- **Backend tests are orphaned.** `server/*.test.js` still import `./rss.js` / `./index.js`, which
  moved to `api/`. `npm run test:api` scans `api/`, which has no test files. Backend coverage is
  **zero** — including for the chunking logic I just wrote.
- Root `node_modules` is missing `dotenv`, `axios`, `rss-parser`. The API will not start locally
  until `npm install`.
- `server/node_modules` has ~843 files wrongly tracked — `.gitignore` line 10 is root-anchored
  `/node_modules`.
- `GET /api/news` has never been smoke-tested end-to-end against real feeds; cost per refresh
  unmeasured, and it is about to become up to ~4x larger per refresh at limit=50.

---

## Model note

`gpt-5.4-pro` is **not** a chat model — it 404s on `/v1/chat/completions` and only works on
`/v1/responses`. Every gpt-5.x model also rejects `max_tokens` in favour of
`max_completion_tokens`. The code runs `gpt-5.4` via `OPENAI_MODEL`, verified working with
`temperature` and JSON mode.
