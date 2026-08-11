import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchNewsFromRss } from './rss.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Builds the Express app. `fetchNews` is injected so tests can exercise the
 * caching / success / error paths without hitting the real RSS feeds or
 * OpenAI API.
 */
export function createApp(fetchNews = fetchNewsFromRss, ttlMs = CACHE_TTL_MS) {
  const app = express();

  app.use(cors({
    origin: ['http://localhost:4200', 'http://localhost:3000'],
    credentials: true
  }));
  app.use(express.json());

  const cache = {
    data: null,
    timestamp: null
  };
  let lastGood = null;

  app.get('/api/news', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < ttlMs) {
        return res.json(cache.data);
      }

      const newsItems = await fetchNews();

      cache.data = newsItems;
      cache.timestamp = Date.now();
      lastGood = newsItems;

      res.json(newsItems);
    } catch (error) {
      if (lastGood) {
        res.set('X-News-Stale', 'true');
        return res.json(lastGood);
      }

      const message = error?.message === 'OpenAI API key not configured'
        ? error.message
        : 'Failed to fetch news';

      res.status(500).json({
        error: message,
        message: error.message
      });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

const isRunDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isRunDirectly) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`AINews backend running on http://localhost:${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/news`);
  });
}
