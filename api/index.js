import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchNewsFromRss, resolveLimit, narrowItems, ALLOWED_LIMITS } from './rss.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// On Vercel, env vars come from the project settings — there is no .env file
// in the deployment bundle. Only read one when running locally.
if (!process.env.VERCEL) {
  dotenv.config({ path: join(__dirname, '../.env') });
}

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Builds the Express app. `fetchNews` is injected so tests can exercise the
 * caching / success / error paths without hitting the real RSS feeds or
 * OpenAI API.
 */
export function createApp(fetchNews = fetchNewsFromRss, ttlMs = CACHE_TTL_MS) {
  const app = express();

  // Same-origin in production, so CORS only matters for `ng serve` on 4200.
  if (!process.env.VERCEL) {
    app.use(cors({
      origin: ['http://localhost:4200', 'http://localhost:3000'],
      credentials: true
    }));
  }
  app.use(express.json());

  // NOTE: on Vercel this is per-instance memory. It survives warm invocations
  // on the same instance and vanishes on cold starts. The Cache-Control header
  // below is what actually does the heavy lifting in production.
  //
  // Keyed by limit, because /api/news?limit=50 and ?limit=12 are different
  // bodies. Query strings are part of Vercel's edge cache key, so the CDN
  // keys them apart too.
  const cache = new Map();
  const lastGood = new Map();

  // Concurrent misses on the same limit must share one pipeline run. Without
  // this, two simultaneous cold requests both fetch every feed and both pay
  // for enrichment - and per-limit keying multiplies that by the number of
  // limits in play.
  const inFlight = new Map();

  const ttlSeconds = Math.floor(ttlMs / 1000);
  const isFresh = (entry) => entry && Date.now() - entry.timestamp < ttlMs;
  const larger = (limit) => ALLOWED_LIMITS.filter((l) => l > limit).sort((a, b) => a - b);

  /**
   * A warm entry for a LARGER limit can serve a smaller one for free, because
   * narrowItems reproduces selectArticles' ranking exactly. So once a reader
   * asking for 50 has warmed the cache, readers on the default 12 are served
   * with no feed fetch and no OpenAI spend.
   */
  function servableFromCache(limit) {
    if (isFresh(cache.get(limit))) return cache.get(limit).data;
    for (const bigger of larger(limit)) {
      if (isFresh(cache.get(bigger))) return narrowItems(cache.get(bigger).data, limit);
    }
    return null;
  }

  /**
   * Stale fallback. Prefers narrowing a larger previous success; falls back to
   * the largest smaller one rather than erroring. Keyed-only lookup would 500
   * on a cold instance whose first request is ?limit=50 - which on serverless
   * is the normal case, not the edge case.
   */
  function staleFallback(limit) {
    if (lastGood.has(limit)) return lastGood.get(limit);
    for (const bigger of larger(limit)) {
      if (lastGood.has(bigger)) return narrowItems(lastGood.get(bigger), limit);
    }
    const smaller = ALLOWED_LIMITS.filter((l) => l < limit).sort((a, b) => b - a);
    for (const small of smaller) {
      if (lastGood.has(small)) return lastGood.get(small);
    }
    return null;
  }

  function loadNews(limit) {
    if (inFlight.has(limit)) return inFlight.get(limit);

    const pending = (async () => {
      const newsItems = await fetchNews({ count: limit });
      cache.set(limit, { data: newsItems, timestamp: Date.now() });
      lastGood.set(limit, newsItems);
      return newsItems;
    })().finally(() => inFlight.delete(limit));

    inFlight.set(limit, pending);
    return pending;
  }

  app.get('/api/news', async (req, res) => {
    // The single place a requested count is clamped to something allowed.
    const limit = resolveLimit(req.query.limit);

    try {
      const cached = servableFromCache(limit);
      if (cached) {
        res.set('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`);
        return res.json(cached);
      }

      const newsItems = await loadNews(limit);

      res.set('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`);
      res.json(newsItems);
    } catch (error) {
      const stale = staleFallback(limit);
      if (stale) {
        res.set('X-News-Stale', 'true');
        res.set('Cache-Control', 'no-store');
        return res.json(stale);
      }

      const message = error?.message === 'OpenAI API key not configured'
        ? error.message
        : 'Failed to fetch news';

      res.set('Cache-Control', 'no-store');
      // Raw error text is logged, never returned - this endpoint is public.
      console.error(`[api] /api/news failed at limit ${limit}: ${error?.message || error}`);
      res.status(500).json({ error: message, message });
    }
  });

  // Must live under /api — anything else gets rewritten to index.html.
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

const app = createApp();

const isRunDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isRunDirectly) {
  app.listen(PORT, () => {
    console.log(`AINews backend running on http://localhost:${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/news`);
  });
}

// Vercel picks this up and wraps it as a serverless function.
export default app;