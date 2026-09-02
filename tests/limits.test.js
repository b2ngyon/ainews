import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../api/index.js';
import {
  resolveLimit,
  narrowItems,
  selectArticles,
  enrichArticles,
  fetchNewsFromRss,
  enrichTokenBudget,
  ALLOWED_LIMITS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ENRICH_CHUNK_SIZE,
} from '../api/rss.js';

// ---------------------------------------------------------------------------
// Helpers. Nothing here touches the network or OpenAI.
// ---------------------------------------------------------------------------

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

async function withApiKey(value, fn) {
  const original = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

/** `total` articles, `aiCount` of which trip the AI keyword filter. */
function makeArticles(total, aiCount = Math.floor(total / 4)) {
  const out = [];
  let ai = 0;
  for (let i = 0; i < total; i++) {
    const isAi = ai < aiCount;
    if (isAi) ai++;
    out.push({
      title: isAi ? `llm prompt injection story ${i}` : `router firmware story ${i}`,
      description: isAi ? 'openai machine learning' : 'patch tuesday advisory',
      news_timestamp: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(),
      reference_link: `https://example.test/${i}`,
      source_author: 'fixture',
    });
  }
  return out;
}

/** An OpenAI stub that answers every index in the chunk it was given. */
function okPost(recorder = []) {
  return async (_url, body) => {
    const items = JSON.parse(body.messages[1].content);
    recorder.push({ size: items.length, budget: body.max_completion_tokens });
    return {
      data: {
        choices: [{
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              items: items.map((it) => ({
                index: it.index,
                summary: `summary ${it.index}`,
                severity: 'High',
                category: 'Threat',
                cve_reference: null,
              })),
            }),
          },
        }],
        usage: { total_tokens: 1 },
      },
    };
  };
}

// ---------------------------------------------------------------------------

describe('resolveLimit', () => {
  test('always returns a member of ALLOWED_LIMITS, whatever it is handed', () => {
    const inputs = [
      undefined, null, '', '   ', 'abc', 0, -5, 1e9, NaN, Infinity, -Infinity,
      12.5, '0x19', [], [25], {}, true, false, '12', '25', '50', '999', '1',
    ];
    for (const input of inputs) {
      const result = resolveLimit(input);
      assert.ok(
        ALLOWED_LIMITS.includes(result),
        `resolveLimit(${JSON.stringify(input)}) returned ${result}, which is not allowed`
      );
    }
  });

  test('snaps up to the next allowed value and caps at the ceiling', () => {
    assert.equal(resolveLimit(1), 12);
    assert.equal(resolveLimit(12), 12);
    assert.equal(resolveLimit(13), 25);
    assert.equal(resolveLimit(25), 25);
    assert.equal(resolveLimit(26), 50);
    assert.equal(resolveLimit(50), 50);
    assert.equal(resolveLimit(100), MAX_LIMIT);
    assert.equal(resolveLimit(999999), MAX_LIMIT);
  });

  test('falls back to the default for anything unparseable', () => {
    assert.equal(resolveLimit('abc'), DEFAULT_LIMIT);
    assert.equal(resolveLimit(undefined), DEFAULT_LIMIT);
    assert.equal(resolveLimit(-1), DEFAULT_LIMIT);
  });
});

describe('narrowItems', () => {
  test('is equivalent to selecting the smaller count directly', () => {
    // The whole per-limit cache optimisation rests on this. A plain
    // .slice(0, count) is NOT equivalent - selectArticles re-sorts by date
    // after backfilling, so slicing returns mostly general news.
    for (const [total, aiCount] of [[75, 19], [75, 4], [75, 60], [60, 19], [30, 19], [20, 20], [12, 0]]) {
      const pool = makeArticles(total, aiCount);
      for (const big of [25, 50]) {
        for (const small of [12, 25]) {
          if (small > big) continue;
          const direct = selectArticles(pool, small).map((a) => a.reference_link);
          const narrowed = narrowItems(selectArticles(pool, big), small).map((a) => a.reference_link);
          assert.deepEqual(narrowed, direct, `pool=${total}/ai=${aiCount} ${big}->${small}`);
        }
      }
    }
  });

  test('a naive slice would NOT be equivalent - guards the optimisation', () => {
    const pool = makeArticles(75, 19);
    const direct = selectArticles(pool, 12);
    const sliced = selectArticles(pool, 50).slice(0, 12);
    assert.notDeepEqual(
      sliced.map((a) => a.reference_link),
      direct.map((a) => a.reference_link)
    );
  });

  test('returns the input untouched when it is already at or below count', () => {
    const items = selectArticles(makeArticles(10), 10);
    assert.equal(narrowItems(items, 25), items);
  });
});

describe('enrichArticles chunking', () => {
  test('splits 47 articles into 20/20/7 and sizes each budget to its chunk', async () => {
    await withApiKey('test-key', async () => {
      const calls = [];
      await enrichArticles(makeArticles(47), okPost(calls));

      assert.equal(calls.length, 3);
      assert.deepEqual(calls.map((c) => c.size), [20, 20, 7]);
      assert.deepEqual(calls.map((c) => c.budget), [
        enrichTokenBudget(20), enrichTokenBudget(20), enrichTokenBudget(7),
      ]);
    });
  });

  test('realigns results even when the model echoes indices in reverse', async () => {
    await withApiKey('test-key', async () => {
      const post = async (_url, body) => {
        const items = JSON.parse(body.messages[1].content);
        return {
          data: {
            choices: [{
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  items: [...items].reverse().map((it) => ({
                    index: it.index,
                    summary: `S${it.index}`,
                    severity: 'Low',
                    category: 'Research',
                    cve_reference: null,
                  })),
                }),
              },
            }],
          },
        };
      };

      const result = await enrichArticles(makeArticles(47), post);
      // Index is chunk-local, so item 25 is index 5 of chunk 2.
      assert.equal(result[0].summary, 'S0');
      assert.equal(result[25].summary, 'S5');
      assert.equal(result[46].summary, 'S6');
      assert.ok(result.every((r) => r.enriched));
    });
  });

  test('one failing chunk degrades only its own 20 articles', async () => {
    await withApiKey('test-key', async () => {
      let call = 0;
      const good = okPost();
      const post = async (url, body, config) => {
        // Chunks dispatch in parallel, so identify by content, not call order.
        const items = JSON.parse(body.messages[1].content);
        call++;
        if (items.length === 20 && body.messages[1].content.includes('story 20')) {
          throw new Error('network blip');
        }
        return good(url, body, config);
      };

      const result = await enrichArticles(makeArticles(47), post);
      assert.ok(call >= 3);
      for (let i = 0; i < 20; i++) assert.equal(result[i].enriched, true, `item ${i}`);
      for (let i = 20; i < 40; i++) assert.equal(result[i].enriched, false, `item ${i}`);
      for (let i = 40; i < 47; i++) assert.equal(result[i].enriched, true, `item ${i}`);
    });
  });

  test('a truncated response (finish_reason=length) degrades that chunk instead of throwing', async () => {
    await withApiKey('test-key', async () => {
      const post = async () => ({
        data: {
          choices: [{ finish_reason: 'length', message: { content: '{"items":[{"index":0,' } }],
          usage: { completion_tokens: 2180 },
        },
      });
      const result = await enrichArticles(makeArticles(5), post);
      assert.equal(result.length, 5);
      assert.ok(result.every((r) => r.enriched === false));
      assert.ok(result.every((r) => r.severity_index === 1));
    });
  });

  test('ignores an out-of-range or duplicated index rather than applying it', async () => {
    await withApiKey('test-key', async () => {
      const post = async () => ({
        data: {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                items: [
                  { index: 0, summary: 'first', severity: 'Critical', category: 'Threat', cve_reference: null },
                  { index: 0, summary: 'duplicate wins nothing', severity: 'Low', category: 'Threat', cve_reference: null },
                  { index: 99, summary: 'out of range', severity: 'Low', category: 'Threat', cve_reference: null },
                  { index: -1, summary: 'negative', severity: 'Low', category: 'Threat', cve_reference: null },
                ],
              }),
            },
          }],
        },
      });

      const result = await enrichArticles(makeArticles(3), post);
      assert.equal(result[0].summary, 'first');
      assert.equal(result[0].severity, 'Critical');
      assert.equal(result[1].enriched, false);
      assert.equal(result[2].enriched, false);
    });
  });

  test('makes zero calls with no API key or no articles', async () => {
    let calls = 0;
    const counting = async () => { calls++; return { data: {} }; };

    await withApiKey(undefined, async () => {
      await enrichArticles(makeArticles(5), counting);
    });
    await withApiKey('test-key', async () => {
      await enrichArticles([], counting);
    });
    assert.equal(calls, 0);
  });

  test('ENRICH_CHUNK_SIZE stays under the point where the old 1500 budget truncated', () => {
    assert.ok(ENRICH_CHUNK_SIZE <= 20);
    assert.ok(enrichTokenBudget(ENRICH_CHUNK_SIZE) > 1500);
  });
});

describe('degraded enrichment', () => {
  test('every item carries a finite severity_index even with no API key', async () => {
    await withApiKey(undefined, async () => {
      const parser = {
        async parseURL() {
          return {
            title: 'Feed',
            items: makeArticles(6).map((a) => ({
              title: a.title,
              link: a.reference_link,
              isoDate: a.news_timestamp,
              contentSnippet: a.description,
              'dc:creator': 'Fixture',
            })),
          };
        },
      };

      const items = await fetchNewsFromRss({ parser, feedUrls: ['one'], count: 12 });
      assert.ok(items.length > 0);
      for (const item of items) {
        // The regression guard for the NaN sort in openapi.service.ts.
        assert.ok(Number.isFinite(item.severity_index), `${item.title} -> ${item.severity_index}`);
        assert.equal(item.severity_index, 1);
        assert.equal(item.severity, 'Unknown');
      }
    });
  });
});

describe('fetchNewsFromRss count', () => {
  function parserFor(total) {
    return {
      async parseURL() {
        return {
          title: 'Feed',
          items: makeArticles(total).map((a) => ({
            title: a.title,
            link: a.reference_link,
            isoDate: a.news_timestamp,
            contentSnippet: a.description,
            'dc:creator': 'Fixture',
          })),
        };
      },
    };
  }

  test('honours the requested count', async () => {
    await withApiKey(undefined, async () => {
      const items = await fetchNewsFromRss({ parser: parserFor(60), feedUrls: ['one'], count: 25 });
      assert.equal(items.length, 25);
    });
  });

  test('defaults to DEFAULT_LIMIT when count is omitted', async () => {
    await withApiKey(undefined, async () => {
      const items = await fetchNewsFromRss({ parser: parserFor(60), feedUrls: ['one'] });
      assert.equal(items.length, DEFAULT_LIMIT);
    });
  });

  test('returns whatever exists without padding when supply is short', async () => {
    await withApiKey(undefined, async () => {
      const items = await fetchNewsFromRss({ parser: parserFor(7), feedUrls: ['one'], count: 50 });
      assert.equal(items.length, 7);
    });
  });
});

describe('GET /api/news?limit', () => {
  function fetcherSpy(perItem = (i) => ({ title: `item ${i}`, ai_related: i % 3 === 0 })) {
    const calls = [];
    const fetchNews = async ({ count } = {}) => {
      calls.push(count);
      return Array.from({ length: count }, (_, i) => ({
        ...perItem(i),
        news_timestamp: new Date(Date.UTC(2026, 0, 1) + (count - i) * 3600e3).toISOString(),
        severity_index: 1,
      }));
    };
    return { calls, fetchNews };
  }

  test('clamps the query string: ?limit=999 -> 50, ?limit=abc -> 12', async () => {
    const { calls, fetchNews } = fetcherSpy();
    const { baseUrl, close } = await startServer(createApp(fetchNews, 60000));
    try {
      const big = await (await fetch(`${baseUrl}/api/news?limit=999`)).json();
      assert.equal(big.length, MAX_LIMIT);

      const bad = await (await fetch(`${baseUrl}/api/news?limit=abc`)).json();
      assert.equal(bad.length, DEFAULT_LIMIT);
      assert.ok(calls.includes(MAX_LIMIT));
    } finally {
      await close();
    }
  });

  test('serves a smaller limit from a warm larger entry without refetching', async () => {
    const { calls, fetchNews } = fetcherSpy();
    const { baseUrl, close } = await startServer(createApp(fetchNews, 60000));
    try {
      await fetch(`${baseUrl}/api/news?limit=50`);
      assert.deepEqual(calls, [50]);

      const twelve = await (await fetch(`${baseUrl}/api/news?limit=12`)).json();
      assert.equal(twelve.length, 12);
      // No second pipeline run, so no second enrichment bill.
      assert.deepEqual(calls, [50]);
    } finally {
      await close();
    }
  });

  test('does refetch when the requested limit is larger than anything cached', async () => {
    const { calls, fetchNews } = fetcherSpy();
    const { baseUrl, close } = await startServer(createApp(fetchNews, 60000));
    try {
      await fetch(`${baseUrl}/api/news?limit=12`);
      await fetch(`${baseUrl}/api/news?limit=50`);
      assert.deepEqual(calls, [12, 50]);
    } finally {
      await close();
    }
  });

  test('the same limit inside the TTL hits the fetcher once', async () => {
    const { calls, fetchNews } = fetcherSpy();
    const { baseUrl, close } = await startServer(createApp(fetchNews, 60000));
    try {
      await fetch(`${baseUrl}/api/news?limit=25`);
      await fetch(`${baseUrl}/api/news?limit=25`);
      await fetch(`${baseUrl}/api/news?limit=25`);
      assert.deepEqual(calls, [25]);
    } finally {
      await close();
    }
  });

  test('concurrent misses on one limit share a single pipeline run', async () => {
    let calls = 0;
    const fetchNews = async ({ count }) => {
      calls++;
      await new Promise((r) => setTimeout(r, 40));
      return Array.from({ length: count }, (_, i) => ({ title: `i${i}`, ai_related: false, severity_index: 1 }));
    };
    const { baseUrl, close } = await startServer(createApp(fetchNews, 60000));
    try {
      await Promise.all([
        fetch(`${baseUrl}/api/news?limit=25`),
        fetch(`${baseUrl}/api/news?limit=25`),
        fetch(`${baseUrl}/api/news?limit=25`),
      ]);
      assert.equal(calls, 1, 'three concurrent misses should not run three pipelines');
    } finally {
      await close();
    }
  });

  test('a cold instance whose first request fails still serves a narrowed stale body', async () => {
    // The cold-start case: 50 succeeded once, then the feeds die, then a
    // reader asks for 12. A per-limit-only lastGood would 500 here.
    let fail = false;
    const fetchNews = async ({ count }) => {
      if (fail) throw new Error('all feeds down');
      return Array.from({ length: count }, (_, i) => ({
        title: `item ${i}`,
        ai_related: i % 3 === 0,
        news_timestamp: new Date(Date.UTC(2026, 0, 1) + (count - i) * 3600e3).toISOString(),
        severity_index: 1,
      }));
    };

    const { baseUrl, close } = await startServer(createApp(fetchNews, 1));
    try {
      await fetch(`${baseUrl}/api/news?limit=50`);
      fail = true;
      await new Promise((r) => setTimeout(r, 10)); // let the 1ms TTL lapse

      const res = await fetch(`${baseUrl}/api/news?limit=12`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('X-News-Stale'), 'true');
      assert.equal(res.headers.get('Cache-Control'), 'no-store');

      const body = await res.json();
      assert.equal(body.length, 12, 'stale body should be narrowed to the requested limit');
    } finally {
      await close();
    }
  });
});
