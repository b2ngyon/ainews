import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ALLOWED_LIMITS, DEFAULT_LIMIT, NewsLimit } from '../model/interface';

const STORAGE_KEY = 'ainews.count.v1';
const STORE_VERSION = 1;

interface CountStore {
  version: 1;
  count: NewsLimit;
}

/**
 * Persists how many news items the reader wants, per browser.
 *
 * Mirrors StarService's storage contract deliberately: a versioned envelope,
 * a read that survives corrupt JSON, and try/catch on BOTH sides - getItem
 * throws too, not just setItem, in Safari private mode and wherever storage
 * is disabled by policy.
 */
@Injectable({ providedIn: 'root' })
export class CountService {
  private readonly countSubject = new BehaviorSubject<NewsLimit>(this.read());

  readonly count$: Observable<NewsLimit> = this.countSubject.asObservable();

  get count(): NewsLimit {
    return this.countSubject.value;
  }

  readonly options: readonly NewsLimit[] = ALLOWED_LIMITS;

  /** Ignores a value outside the allowed set rather than storing it. */
  set(count: number): void {
    const next = this.coerce(count);
    if (next === this.countSubject.value) return;

    const store: CountStore = { version: STORE_VERSION, count: next };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Quota or disabled storage. The choice still applies for this session;
      // it just will not survive a reload. Not worth interrupting the user.
    }
    this.countSubject.next(next);
  }

  /**
   * A stored value must be re-validated on every read, not trusted. A build
   * that once offered 100 would otherwise leave a 100 in storage that outlives
   * it, and that value would go straight onto the request URL.
   */
  private coerce(value: unknown): NewsLimit {
    return (ALLOWED_LIMITS as readonly number[]).includes(value as number)
      ? (value as NewsLimit)
      : DEFAULT_LIMIT;
  }

  private read(): NewsLimit {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return DEFAULT_LIMIT;
    }
    if (!raw) return DEFAULT_LIMIT;

    try {
      const parsed = JSON.parse(raw) as Partial<CountStore>;
      return this.coerce(parsed?.count);
    } catch {
      return DEFAULT_LIMIT;
    }
  }
}
