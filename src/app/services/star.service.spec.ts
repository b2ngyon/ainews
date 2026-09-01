import { TestBed } from '@angular/core/testing';
import { StarService, starKey } from './star.service';
import { NewsItem } from '../model/interface';

const item = (overrides: Partial<NewsItem> = {}): NewsItem => ({
  title: 'Critical Zero-Day Discovered',
  summary: 'A critical zero-day vulnerability.',
  severity: 'Critical',
  severity_index: 4,
  category: 'Vulnerability',
  timestamp: '2026-07-28T10:00:00Z',
  news_timestamp: '2026-07-28T09:00:00Z',
  reference_link: 'https://example.com/zero-day',
  cve_reference: 'CVE-2026-99999',
  source_author: 'Test Source',
  ...overrides,
});

describe('starKey', () => {
  // Mirrors the canonicalizeLink() cases in api/rss.js so the frontend star
  // identity and the backend dedupe cannot silently diverge.
  it('lowercases the host and keeps the path', () => {
    expect(starKey(item({ reference_link: 'https://Example.COM/Path' }))).toBe('url:example.com/Path');
  });

  it('drops the query string and fragment', () => {
    expect(starKey(item({ reference_link: 'https://example.com/a?utm_source=x#frag' }))).toBe('url:example.com/a');
  });

  it('collapses http and https to the same key', () => {
    expect(starKey(item({ reference_link: 'http://example.com/a' })))
      .toBe(starKey(item({ reference_link: 'https://example.com/a' })));
  });

  it('strips a single trailing slash', () => {
    expect(starKey(item({ reference_link: 'https://example.com/a/' }))).toBe('url:example.com/a');
  });

  it('does not strip www', () => {
    expect(starKey(item({ reference_link: 'https://www.example.com/a' }))).toBe('url:www.example.com/a');
  });

  it('falls back to the raw string when the URL will not parse', () => {
    expect(starKey(item({ reference_link: 'not a url' }))).toBe('url:not a url');
  });

  it('falls back to the title when there is no link', () => {
    expect(starKey(item({ reference_link: '', title: 'Some Title!' }))).toBe('title:some title');
  });

  it('returns null when there is no usable identity', () => {
    expect(starKey(item({ reference_link: '', title: '' }))).toBeNull();
  });
});

describe('StarService', () => {
  let service: StarService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(StarService);
  });

  afterEach(() => localStorage.clear());

  it('stars and unstars an item', () => {
    expect(service.isStarred(item())).toBeFalse();
    expect(service.toggle(item())).toBeTrue();
    expect(service.isStarred(item())).toBeTrue();
    expect(service.toggle(item())).toBeFalse();
    expect(service.isStarred(item())).toBeFalse();
  });

  it('persists the full item, not a reference', () => {
    service.toggle(item());
    const stored = JSON.parse(localStorage.getItem('ainews.starred.v1') as string);
    expect(stored.version).toBe(1);
    expect(stored.items[0].summary).toBe('A critical zero-day vulnerability.');
    expect(stored.items[0].severity).toBe('Critical');
    expect(stored.items[0].starred_at).toBeTruthy();
  });

  it('restores stars in a fresh service instance', () => {
    service.toggle(item());
    const revived = new StarService();
    expect(revived.isStarred(item())).toBeTrue();
  });

  it('treats a structurally-new object with the same link as the same item', () => {
    service.toggle(item());
    expect(service.isStarred({ ...item(), title: 'Headline was rewritten upstream' })).toBeTrue();
  });

  it('cannot star an item with no usable identity', () => {
    expect(service.toggle(item({ reference_link: '', title: '' }))).toBeFalse();
  });

  it('recovers from a corrupt blob without throwing', () => {
    localStorage.setItem('ainews.starred.v1', '{not json');
    const revived = new StarService();
    expect(revived.isStarred(item())).toBeFalse();
  });

  it('ignores a stored value whose items are not an array', () => {
    localStorage.setItem('ainews.starred.v1', JSON.stringify({ version: 1, items: 'nope' }));
    expect(new StarService().isStarred(item())).toBeFalse();
  });

  it('fills missing fields when reading a blob written by an older shape', () => {
    localStorage.setItem('ainews.starred.v1', JSON.stringify({
      version: 1,
      items: [{ title: 'Old', reference_link: 'https://example.com/old', starred_at: '2026-01-01T00:00:00Z' }],
    }));
    const revived = new StarService();
    let items: any[] = [];
    revived.starred$.subscribe(i => (items = i));
    expect(items.length).toBe(1);
    expect(items[0].severity).toBe('Unknown');
    expect(items[0].severity_index).toBe(0);
  });

  it('surfaces an error instead of throwing when the write fails', () => {
    spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
    let error: string | null = null;
    service.error$.subscribe(e => (error = e));
    expect(() => service.toggle(item())).not.toThrow();
    expect(error).toBeTruthy();
  });

  it('refreshes stored fields from the feed but keeps starred_at', () => {
    service.toggle(item());
    let before: any[] = [];
    service.starred$.subscribe(i => (before = i));
    const originalStarredAt = before[0].starred_at;

    service.refreshFromFeed([item({ summary: 'Updated summary from a later enrichment' })]);

    let after: any[] = [];
    service.starred$.subscribe(i => (after = i));
    expect(after[0].summary).toBe('Updated summary from a later enrichment');
    expect(after[0].starred_at).toBe(originalStarredAt);
  });
});
