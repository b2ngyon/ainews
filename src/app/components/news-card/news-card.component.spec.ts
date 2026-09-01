import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewsCardComponent } from './news-card.component';
import { NewsItem } from '../../model/interface';

describe('NewsCardComponent', () => {
  let fixture: ComponentFixture<NewsCardComponent>;
  let component: NewsCardComponent;

  const fullNewsItem: NewsItem = {
    title: 'Critical Zero-Day Discovered',
    summary: 'A critical zero-day vulnerability has been discovered in a widely used library.',
    severity: 'Critical',
    severity_index: 4,
    category: 'Vulnerability',
    timestamp: '2026-07-28T10:00:00Z',
    news_timestamp: '2026-07-28T09:00:00Z',
    reference_link: 'https://example.com/zero-day',
    cve_reference: 'CVE-2026-99999',
    source_author: 'Test Source',
  };

  const render = (item: NewsItem, starred = false) => {
    component.item = item;
    component.starred = starred;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [NewsCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(NewsCardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => localStorage.clear());

  it('renders every field', () => {
    const el = render(fullNewsItem);
    expect(el.querySelector('h3')?.textContent).toContain(fullNewsItem.title);
    expect(el.querySelector('.summary')?.textContent).toContain(fullNewsItem.summary);
    expect(el.querySelector('.category')?.textContent).toContain(fullNewsItem.category);
    expect(el.querySelector('.source')?.textContent).toContain(fullNewsItem.source_author);
    expect(el.querySelector('.cve-reference')?.textContent).toContain(fullNewsItem.cve_reference as string);
  });

  it('renders the formatted news_timestamp, not the raw ISO string or the ingest timestamp', () => {
    const el = render(fullNewsItem);
    const time = el.querySelector('.timestamp') as HTMLElement;
    expect(time.getAttribute('datetime')).toBe(fullNewsItem.news_timestamp);
    expect(time.textContent).not.toContain(fullNewsItem.news_timestamp);
    expect(time.textContent).not.toContain(fullNewsItem.timestamp);
    expect(time.textContent).toContain('2026');
  });

  it('maps severity to its badge class', () => {
    const el = render(fullNewsItem);
    expect(el.querySelector('.severity-badge')?.classList.contains('severity-critical')).toBeTrue();
  });

  it('falls back to the unknown badge for a degraded severity', () => {
    const el = render({ ...fullNewsItem, severity: 'Unknown' });
    expect(el.querySelector('.severity-badge')?.classList.contains('severity-unknown')).toBeTrue();
  });

  it('does not throw when severity is missing', () => {
    expect(() => render({ ...fullNewsItem, severity: undefined as any })).not.toThrow();
  });

  it('does not render a cve-reference element when cve_reference is null', () => {
    const el = render({ ...fullNewsItem, cve_reference: null });
    expect(el.querySelector('.cve-reference')).toBeFalsy();
    // The reference link has its own class, so it must not be caught by that query.
    expect(el.querySelector('.reference-link')).toBeTruthy();
  });

  it('opens the reference link safely in a new tab', () => {
    const el = render(fullNewsItem);
    const link = el.querySelector('.reference-link a') as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('example.com');
    expect(link.textContent).not.toContain('https://');
  });

  it('exposes the star as a real button with aria-pressed', () => {
    const el = render(fullNewsItem, false);
    const button = el.querySelector('.star-button') as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toContain(fullNewsItem.title);
  });

  it('reflects the starred state', () => {
    const el = render(fullNewsItem, true);
    const button = el.querySelector('.star-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('Unstar');
  });

  it('toggles the star on click', () => {
    const el = render(fullNewsItem);
    const spy = spyOn(component, 'toggleStar').and.callThrough();
    (el.querySelector('.star-button') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
