# AINews — Session Handoff

Written 2026-09-01. Disposable — delete once the next session has picked it up.
Durable versions of everything here also live in Claude's memory and load automatically in a new session.

---

## ⚠ Read first: 20 files are uncommitted

Nothing in this session has been committed or pushed. The work is real but one `git checkout` from gone.

```
 M angular.json                                   ?? .vercelignore
 M src/app/app.component.html                     ?? .claude/launch.json
 M src/app/app.component.spec.ts                  ?? src/app/components/news-card/
 M src/app/app.component.ts                       ?? src/app/components/starred/
 M src/app/app.routes.ts                          ?? src/app/services/star.service.ts
 M src/app/components/dashboard/*.{css,html,ts,spec.ts}
 M src/app/components/header/*.{html,ts}          ?? src/app/services/star.service.spec.ts
 M src/app/model/interface.ts
 M src/app/services/openapi.service.spec.ts
 M tailwind.config.cjs
```

`gh` is not installed and git has no credentials in this environment, so **you commit and push yourself.**

---

## What shipped this session

**Starring + a starred view.** 48/48 frontend tests green, spec suite typechecks clean, `ng build` clean, and verified in a real browser rather than only in tests.

- `StarService` (`src/app/services/star.service.ts`) — localStorage, key `ainews.starred.v1`, versioned envelope `{version:1, items:[]}`, capped at 500, guarded against corrupt JSON and quota errors.
- `NewsCardComponent` — shared by the dashboard and the starred view.
- `StarredComponent` at `/starred`, with real routing and a header nav count badge.

**Three design decisions that are expensive to rediscover:**

1. **localStorage, not a DB.** Vercel functions are stateless *and* the app has no auth, so a server-side store would give every visitor one shared starred list.
2. **Stars store the full article snapshot, not a reference.** The feed only returns ~12 items, so anything starred last week is gone from it; a reference-based store would render blanks.
3. **Star identity is the canonicalized `reference_link`**, and `starKey()` must keep matching `canonicalizeLink()` in `api/rss.js` (~line 144) — host lowercased, path case kept, one trailing slash stripped, query and fragment dropped, `www.` NOT stripped, scheme ignored. If they drift, backend dedupe and star identity silently disagree.

**Bugs fixed along the way** (the card markup was being rewritten anyway): missing `rel="noopener noreferrer"` on reference links, an unguarded `severity.toLowerCase()` that would take down the whole list, raw ISO timestamps, a missing `trackBy` that rebuilt every card each minute, and a `hidden md:flex` header nav that made `/starred` unreachable on phones.

**Vercel deploy fix.** `vercel deploy --prod` was failing a size limit because `.angular/cache` is 346 MB and `.gitignore` does not govern Vercel uploads — only `.vercelignore` does, and there was none. Added one; upload set went **707 MB → 274 KB**. It also excludes `.env`, which was otherwise being bundled with the live OpenAI key inside it.

---

## Next requirement (not started)

**A selector for how many news items to see — default 12 latest, customizable up to 100, with pagination.**

This **supersedes** an earlier decision of 5-default/10-max. Do not build that one.

### The blocker is supply, not code

Measured live on 2026-09-01:

| Feed | Status | Items |
|---|---|---|
| The Hacker News | 200, after a 302 redirect | 50 |
| **BleepingComputer** | **403 — Cloudflare challenge** | **0** |
| Krebs on Security | 200 | 10 |

**~60 raw items, and one of three feeds is currently blocked.** After dedupe and the AI/ML keyword filter, far fewer — an earlier measurement cut 75 raw down to 19 AI-related. **100 items is not deliverable from the current feeds.**

The pipeline tolerates the outage (`Promise.allSettled`, proceeds on survivors), so the app is quietly running on two feeds with nothing surfacing that.

Good news: `api/rss.js` already selects **12** (`selectArticles(deduped, 12)`), so the new default needs no backend change, and `selectArticles(articles, count = 12)` already takes a count.

### Settle before building — don't assume

- Client-side pagination over one batch, or server-side with `?limit`/`?page`? The old "fetch max, slice client-side" reasoning assumed a 10-item ceiling.
- How does it interact with the 5-minute backend cache and the 60-second frontend refresh?
- Does the selection persist across reloads, or reset to 12?
- Does pagination apply to `/starred` too, which can hold 500 items?

---

## Known outstanding issues

- **`package-lock.json` is gitignored and untracked** — Vercel resolves `^17.0.0` ranges fresh, so deployed builds may not match local. Recommended committing it; undecided.
- **Vercel env vars** `OPENAI_API_KEY` and `OPENAI_MODEL` (`gpt-5.4`) must be set in project settings now that `.env` is excluded from the bundle. Without them the API still serves real headlines but degrades to `severity: 'Unknown'`.
- **Backend tests are orphaned** (deferred by you). `server/*.test.js` still import `./rss.js` / `./index.js`, which moved to `api/`. `npm run test:api` scans `api/`, which has no test files. Backend coverage is zero.
- Root `node_modules` is missing `dotenv`, `axios`, `rss-parser` — the API won't start locally without `npm install`.
- `GET /api/news` has never been smoke-tested end-to-end against real feeds; cost per refresh unmeasured.
- `server/node_modules` has ~843 files wrongly tracked, because `.gitignore` line 10 is root-anchored `/node_modules`.

---

## Model note

`gpt-5.4-pro` is **not** a chat model — it 404s on `/v1/chat/completions` and only works on `/v1/responses`. Every gpt-5.x model also rejects `max_tokens` in favour of `max_completion_tokens`. The code runs `gpt-5.4` via `OPENAI_MODEL`, verified working with `temperature` and JSON mode.
