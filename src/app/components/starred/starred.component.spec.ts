import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StarredComponent } from './starred.component';
import { StarService } from '../../services/star.service';
import { NewsItem } from '../../model/interface';

describe('StarredComponent', () => {
  let fixture: ComponentFixture<StarredComponent>;
  let starService: StarService;

  const item = (overrides: Partial<NewsItem> = {}): NewsItem => ({
    title: 'Critical Zero-Day Discovered',
    summary: 'A critical zero-day vulnerability.',
    severity: 'Critical',
    severity_index: 4,
    category: 'Vulnerability',
    timestamp: '2026-07-28T10:00:00Z',
    news_timestamp: '2026-07-28T09:00:00Z',
    reference_link: 'https://example.com/zero-day',
    cve_reference: null,
    source_author: 'Test Source',
    ...overrides,
  });

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [StarredComponent] }).compileComponents();
    fixture = TestBed.createComponent(StarredComponent);
    starService = TestBed.inject(StarService);
  });

  afterEach(() => localStorage.clear());

  it('shows the empty state when nothing is starred', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.empty-state')).toBeTruthy();
    expect(el.querySelectorAll('.news-card').length).toBe(0);
  });

  it('renders starred items', () => {
    starService.toggle(item());
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.news-card').length).toBe(1);
    expect(el.querySelector('h3')?.textContent).toContain('Critical Zero-Day Discovered');
    expect(el.querySelector('.empty-state')).toBeFalsy();
  });

  it('renders an item that is no longer in the live feed', () => {
    // The whole point of storing a full snapshot: nothing here consults the API.
    starService.toggle(item({ title: 'Old story long gone from the feed' }));
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h3')?.textContent).toContain('Old story long gone from the feed');
    expect(el.querySelector('.summary')?.textContent).toContain('A critical zero-day vulnerability.');
  });

  it('shows the newest star first', () => {
    starService.toggle(item({ title: 'First', reference_link: 'https://example.com/1' }));
    starService.toggle(item({ title: 'Second', reference_link: 'https://example.com/2' }));
    fixture.detectChanges();

    const headings = (fixture.nativeElement as HTMLElement).querySelectorAll('h3');
    expect(headings[0].textContent).toContain('Second');
  });

  it('removes the card immediately when unstarred', () => {
    starService.toggle(item());
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.news-card').length).toBe(1);

    const button = (fixture.nativeElement as HTMLElement).querySelector('.star-button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.news-card').length).toBe(0);
    expect(el.querySelector('.empty-state')).toBeTruthy();
  });
});
