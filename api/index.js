import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchNewsFromRss } from './rss.js';

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
  const cache = {
    data: null,
    timestamp: null
  };
  let lastGood = null;

  const ttlSeconds = Math.floor(ttlMs / 1000);

  app.get('/api/news', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < ttlMs) {
        res.set('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`);
        return res.json(cache.data);
      }

      const newsItems = await fetchNews();

      cache.data = newsItems;
      cache.timestamp = Date.now();
      lastGood = newsItems;

      res.set('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`);
      res.json(newsItems);
    } catch (error) {
      if (lastGood) {
        res.set('X-News-Stale', 'true');
        res.set('Cache-Control', 'no-store');
        return res.json(lastGood);
      }

      const message = error?.message === 'OpenAI API key not configured'
        ? error.message
        : 'Failed to fetch news';

      res.set('Cache-Control', 'no-store');
      res.status(500).json({
        error: message,
        message: error.message
      });
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