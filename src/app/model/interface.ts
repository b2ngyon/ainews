/**
 * The counts the news endpoint will serve.
 *
 * MUST match ALLOWED_LIMITS in api/rss.js. The backend clamps every request
 * with resolveLimit(), so a value that drifts out of this list is not a
 * security problem - it just silently gives the user a different count than
 * the one the UI says is selected. count.service.spec.ts asserts the two
 * lists agree, in the same spirit as the canonicalizeLink comment in
 * star.service.ts.
 */
export const ALLOWED_LIMITS = [12, 25, 50] as const;
export const DEFAULT_LIMIT = 12;
export type NewsLimit = (typeof ALLOWED_LIMITS)[number];

export interface NewsItem {
  title: string;
  summary: string;
  severity: string;
  severity_index:number;
  category: string;
  timestamp: string;
  news_timestamp: string;
  reference_link:string;
  cve_reference: string | null;
  source_author: string;
  /** Set by the backend's AI keyword filter; general-news backfill is false. */
  ai_related?: boolean;
  /** False when OpenAI enrichment was unavailable and the item was degraded. */
  enriched?: boolean;
}

/**
 * A starred article is persisted as a full snapshot, not a reference. The feed
 * only ever returns ~10 recent items, so a starred article drops out of it
 * within days and the starred view must still be able to render it.
 */
export interface StarredNewsItem extends NewsItem {
  /** ISO timestamp of when the user starred it. */
  starred_at: string;
  /** Canonical identity, persisted so the key algorithm can change without orphaning stars. */
  star_key: string;
}

/** Versioned envelope written to localStorage. */
export interface StarredStore {
  version: 1;
  items: StarredNewsItem[];
}

export interface User {
  username: string;
  password: string;
}
