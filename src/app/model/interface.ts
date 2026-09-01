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
