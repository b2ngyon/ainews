import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { NewsItem, StarredNewsItem, StarredStore } from '../model/interface';

const STORAGE_KEY = 'ainews.starred.v1';
const STORE_VERSION = 1;
const MAX_ITEMS = 500;

/**
 * Derives a stable identity for a news item.
 *
 * MUST match the semantics of `canonicalizeLink()` in api/rss.js (~line 144),
 * which the backend uses to dedupe articles across feeds. If the two diverge,
 * the backend and the star list disagree about what counts as "the same story".
 * Specifically: host is lowercased, path case is preserved, a single trailing
 * slash is stripped, and the query string and fragment are dropped entirely
 * (which covers utm_* and friends for free). `www.` is NOT stripped and the
 * scheme is ignored, so http and https collapse to one key.
 *
 * Returns null when the item has no usable identity, in which case it cannot
 * be starred (rather than being given a junk key).
 */
export function starKey(item: Pick<NewsItem, 'reference_link' | 'title'>): string | null {
  const link = (item.reference_link || '').trim();
  if (link) {
    try {
      const url = new URL(link);
      let pathname = url.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      return `url:${url.hostname.toLowerCase()}${pathname}`;
    } catch {
      return `url:${link.toLowerCase()}`;
    }
  }

  // Defensive only: api/rss.js drops items with no link before they reach us.
  const title = (item.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  return title ? `title:${title}` : null;
}

@Injectable({ providedIn: 'root' })
export class StarService {
  private readonly itemsSubject = new BehaviorSubject<StarredNewsItem[]>(this.read());

  /** All starred items, most recently starred first. */
  readonly starred$: Observable<StarredNewsItem[]> = this.itemsSubject.asObservable();

  /** The set of starred keys, for cheap per-card lookups. */
  readonly starredKeys$: Observable<Set<string>> = this.starred$.pipe(
    map(items => new Set(items.map(i => i.star_key)))
  );

  readonly count$: Observable<number> = this.starred$.pipe(map(items => items.length));

  /** Surfaced when a write fails (quota, disabled storage) so the UI can say so. */
  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  isStarred(item: NewsItem): boolean {
    const key = starKey(item);
    return key !== null && this.itemsSubject.value.some(i => i.star_key === key);
  }

  /** Toggles an item. Returns the new starred state (false when it has no usable key). */
  toggle(item: NewsItem): boolean {
    const key = starKey(item);
    if (key === null) return false;

    // Read-modify-write from storage rather than trusting the in-memory copy,
    // so a second tab's writes are not clobbered wholesale.
    const current = this.read();
    const existing = current.findIndex(i => i.star_key === key);

    let next: StarredNewsItem[];
    let nowStarred: boolean;

    if (existing >= 0) {
      next = current.filter((_, idx) => idx !== existing);
      nowStarred = false;
    } else {
      const entry: StarredNewsItem = { ...item, star_key: key, starred_at: new Date().toISOString() };
      next = [entry, ...current].slice(0, MAX_ITEMS);
      nowStarred = true;
    }

    this.write(next);
    return nowStarred;
  }

  /**
   * Refreshes the stored snapshot of any starred item that appears in the live
   * feed, so summary/severity do not go stale, while preserving starred_at.
   */
  refreshFromFeed(feed: NewsItem[]): void {
    if (!feed.length) return;
    const byKey = new Map<string, NewsItem>();
    for (const item of feed) {
      const key = starKey(item);
      if (key) byKey.set(key, item);
    }

    const current = this.read();
    let changed = false;
    const next = current.map(stored => {
      const fresh = byKey.get(stored.star_key);
      if (!fresh) return stored;
      changed = true;
      return { ...fresh, star_key: stored.star_key, starred_at: stored.starred_at };
    });

    if (changed) this.write(next);
  }

  private write(items: StarredNewsItem[]): void {
    const store: StarredStore = { version: STORE_VERSION, items };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      this.errorSubject.next(null);
    } catch {
      // Quota exceeded, or storage disabled (Safari private mode). Keep the
      // in-memory state consistent and tell the user rather than throwing
      // out of a click handler.
      this.errorSubject.next('Could not save your starred news in this browser.');
    }
    this.itemsSubject.next(items);
  }

  private read(): StarredNewsItem[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return [];
    }
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as Partial<StarredStore>;
      const items = parsed?.items;
      if (!Array.isArray(items)) return [];
      return items
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => this.normalize(entry))
        .filter((entry): entry is StarredNewsItem => entry !== null)
        .sort((a, b) => (a.starred_at < b.starred_at ? 1 : -1));
    } catch {
      // Corrupt blob: start empty rather than white-screening. The next
      // successful write overwrites it.
      return [];
    }
  }

  /**
   * NewsItem has already gained fields twice this project, so a blob written by
   * an older build will be read by newer code. Fill gaps with safe defaults
   * instead of trusting the stored shape.
   */
  private normalize(entry: any): StarredNewsItem | null {
    const key = typeof entry.star_key === 'string' && entry.star_key
      ? entry.star_key
      : starKey({ reference_link: entry.reference_link ?? '', title: entry.title ?? '' });
    if (!key) return null;

    return {
      title: entry.title ?? '',
      summary: entry.summary ?? '',
      severity: entry.severity ?? 'Unknown',
      severity_index: typeof entry.severity_index === 'number' ? entry.severity_index : 0,
      category: entry.category ?? 'News',
      timestamp: entry.timestamp ?? '',
      news_timestamp: entry.news_timestamp ?? '',
      reference_link: entry.reference_link ?? '',
      cve_reference: entry.cve_reference ?? null,
      source_author: entry.source_author ?? '',
      starred_at: entry.starred_at ?? new Date(0).toISOString(),
      star_key: key,
    };
  }
}
