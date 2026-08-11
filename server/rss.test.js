import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';

import {
  normalizeArticle,
  fetchFeeds,
  dedupeArticles,
  partitionByAi,
  selectArticles,
  enrichArticles,
  fetchNewsFromRss,
} from './rss.js';

// ---------------------------------------------------------------------------
// Fixture / stub helpers. NOTHING in this file ever touches the network:
// - real feeds are read from local fixture files on disk
// - `parser` seams are hand-rolled objects or a real `rss-parser` instance
//   whose `parseString()` is called against fixture text (never `parseURL`
//   against a live host)
// - `post` seams are local stub functions; the real `axios.post` is never
//   imported or invoked
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixtureText(filename) {
  return fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

const realParser = new Parser();

async function loadFeed(filename) {
  const text = loadFixtureText(filename);
  return realParser.parseString(text);
}

/**
 * Builds a parser stub exposing parseURL(url), keyed by a map of
 * url -> fixture filename. A mapped value of 'REJECT' causes that URL to
 * reject with a synthetic error. Never touches the network.
 */
function makeUrlKeyedParser(map) {
  return {
    async parseURL(url) {
      const entry = map[url];
      if (entry === undefined) {
        throw new Error(`makeUrlKeyedParser: no fixture mapped for ${url}`);
      }
      if (entry === 'REJECT') {
        throw new Error(`stub rejection for ${url}`);
      }
      return loadFeed(entry);
    },
  };
}

function makeOpenAiResponse(items) {
  return { data: { choices: [{ message: { content: JSON.stringify({ items }) } } ] } };
}

let articleSeq = 0;
function makeArticle(overrides = {}) {
  articleSeq += 1;
  return {
    title: `Synthetic Article ${articleSeq}`,
    description: 'Some plain description text with no CVE reference.',
    news_timestamp: '2026-07-01T00:00:00.000Z',
    reference_link: `https://example.test/article-${articleSeq}`,
    source_author: 'Test Author',
    ...overrides,
  };
}

function buildArticles(n) {
  return Array.from({ length: n }, (_, i) =>
    makeArticle({
      title: `Source Title ${i}`,
      description: `Source description ${i} with no CVE mentioned.`,
    })
  );
}

/** Saves/restores OPENAI_API_KEY around a test body so state never leaks. */
async function withApiKey(value, fn) {
  const original = process.env.OPENAI_API_KEY;
  if (value === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = value;
  }
  try {
    await fn();
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  }
}

// ---------------------------------------------------------------------------
// normalizeArticle
// ---------------------------------------------------------------------------

describe('normalizeArticle', () => {
  test('reduces THN <author> email-format to just the display name', async () => {
    const feed = await loadFeed('thehackernews.xml');
    const article = normalizeArticle(feed.items[0], feed.title);
    assert.equal(article.source_author, 'The Hacker News');
  });

  test('uses BleepingComputer <dc:creator> as-is', async () => {
    const feed = await loadFeed('bleepingcomputer.xml');
    const article = normalizeArticle(feed.items[0], feed.title);
    assert.equal(article.source_author, 'Ionut Ilascu');
  });

  test('uses Krebs <dc:creator> as-is', async () => {
    const feed = await loadFeed('krebsonsecurity.xml');
    const article = normalizeArticle(feed.items[0], feed.title);
    assert.equal(article.source_author, 'BrianKrebs');
  });

  test('decodes HTML entities such as &#8217; into a real apostrophe', async () => {
    const feed = await loadFeed('krebsonsecurity.xml');
    // "Lessons Learned from CISA&#8217;s Recent GitHub Leak"
    const rawItem = feed.items.find((item) => item.link.includes('lessons-learned-from-cisas-recent-github-leak'));
    const article = normalizeArticle(rawItem, feed.title);
    assert.equal(article.title, 'Lessons Learned from CISA’s Recent GitHub Leak');
    assert.ok(!article.title.includes('&#8217;'));
  });

  test('converts THN +0530 pubDate offset to the correct UTC instant', async () => {
    const feed = await loadFeed('thehackernews.xml');
    const article = normalizeArticle(feed.items[0], feed.title);
    // Wed, 29 Jul 2026 19:18:36 +0530
    assert.equal(article.news_timestamp, '2026-07-29T13:48:36.000Z');
  });

  test('converts BleepingComputer -0400 pubDate offset to the correct UTC instant', async () => {
    const feed = await loadFeed('bleepingcomputer.xml');
    const article = normalizeArticle(feed.items[0], feed.title);
    // Wed, 29 Jul 2026 10:55:57 -0400
    assert.equal(article.news_timestamp, '2026-07-29T14:55:57.000Z');
  });

  test('converts Krebs +0000 pubDate offset to the correct UTC instant', async () => {
    const feed = await loadFeed('krebsonsecurity.xml');
    const article = normalizeArticle(feed.items[0], feed.title);
    // Wed, 22 Jul 2026 01:10:38 +0000
    assert.equal(article.news_timestamp, '2026-07-22T01:10:38.000Z');
  });

  test('drops an item missing link', () => {
    const result = normalizeArticle(
      { title: 'No link here', isoDate: '2026-07-01T00:00:00.000Z' },
      'Feed'
    );
    assert.equal(result, null);
  });

  test('drops an item missing title', () => {
    const result = normalizeArticle(
      { link: 'https://example.test/x', isoDate: '2026-07-01T00:00:00.000Z' },
      'Feed'
    );
    assert.equal(result, null);
  });

  test('drops an item missing a date', () => {
    const result = normalizeArticle(
      { link: 'https://example.test/x', title: 'No date here' },
      'Feed'
    );
    assert.equal(result, null);
  });

  test('drops an item with an unparseable date', () => {
    const result = normalizeArticle(
      { link: 'https://example.test/x', title: 'Bad date', isoDate: 'not-a-real-date' },
      'Feed'
    );
    assert.equal(result, null);
  });

  test('drops a sponsored item (BleepingComputer "Sponsored by ..." dc:creator)', async () => {
    const feed = await loadFeed('bleepingcomputer.xml');
    const sponsoredRaw = feed.items.find((item) => item['dc:creator'] === 'Sponsored by Token Security');
    assert.ok(sponsoredRaw, 'fixture must contain the sponsored item');
    const result = normalizeArticle(sponsoredRaw, feed.title);
    assert.equal(result, null);
  });

  test('uses <description> for the description, NOT <content:encoded>, even when both are present', async () => {
    const feed = await loadFeed('krebsonsecurity.xml');
    const rawItem = feed.items[0]; // LG item: has a large content:encoded block
    assert.ok(rawItem['content:encoded'], 'fixture item should carry a content:encoded block');
    const article = normalizeArticle(rawItem, feed.title);

    // If this fails, rss.js has a genuine field-mapping bug (content:encoded
    // leaking into the description) - report it, do not fix it here.
    assert.ok(
      !article.description.includes('<p>') && !article.description.includes('<strong>'),
      'description should not contain HTML from content:encoded'
    );
    assert.ok(
      !article.description.includes('Update, July 22, 1:06 p.m. ET'),
      'description should not contain text that only appears in content:encoded'
    );
    assert.match(article.description, /^The home appliance giant LG Electronics USA/);
  });

  test('malformed.xml causes that one feed to reject without crashing the caller', async () => {
    const text = loadFixtureText('malformed.xml');
    await assert.rejects(() => realParser.parseString(text));
  });
});

// ---------------------------------------------------------------------------
// fetchFeeds
// ---------------------------------------------------------------------------

describe('fetchFeeds', () => {
  test('when 1 of 3 feeds rejects, survivors are returned and failures.length === 1', async () => {
    const urls = ['https://a.test/feed', 'https://b.test/feed', 'https://c.test/feed'];
    const parser = makeUrlKeyedParser({
      [urls[0]]: 'thehackernews.xml',
      [urls[1]]: 'bleepingcomputer.xml',
      [urls[2]]: 'REJECT',
    });

    const { articles, failures } = await fetchFeeds(urls, parser);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].url, urls[2]);
    assert.ok(articles.length > 0);
  });

  test('a malformed feed among healthy ones rejects individually without crashing the batch', async () => {
    const urls = ['https://good.test/feed', 'https://broken.test/feed'];
    const parser = makeUrlKeyedParser({
      [urls[0]]: 'krebsonsecurity.xml',
      [urls[1]]: 'malformed.xml',
    });

    const { articles, failures } = await fetchFeeds(urls, parser);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].url, urls[1]);
    assert.ok(articles.length > 0);
  });

  test('throws when all feeds reject', async () => {
    const urls = ['https://a.test/feed', 'https://b.test/feed', 'https://c.test/feed'];
    const parser = makeUrlKeyedParser({
      [urls[0]]: 'REJECT',
      [urls[1]]: 'REJECT',
      [urls[2]]: 'REJECT',
    });

    await assert.rejects(() => fetchFeeds(urls, parser), /All RSS feeds failed to fetch/);
  });

  test('fetchNewsFromRss also throws when all feeds reject', async () => {
    const urls = ['https://a.test/feed', 'https://b.test/feed', 'https://c.test/feed'];
    const parser = makeUrlKeyedParser({
      [urls[0]]: 'REJECT',
      [urls[1]]: 'REJECT',
      [urls[2]]: 'REJECT',
    });
    const post = async () => {
      throw new Error('post should never be called when all feeds fail');
    };

    await assert.rejects(() => fetchNewsFromRss({ parser, post, feedUrls: urls }));
  });
});

// ---------------------------------------------------------------------------
// dedupeArticles
// ---------------------------------------------------------------------------

describe('dedupeArticles', () => {
  test('THN and BC coverage of the same Minnesota water story remain distinct (different links/titles)', async () => {
    // Real-data case: both fixtures cover the same event, but their links and
    // titles are both worded differently, so they do NOT collapse under the
    // current link-then-title dedupe strategy. This documents that reality;
    // the actual collapsing behavior is proven by the synthetic tests below.
    const thnFeed = await loadFeed('thehackernews.xml');
    const bcFeed = await loadFeed('bleepingcomputer.xml');
    const thnArticle = normalizeArticle(thnFeed.items[0], thnFeed.title);
    const bcArticle = normalizeArticle(bcFeed.items[0], bcFeed.title);

    const result = dedupeArticles([thnArticle, bcArticle]);
    assert.equal(result.length, 2);
  });

  test('collapses the same canonical link (trailing slash variance) under different titles, keeping the earliest', () => {
    const earlier = makeArticle({
      reference_link: 'https://example.test/story',
      title: 'Original Headline',
      news_timestamp: '2026-07-01T00:00:00.000Z',
    });
    const later = makeArticle({
      reference_link: 'https://example.test/story/',
      title: 'Rewritten Headline',
      news_timestamp: '2026-07-02T00:00:00.000Z',
    });

    const result = dedupeArticles([earlier, later]);

    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Original Headline');
  });

  test('collapses links that differ only by tracking query params', () => {
    const a = makeArticle({
      reference_link: 'https://example.test/foo?utm_source=twitter',
      title: 'Same Story',
      news_timestamp: '2026-07-01T00:00:00.000Z',
    });
    const b = makeArticle({
      reference_link: 'https://example.test/foo?utm_source=newsletter&utm_medium=email',
      title: 'Same Story',
      news_timestamp: '2026-07-02T00:00:00.000Z',
    });

    const result = dedupeArticles([a, b]);

    assert.equal(result.length, 1);
    assert.equal(result[0].news_timestamp, '2026-07-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// partitionByAi
// ---------------------------------------------------------------------------

describe('partitionByAi', () => {
  test('positive: titles containing AI, LLM, ChatGPT, prompt injection, Hugging Face land in ai', () => {
    const articles = [
      makeArticle({ title: 'New AI regulation proposed by regulators' }),
      makeArticle({ title: 'Researchers fine-tune an LLM for malware detection' }),
      makeArticle({ title: 'ChatGPT exposed sensitive data in test' }),
      makeArticle({ title: 'New prompt injection technique bypasses filters' }),
      makeArticle({ title: 'Hugging Face releases new model hub feature' }),
    ];

    const { ai, general } = partitionByAi(articles);

    assert.equal(ai.length, 5);
    assert.equal(general.length, 0);
  });

  test('negative: "said", "again", "certain", "Mail", "claim" must NOT match the bare "ai" keyword', () => {
    const article = makeArticle({
      title: 'They said it again, for certain',
      description: 'Check your Mail inbox; this is not a claim.',
    });

    const { ai, general } = partitionByAi([article]);

    assert.equal(ai.length, 0);
    assert.equal(general.length, 1);
  });
});

// ---------------------------------------------------------------------------
// selectArticles
// ---------------------------------------------------------------------------

describe('selectArticles', () => {
  function dated(daysAgo) {
    const d = new Date('2026-07-30T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString();
  }

  test('4 AI + 20 general -> exactly 10 returned, 4 ai_related:true and 6 ai_related:false', () => {
    const aiArticles = Array.from({ length: 4 }, (_, i) =>
      makeArticle({ title: `AI news item ${i}`, news_timestamp: dated(i) })
    );
    const generalArticles = Array.from({ length: 20 }, (_, i) =>
      makeArticle({ title: `Routine update item ${i}`, news_timestamp: dated(i + 30) })
    );

    const selected = selectArticles([...aiArticles, ...generalArticles], 10);

    assert.equal(selected.length, 10);
    assert.equal(selected.filter((a) => a.ai_related === true).length, 4);
    assert.equal(selected.filter((a) => a.ai_related === false).length, 6);
  });

  test('0 AI + 15 general -> 10 returned, all ai_related:false', () => {
    const generalArticles = Array.from({ length: 15 }, (_, i) =>
      makeArticle({ title: `Routine update item ${i}`, news_timestamp: dated(i) })
    );

    const selected = selectArticles(generalArticles, 10);

    assert.equal(selected.length, 10);
    assert.ok(selected.every((a) => a.ai_related === false));
  });

  test('3 items total -> exactly 3 returned, no padding', () => {
    const articles = Array.from({ length: 3 }, (_, i) =>
      makeArticle({ title: `Routine update item ${i}`, news_timestamp: dated(i) })
    );

    const selected = selectArticles(articles, 10);

    assert.equal(selected.length, 3);
  });

  test('16 AI + some general -> 10 returned, all ai_related:true, zero general items present', () => {
    const aiArticles = Array.from({ length: 16 }, (_, i) =>
      makeArticle({ title: `AI news item ${i}`, news_timestamp: dated(i) })
    );
    const generalArticles = Array.from({ length: 5 }, (_, i) =>
      makeArticle({ title: `Routine update item ${i}`, news_timestamp: dated(i + 30) })
    );

    const selected = selectArticles([...aiArticles, ...generalArticles], 10);

    assert.equal(selected.length, 10);
    assert.ok(selected.every((a) => a.ai_related === true));
    assert.ok(selected.every((a) => a.title.startsWith('AI news item')));
  });

  test('output is sorted news_timestamp DESC with backfilled items interleaved, not appended at the end', () => {
    const ai = [
      makeArticle({ title: 'AI story A', news_timestamp: '2026-07-10T00:00:00.000Z' }),
      makeArticle({ title: 'AI story B', news_timestamp: '2026-07-08T00:00:00.000Z' }),
      makeArticle({ title: 'AI story C', news_timestamp: '2026-07-06T00:00:00.000Z' }),
    ];
    const general = [
      makeArticle({ title: 'General story D', news_timestamp: '2026-07-09T00:00:00.000Z' }),
      makeArticle({ title: 'General story E', news_timestamp: '2026-07-07T00:00:00.000Z' }),
    ];

    const selected = selectArticles([...ai, ...general], 5);

    assert.deepEqual(
      selected.map((a) => a.title),
      ['AI story A', 'General story D', 'AI story B', 'General story E', 'AI story C']
    );
    assert.deepEqual(
      selected.map((a) => a.ai_related),
      [true, false, true, false, true]
    );
  });
});

// ---------------------------------------------------------------------------
// enrichArticles
// ---------------------------------------------------------------------------

describe('enrichArticles', () => {
  test('calls post EXACTLY ONCE for 10 articles (not once per article)', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(10);
      let calls = 0;
      const post = async () => {
        calls += 1;
        const items = articles.map((_, index) => ({
          index,
          summary: `Summary ${index}`,
          severity: 'High',
          category: 'Vulnerability',
          cve_reference: null,
        }));
        return makeOpenAiResponse(items);
      };

      const result = await enrichArticles(articles, post);

      assert.equal(calls, 1);
      assert.equal(result.length, 10);
      result.forEach((r, i) => assert.equal(r.summary, `Summary ${i}`));
    });
  });

  test('index join maps summaries to the correct article regardless of response order; ignores a GPT-rewritten title', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(5);
      // Shuffled order on purpose, plus a malicious `title` field that must
      // be ignored entirely (enrichArticles never carries a title through).
      const items = [
        { index: 3, summary: 'S3', severity: 'Low', category: 'Research', cve_reference: null, title: 'HACKED TITLE 3' },
        { index: 0, summary: 'S0', severity: 'Critical', category: 'Vulnerability', cve_reference: null, title: 'HACKED TITLE 0' },
        { index: 4, summary: 'S4', severity: 'Medium', category: 'Threat', cve_reference: null },
        { index: 1, summary: 'S1', severity: 'High', category: 'Incident', cve_reference: null },
        { index: 2, summary: 'S2', severity: 'Low', category: 'Research', cve_reference: null },
      ];
      const post = async () => makeOpenAiResponse(items);

      const result = await enrichArticles(articles, post);

      assert.equal(result[0].summary, 'S0');
      assert.equal(result[1].summary, 'S1');
      assert.equal(result[2].summary, 'S2');
      assert.equal(result[3].summary, 'S3');
      assert.equal(result[4].summary, 'S4');
      result.forEach((r) => assert.equal(r.title, undefined));
    });
  });

  test('discards out-of-range, non-integer, and duplicate index entries (duplicates: first wins)', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(5);
      const items = [
        { index: 0, summary: 'A0', severity: 'High', category: 'Threat', cve_reference: null },
        { index: 10, summary: 'OUT_OF_RANGE', severity: 'High', category: 'Threat', cve_reference: null },
        { index: 1.5, summary: 'NON_INTEGER', severity: 'High', category: 'Threat', cve_reference: null },
        { index: null, summary: 'NULL_INDEX', severity: 'High', category: 'Threat', cve_reference: null },
        { index: 2, summary: 'C2-first', severity: 'High', category: 'Threat', cve_reference: null },
        { index: 2, summary: 'C2-second', severity: 'Low', category: 'Research', cve_reference: null },
      ];
      const post = async () => makeOpenAiResponse(items);

      const result = await enrichArticles(articles, post);

      assert.equal(result[0].summary, 'A0');
      assert.equal(result[0].enriched, true);
      assert.equal(result[2].summary, 'C2-first');
      assert.equal(result[2].enriched, true);
      assert.equal(result[1].enriched, false); // never targeted
      assert.equal(result[3].enriched, false); // never targeted
      assert.equal(result[4].enriched, false); // never targeted
      assert.ok(!result.some((r) => r.summary === 'C2-second'));
      assert.ok(!result.some((r) => r.summary === 'OUT_OF_RANGE' || r.summary === 'NON_INTEGER' || r.summary === 'NULL_INDEX'));
    });
  });

  test('clamps invalid severity/category strings to Unknown/News (case-insensitively matches valid ones)', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(2);
      const items = [
        { index: 0, summary: 'ok0', severity: 'SUPERBAD', category: 'Nonsense', cve_reference: null },
        { index: 1, summary: 'ok1', severity: 'critical', category: 'vulnerability', cve_reference: null },
      ];
      const post = async () => makeOpenAiResponse(items);

      const result = await enrichArticles(articles, post);

      assert.equal(result[0].severity, 'Unknown');
      assert.equal(result[0].category, 'News');
      assert.equal(result[1].severity, 'Critical');
      assert.equal(result[1].category, 'Vulnerability');
    });
  });

  test('degrades all articles without throwing when post rejects', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(3);
      const post = async () => {
        throw new Error('network down');
      };

      const result = await enrichArticles(articles, post);

      assert.equal(result.length, 3);
      result.forEach((r, i) => {
        assert.equal(r.enriched, false);
        assert.equal(r.severity, 'Unknown');
        assert.equal(r.category, 'News');
        assert.equal(r.summary, articles[i].description);
      });
    });
  });

  test('degrades all articles without throwing when post resolves with unparseable content', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(2);
      const post = async () => ({ data: { choices: [{ message: { content: 'not-json{{{' } }] } });

      const result = await enrichArticles(articles, post);

      assert.equal(result.length, 2);
      result.forEach((r) => assert.equal(r.enriched, false));
    });
  });

  test('when response contains only 7 of 10 entries, 7 are enriched:true and 3 are enriched:false', async () => {
    await withApiKey('test-key', async () => {
      const articles = buildArticles(10);
      const items = Array.from({ length: 7 }, (_, i) => ({
        index: i,
        summary: `S${i}`,
        severity: 'High',
        category: 'Threat',
        cve_reference: null,
      }));
      const post = async () => makeOpenAiResponse(items);

      const result = await enrichArticles(articles, post);

      assert.equal(result.filter((r) => r.enriched === true).length, 7);
      assert.equal(result.filter((r) => r.enriched === false).length, 3);
    });
  });

  test('never calls post when OPENAI_API_KEY is absent', async () => {
    await withApiKey(undefined, async () => {
      const articles = buildArticles(4);
      let called = false;
      const post = async () => {
        called = true;
        throw new Error('post should never be called without an API key');
      };

      const result = await enrichArticles(articles, post);

      assert.equal(called, false);
      assert.equal(result.length, 4);
      result.forEach((r) => assert.equal(r.enriched, false));
    });
  });

  test('request body uses max_completion_tokens (never max_tokens), the configured model, json_object format, and temperature 0.2', async () => {
    await withApiKey('test-key', async () => {
      const originalModel = process.env.OPENAI_MODEL;
      try {
        process.env.OPENAI_MODEL = 'gpt-5.4-test-model';

        const articles = buildArticles(2);
        let recordedBody;
        const post = async (url, body) => {
          recordedBody = body;
          return makeOpenAiResponse([]);
        };

        await enrichArticles(articles, post);

        assert.ok(recordedBody, 'post should have been called with a body');
        assert.equal(recordedBody.max_completion_tokens, 1500);
        assert.equal('max_tokens' in recordedBody, false);
        assert.equal(recordedBody.model, 'gpt-5.4-test-model');
        assert.equal(recordedBody.response_format.type, 'json_object');
        assert.equal(recordedBody.temperature, 0.2);
      } finally {
        if (originalModel === undefined) {
          delete process.env.OPENAI_MODEL;
        } else {
          process.env.OPENAI_MODEL = originalModel;
        }
      }
    });
  });

  test('falls back to model "gpt-5.4" when OPENAI_MODEL is unset', async () => {
    await withApiKey('test-key', async () => {
      const originalModel = process.env.OPENAI_MODEL;
      try {
        delete process.env.OPENAI_MODEL;

        const articles = buildArticles(2);
        let recordedBody;
        const post = async (url, body) => {
          recordedBody = body;
          return makeOpenAiResponse([]);
        };

        await enrichArticles(articles, post);

        assert.equal(recordedBody.model, 'gpt-5.4');
      } finally {
        if (originalModel === undefined) {
          delete process.env.OPENAI_MODEL;
        } else {
          process.env.OPENAI_MODEL = originalModel;
        }
      }
    });
  });

  test('extracts a CVE reference via the local regex in degraded mode', async () => {
    await withApiKey(undefined, async () => {
      const articles = [
        makeArticle({
          title: 'Patch Tuesday roundup',
          description: 'This release fixes CVE-2026-16232, a remote code execution flaw.',
        }),
      ];
      const post = async () => {
        throw new Error('should not be called');
      };

      const result = await enrichArticles(articles, post);

      assert.equal(result[0].cve_reference, 'CVE-2026-16232');
      assert.equal(result[0].enriched, false);
    });
  });
});

// ---------------------------------------------------------------------------
// fetchNewsFromRss
// ---------------------------------------------------------------------------

describe('fetchNewsFromRss', () => {
  test('stamps an identical batch timestamp, differing per-item news_timestamp, sorted DESC', async () => {
    await withApiKey(undefined, async () => {
      const feedA = {
        title: 'Feed A',
        items: [
          { title: 'Story A1', link: 'https://a.test/1', isoDate: '2026-07-01T00:00:00.000Z', 'dc:creator': 'Author A', contentSnippet: 'Desc A1' },
        ],
      };
      const feedB = {
        title: 'Feed B',
        items: [
          { title: 'Story B1', link: 'https://b.test/1', isoDate: '2026-07-03T00:00:00.000Z', 'dc:creator': 'Author B', contentSnippet: 'Desc B1' },
        ],
      };
      const feedC = {
        title: 'Feed C',
        items: [
          { title: 'Story C1', link: 'https://c.test/1', isoDate: '2026-07-02T00:00:00.000Z', 'dc:creator': 'Author C', contentSnippet: 'Desc C1' },
        ],
      };
      const parser = {
        async parseURL(url) {
          if (url === 'urlA') return feedA;
          if (url === 'urlB') return feedB;
          if (url === 'urlC') return feedC;
          throw new Error(`unexpected url ${url}`);
        },
      };
      const post = async () => {
        throw new Error('should not be called: no API key configured');
      };

      const result = await fetchNewsFromRss({ parser, post, feedUrls: ['urlA', 'urlB', 'urlC'] });

      assert.equal(result.length, 3);

      const timestamps = new Set(result.map((r) => r.timestamp));
      assert.equal(timestamps.size, 1, 'every item should share one batch ingest timestamp');

      assert.deepEqual(
        result.map((r) => r.news_timestamp),
        ['2026-07-03T00:00:00.000Z', '2026-07-02T00:00:00.000Z', '2026-07-01T00:00:00.000Z']
      );
      assert.deepEqual(result.map((r) => r.title), ['Story B1', 'Story C1', 'Story A1']);
    });
  });

  test('ignores a GPT-rewritten title end-to-end: the source title wins', async () => {
    await withApiKey('test-key', async () => {
      const feed = {
        title: 'Feed X',
        items: [
          { title: 'Original Source Title', link: 'https://x.test/1', isoDate: '2026-07-01T00:00:00.000Z', 'dc:creator': 'Author X', contentSnippet: 'Some description text.' },
        ],
      };
      const parser = { async parseURL() { return feed; } };
      const post = async () =>
        makeOpenAiResponse([
          { index: 0, summary: 'AI summary', severity: 'Low', category: 'News', cve_reference: null, title: 'HACKED TITLE' },
        ]);

      const result = await fetchNewsFromRss({ parser, post, feedUrls: ['urlX'] });

      assert.equal(result[0].title, 'Original Source Title');
      assert.equal(result[0].summary, 'AI summary');
    });
  });
});
