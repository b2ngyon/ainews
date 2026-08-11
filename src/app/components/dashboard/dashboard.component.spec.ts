import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';

import { DashboardComponent } from './dashboard.component';
import { OpenapiService } from '../../services/openapi.service';
import { MainService } from '../../services/main.service';
import { NewsItem } from '../../model/interface';

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;

  let loadingSubject: Subject<boolean>;
  let errorSubject: Subject<string | null>;
  let newsListSubject: Subject<NewsItem[]>;
  let currentNewsSubject: BehaviorSubject<NewsItem[]>;
  let getNewsSpy: jasmine.Spy;

  const fullNewsItem: NewsItem = {
    title: 'Critical Zero-Day Discovered',
    summary: 'A critical zero-day vulnerability has been discovered in a widely used library.',
    severity: 'Critical',
    category: 'Vulnerability',
    timestamp: '2026-07-28T10:00:00Z',
    cve_reference: 'CVE-2026-99999',
    source_author: 'Test Source',
  };

  beforeEach(async () => {
    loadingSubject = new Subject<boolean>();
    errorSubject = new Subject<string | null>();
    newsListSubject = new Subject<NewsItem[]>();
    currentNewsSubject = new BehaviorSubject<NewsItem[]>([]);

    const openapiServiceMock = {
      loading$: loadingSubject.asObservable(),
      error$: errorSubject.asObservable(),
      newsList$: newsListSubject.asObservable(),
      getNews: jasmine.createSpy('getNews'),
    };

    const mainServiceMock = {
      currentNews$: currentNewsSubject.asObservable(),
      setCurrentNews: jasmine.createSpy('setCurrentNews'),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: OpenapiService, useValue: openapiServiceMock },
        { provide: MainService, useValue: mainServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    getNewsSpy = TestBed.inject(OpenapiService).getNews as jasmine.Spy;
  });

  it('should call getNews on init', () => {
    fixture.detectChanges();
    expect(getNewsSpy).toHaveBeenCalled();
  });

  it('should show the loading state when loading is true', () => {
    fixture.detectChanges();
    loadingSubject.next(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.loading-state')).toBeTruthy();
  });

  it('should show the error state with the error message', () => {
    fixture.detectChanges();
    loadingSubject.next(false);
    errorSubject.next('Failed to fetch news');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const errorEl = compiled.querySelector('.error-state');
    expect(errorEl).toBeTruthy();
    expect(compiled.querySelector('.error-message')?.textContent).toContain('Failed to fetch news');
  });

  it('should show the empty state when there is no news, no loading and no error', () => {
    fixture.detectChanges();
    loadingSubject.next(false);
    errorSubject.next(null);
    currentNewsSubject.next([]);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.empty-state')).toBeTruthy();
  });

  it('should render a news card with all fields when a full NewsItem is present', () => {
    fixture.detectChanges();
    loadingSubject.next(false);
    currentNewsSubject.next([fullNewsItem]);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const cards = compiled.querySelectorAll('.news-card');
    expect(cards.length).toBe(1);

    const card = cards[0];
    expect(card.querySelector('h3')?.textContent).toContain(fullNewsItem.title);
    expect(card.querySelector('.summary')?.textContent).toContain(fullNewsItem.summary);
    expect(card.querySelector('.category')?.textContent).toContain(fullNewsItem.category);
    expect(card.querySelector('.timestamp')?.textContent).toContain(fullNewsItem.timestamp);
    expect(card.querySelector('.source')?.textContent).toContain(fullNewsItem.source_author);
    expect(card.querySelector('.cve-reference')?.textContent).toContain(fullNewsItem.cve_reference as string);

    const badge = card.querySelector('.severity-badge') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.classList.contains('severity-critical')).toBeTrue();
  });

  it('should not render a cve-reference element when cve_reference is null', () => {
    fixture.detectChanges();
    loadingSubject.next(false);
    currentNewsSubject.next([{ ...fullNewsItem, cve_reference: null }]);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.cve-reference')).toBeFalsy();
  });
});
