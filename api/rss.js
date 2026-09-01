import Parser from 'rss-parser';
import axios from 'axios';

export const FEED_URLS = [
  'https://thehackernews.com/feeds/posts/default',
  'https://www.bleepingcomputer.com/feed/',
  'https://krebsonsecurity.com/feed/',
];

/**
 * The counts the news endpoint will serve. 50 is a deliberate ceiling, not a
 * round number: measured live, the three feeds yield ~75 raw items with all
 * three healthy and ~60 when BleepingComputer is Cloudflare-blocked, which it
 * intermittently is. 50 is the largest count that survives that outage.
 */
export const ALLOWED_LIMITS = [12, 25, 50];
export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = ALLOWED_LIMITS[ALLOWED_LIMITS.length - 1];

/**
 * Snaps an arbitrary requested count onto ALLOWED_LIMITS. Anything unparseable
 * falls back to the default; anything in between snaps up to the next allowed
 * value; anything above the ceiling is capped. Restricting the set keeps the
 * per-limit cache from exploding and stops a public endpoint from being used
 * to run up an OpenAI bill one arbitrary integer at a time.
 */
export function resolveLimit(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return ALLOWED_LIMITS.find((allowed) => n <= allowed) ?? MAX_LIMIT;
}

export const AI_KEYWORDS = [
  'ai',
  'ai agent',
  'ai agents',
  'ai model',
  'ai models',
  'ai security',
  'artificial intelligence',
  'machine learning',
  'ml',
  'mlops',
  'llm',
  'llms',
  'large language model',
  'large language models',
  'genai',
  'generative ai',
  'chatbot',
  'agentic',
  'chatgpt',
  'openai',
  'gpt',
  'claude',
  'anthropic',
  'gemini',
  'copilot',
  'hugging face',
  'nvidia',
  'deepfake',
  'neural network',
  'deep learning',
  'prompt injection',
  'model poisoning',
  'training data',
  'mcp',
  'model context protocol',
  'jailbreak',
  'slopsquatting',
];

const defaultParser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'AINews/1.0' },
});

const SPONSORED_REGEX = /^sponsored by/i;
const EMAIL_NAME_REGEX = /^[^\s@]+@[^\s@]+\s*\(([^)]+)\)\s*$/;
const CVE_REGEX = /CVE-\d{4}-\d{4,7}/i;
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const CATEGORIES = ['Vulnerability', 'Threat', 'Incident', 'Research'];

/**
 * Normalizes a single raw rss-parser item into our internal article shape.
 * Returns null when the item should be dropped (missing link/title,
 * unparseable date, or a sponsored placement).
 *
 * Note: rss-parser always maps the plain RSS <description> tag onto
 * `content`/`contentSnippet` (entity-decoded, HTML-stripped), and maps
 * <content:encoded> onto its own separate `content:encoded` key. We
 * intentionally never read that key here.
 */
export function normalizeArticle(rawItem, feedTitle) {
  if (!rawItem) return null;

  const link = rawItem.link;
  const title = rawItem.title;
  if (!link || !title) return null;

  const isoDate = rawItem.pubDate;
  if (!isoDate) return null;
  const parsedDate = new Date(isoDate);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const rawCreator = (rawItem['dc:creator'] || rawItem.author || '').trim();
  if (rawCreator && SPONSORED_REGEX.test(rawCreator)) return null;

  let sourceAuthor = null;
  if (rawItem['dc:creator']) {
    sourceAuthor = rawItem['dc:creator'].trim();
  } else if (rawItem.author) {
    const match = rawItem.author.match(EMAIL_NAME_REGEX);
    sourceAuthor = match ? match[1].trim() : rawItem.author.trim();
  }
  if (!sourceAuthor) sourceAuthor = feedTitle || 'Unknown';

  const description = rawItem.contentSnippet || rawItem.content || rawItem.description || '';

  return {
    title: title.trim(),
    description,
    news_timestamp: parsedDate.toISOString(),
    reference_link: link,
    source_author: sourceAuthor,
  };
}

/**
 * Fetches and normalizes every feed. Never rejects unless every single feed
 * failed - individual feed failures are logged and skipped so the rest of
 * the pipeline keeps working.
 */
export async function fetchFeeds(feedUrls = FEED_URLS, parser = defaultParser) {
  const settled = await Promise.allSettled(
    feedUrls.map(async (url) => {
      const feed = await parser.parseURL(url);
      const feedTitle = feed?.title || url;
      const articles = (feed?.items || [])
        .map((item) => normalizeArticle(item, feedTitle))
        .filter((article) => article !== null);
      return articles;
    })
  );

  const articles = [];
  const failures = [];

  settled.forEach((result, i) => {
    const url = feedUrls[i];
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    } else {
      const message = result.reason?.message || String(result.reason);
      console.warn(`[rss] Failed to fetch feed ${url}: ${message}`);
      failures.push({ url, message });
    }
  });

  if (failures.length === feedUrls.length) {
    throw new Error('All RSS feeds failed to fetch');
  }

  return { articles, failures };
}

function canonicalizeLink(link) {
  if (!link) return '';
  try {
    const url = new URL(link);
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch {
    return link.trim().toLowerCase();
  }
}

function canonicalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function keepEarliest(existing, candidate) {
  if (!existing) return candidate;
  const existingTime = new Date(existing.news_timestamp).getTime();
  const candidateTime = new Date(candidate.news_timestamp).getTime();
  return candidateTime < existingTime ? candidate : existing;
}

/**
 * De-duplicates articles: first by canonicalized link (host lowercased,
 * query string/hash stripped, trailing slash removed), then by normalized
 * title. In both passes the earliest-dated copy is kept.
 */
export function dedupeArticles(articles) {
  const byLink = new Map();
  for (const article of articles) {
    const key = canonicalizeLink(article.reference_link);
    byLink.set(key, keepEarliest(byLink.get(key), article));
  }

  const byTitle = new Map();
  for (const article of byLink.values()) {
    const key = canonicalizeTitle(article.title);
    byTitle.set(key, keepEarliest(byTitle.get(key), article));
  }

  return Array.from(byTitle.values());
}

function toHaystack(title, description) {
  const raw = `${title || ''} ${description || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${raw} `;
}

/**
 * Splits articles into AI-related vs general, using strict whole-word
 * matching so a bare "ai" keyword never matches inside "said", "again",
 * "certain" or "Mail".
 */
export function partitionByAi(articles, keywords = AI_KEYWORDS) {
  const ai = [];
  const general = [];

  for (const article of articles) {
    const haystack = toHaystack(article.title, article.description);
    const isAi = keywords.some((keyword) => haystack.includes(` ${keyword} `));
    (isAi ? ai : general).push(article);
  }

  return { ai, general };
}

function sortByNewsTimestampDesc(a, b) {
  return new Date(b.news_timestamp) - new Date(a.news_timestamp);
}

/**
 * Selects up to `count` articles: AI-related articles first (most recent
 * first), backfilled with general articles when there aren't enough AI
 * items. Never pads - if the total pool is smaller than `count`, whatever
 * exists is returned. The final list is re-sorted by date so backfilled
 * items interleave rather than being appended at the end.
 */
export function selectArticles(articles, count = 12) {
  const { ai, general } = partitionByAi(articles);
  const aiSorted = [...ai].sort(sortByNewsTimestampDesc);
  const generalSorted = [...general].sort(sortByNewsTimestampDesc);

  let selected = aiSorted.slice(0, count).map((article) => ({ ...article, ai_related: true }));

  if (selected.length < count) {
    const remaining = count - selected.length;
    const backfill = generalSorted.slice(0, remaining).map((article) => ({ ...article, ai_related: false }));
    selected = selected.concat(backfill);
  }

  selected.sort(sortByNewsTimestampDesc);
  return selected;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) : str;
}

function truncateAtWordBoundary(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  const sliced = str.slice(0, max);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim();
}

function localCveReference(title, description) {
  const text = `${title || ''} ${description || ''}`;
  const match = text.match(CVE_REGEX);
  return match ? match[0].toUpperCase() : null;
}

function degradedEnrichment(article) {
  return {
    summary: truncateAtWordBoundary(article.description || '', 200),
    severity: 'Unknown',
    category: 'News',
    cve_reference: localCveReference(article.title, article.description),
    enriched: false,
  };
}

function clampSeverity(value) {
  if (typeof value !== 'string') return 'Unknown';
  const match = SEVERITIES.find((severity) => severity.toLowerCase() === value.toLowerCase());
  return match || 'Unknown';
}

function clampSeverityIndex(value) {
  if (typeof value !== 'string') return 1;
  'Critical', 'High', 'Medium', 'Low'
  switch(value.toLowerCase()){
    case 'critical':
      return 5;
    case 'high':
      return 4;
    case 'medium':
      return 3;
    case 'low':
      return 2;
    default:
      return 1;
  }
}

function clampCategory(value) {
  if (typeof value !== 'string') return 'News';
  const match = CATEGORIES.find((category) => category.toLowerCase() === value.toLowerCase());
  return match || 'News';
}

/**
 * How many articles go into a single OpenAI call. The response is one JSON
 * object covering the whole chunk, and a response that hits the token ceiling
 * is truncated mid-JSON — which fails JSON.parse and degrades every article in
 * the chunk, not just the overflowing one. Chunking bounds that blast radius
 * and keeps each response comfortably inside its budget.
 */
export const ENRICH_CHUNK_SIZE = 20;

/** Measured at ~60 tokens of JSON per item; 90 leaves headroom for long titles. */
const TOKENS_PER_ITEM = 90;
const TOKEN_OVERHEAD = 200;

const ENRICH_SYSTEM_MESSAGE = [
  'You are a cybersecurity news editor.',
  'You will receive a JSON array of news items, each with an index, title, description and source.',
  'For each item, return: a summary (<=200 chars) that does NOT invent facts and does NOT alter the title;',
  'a severity, one of Critical, High, Medium, Low;',
  'a category, one of Vulnerability, Threat, Incident, Research;',
  'and a cve_reference in the form CVE-YYYY-NNNNN if one is clearly referenced by the item, else null.',
  'Return exactly one entry per input index, and never invent an index that was not provided.',
  'Respond with ONLY strict JSON matching this shape, no markdown, no commentary:',
  '{"items":[{"index":<int>,"summary":"<=200 chars","severity":"Critical|High|Medium|Low","category":"Vulnerability|Threat|Incident|Research","cve_reference":"CVE-YYYY-NNNNN or null"}]}',
].join(' ');

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Enriches one chunk. Indices in the request and response are chunk-local, so
 * a model that echoes a wrong index can never write into another chunk's slot.
 * Returns a sparse array aligned to `chunk`; a null entry means "leave this one
 * degraded". Never throws.
 */
async function enrichChunk(chunk, post, apiKey) {
  const payload = chunk.map((article, index) => ({
    index,
    title: article.title,
    description: truncate(article.description || '', 400),
    source: article.source_author,
  }));

  let response;
  try {
    response = await post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: process.env.OPENAI_MODEL || 'gpt-5.4',
        messages: [
          { role: 'system', content: ENRICH_SYSTEM_MESSAGE },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_completion_tokens: chunk.length * TOKENS_PER_ITEM + TOKEN_OVERHEAD,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );
  } catch (error) {
    console.warn(`[rss] OpenAI enrichment request failed: ${error?.message || error}`);
    return chunk.map(() => null);
  }

  let parsed;
  try {
    parsed = JSON.parse(response?.data?.choices?.[0]?.message?.content);
  } catch (error) {
    console.warn(`[rss] Failed to parse OpenAI enrichment response: ${error?.message || error}`);
    return chunk.map(() => null);
  }

  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const out = chunk.map(() => null);
  const seen = new Set();

  for (const item of items) {
    const index = item?.index;
    if (!Number.isInteger(index) || index < 0 || index >= chunk.length) continue;
    if (seen.has(index)) continue;
    seen.add(index);

    const cveReference =
      typeof item.cve_reference === 'string' && item.cve_reference.toLowerCase() !== 'null'
        ? item.cve_reference
        : null;

    out[index] = {
      summary: typeof item.summary === 'string' ? truncate(item.summary, 200) : null,
      severity: clampSeverity(item.severity),
      severity_index: clampSeverityIndex(item.severity),
      category: clampCategory(item.category),
      cve_reference: cveReference,
      enriched: true,
    };
  }

  return out;
}

/**
 * Enriches articles via batched OpenAI calls, ENRICH_CHUNK_SIZE articles per
 * call. Never throws - any failure (missing key, network error, bad JSON)
 * degrades the affected articles individually rather than aborting the batch,
 * and one failing chunk does not take the others down.
 */
export async function enrichArticles(articles, post = axios.post) {
  const degraded = articles.map(degradedEnrichment);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || articles.length === 0) {
    return degraded;
  }

  const chunks = chunkArray(articles, ENRICH_CHUNK_SIZE);
  const results = await Promise.all(chunks.map((chunk) => enrichChunk(chunk, post, apiKey)));

  const flat = results.flat();
  return flat.map((enrichment, index) => {
    if (!enrichment) return degraded[index];
    return {
      ...enrichment,
      summary: enrichment.summary ?? degraded[index].summary,
    };
  });
}

/**
 * Composes the full RSS -> AI-filtered -> enriched news pipeline. Stamps a
 * single ingest `timestamp` for the whole batch and returns NewsItem[]
 * sorted by `news_timestamp` descending.
 */
export async function fetchNewsFromRss(deps = {}) {
  const { parser = defaultParser, post = axios.post, feedUrls = FEED_URLS } = deps;

  const { articles: rawArticles } = await fetchFeeds(feedUrls, parser);
  const deduped = dedupeArticles(rawArticles);
  const selected = selectArticles(deduped, 12);
  const enrichments = await enrichArticles(selected, post);

  const timestamp = new Date().toISOString();

  const newsItems = selected.map((article, index) => {
    const enrichment = enrichments[index];
    return {
      title: article.title,
      summary: enrichment.summary,
      severity: enrichment.severity,
      severity_index: enrichment.severity_index,
      category: enrichment.category,
      timestamp,
      news_timestamp: article.news_timestamp,
      reference_link: article.reference_link,
      cve_reference: enrichment.cve_reference,
      source_author: article.source_author,
      ai_related: article.ai_related,
      enriched: enrichment.enriched,
    };
  });

  newsItems.sort(sortByNewsTimestampDesc);

  return newsItems;
}
