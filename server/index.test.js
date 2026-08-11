import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.js';

/**
 * Starts the given Express app on an ephemeral port and returns its base URL
 * plus a close() helper. Using a real listening server (instead of mocking
 * http) keeps these as true integration tests of the route handlers.
 */
function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

describe('GET /health', () => {
  test('returns 200 and status ok', async () => {
    const app = createApp(async () => []);
    const { baseUrl, close } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/health`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(body, { status: 'ok' });
    } finally {
      await close();
    }
  });
});

describe('GET /api/news', () => {
  test('returns 200 with news items from the injected fetcher', async () => {
    const sampleNews = [
      { title: 'Test CVE disclosed', summary: 'summary', severity: 'High' }
    ];
    const app = createApp(async () => sampleNews);
    const { baseUrl, close } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/news`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(body, sampleNews);
    } finally {
      await close();
    }
  });

  test('caches the response and does not call the fetcher again within the TTL', async () => {
    let callCount = 0;
    const fetchNews = async () => {
      callCount += 1;
      return [{ title: `call-${callCount}` }];
    };
    const app = createApp(fetchNews, 5 * 60 * 1000);
    const { baseUrl, close } = await startServer(app);

    try {
      const first = await (await fetch(`${baseUrl}/api/news`)).json();
      const second = await (await fetch(`${baseUrl}/api/news`)).json();

      assert.equal(callCount, 1);
      assert.deepEqual(first, second);
    } finally {
      await close();
    }
  });

  test('refetches once the cache TTL has expired', async () => {
    let callCount = 0;
    const fetchNews = async () => {
      callCount += 1;
      return [{ title: `call-${callCount}` }];
    };
    const app = createApp(fetchNews, 0); // TTL of 0 => always stale
    const { baseUrl, close } = await startServer(app);

    try {
      await fetch(`${baseUrl}/api/news`);
      await fetch(`${baseUrl}/api/news`);

      assert.equal(callCount, 2);
    } finally {
      await close();
    }
  });

  test('returns 500 with an error payload when the fetcher throws', async () => {
    const app = createApp(async () => {
      throw new Error('boom');
    });
    const { baseUrl, close } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/news`);
      const body = await res.json();

      assert.equal(res.status, 500);
      assert.equal(body.error, 'Failed to fetch news');
      assert.equal(body.message, 'boom');
    } finally {
      await close();
    }
  });

  test('returns 500 with a specific error when the API key is missing', async () => {
    const app = createApp(async () => {
      throw new Error('OpenAI API key not configured');
    });
    const { baseUrl, close } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/news`);
      const body = await res.json();

      assert.equal(res.status, 500);
      assert.equal(body.error, 'OpenAI API key not configured');
    } finally {
      await close();
    }
  });

  test('serves stale cached data with X-News-Stale header when the fetcher fails after a prior success', async () => {
    let callCount = 0;
    const firstPayload = [{ title: 'first successful fetch' }];
    const fetchNews = async () => {
      callCount += 1;
      if (callCount === 1) {
        return firstPayload;
      }
      throw new Error('feed unavailable');
    };
    const app = createApp(fetchNews, 0); // TTL of 0 => always stale, forces refetch on call 2
    const { baseUrl, close } = await startServer(app);

    try {
      const first = await (await fetch(`${baseUrl}/api/news`)).json();
      assert.deepEqual(first, firstPayload);

      const secondRes = await fetch(`${baseUrl}/api/news`);
      const secondBody = await secondRes.json();

      assert.equal(callCount, 2);
      assert.equal(secondRes.status, 200);
      assert.deepEqual(secondBody, firstPayload);
      assert.equal(secondRes.headers.get('x-news-stale'), 'true');
    } finally {
      await close();
    }
  });

  test('returns 500 when the fetcher throws and there is no prior successful fetch', async () => {
    const app = createApp(async () => {
      throw new Error('never succeeded');
    });
    const { baseUrl, close } = await startServer(app);

    try {
      const res = await fetch(`${baseUrl}/api/news`);
      const body = await res.json();

      assert.equal(res.status, 500);
      assert.equal(res.headers.get('x-news-stale'), null);
      assert.equal(body.error, 'Failed to fetch news');
      assert.equal(body.message, 'never succeeded');
    } finally {
      await close();
    }
  });
});
