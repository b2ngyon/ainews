import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { OpenapiService } from './openapi.service';
import { MainService } from './main.service';
import { NewsItem } from '../model/interface';
import { environment } from '../../environments/environment';

describe('OpenapiService', () => {
  let service: OpenapiService;
  let mainService: MainService;
  let httpMock: HttpTestingController;

  const mockNewsArray: NewsItem[] = [
    {
      title: 'Test Title',
      summary: 'Test Summary',
      severity: 'Critical',
      category: 'Vulnerability',
      timestamp: '2026-07-28T10:00:00Z',
      cve_reference: 'CVE-2026-12345',
      source_author: 'Test Source',
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(OpenapiService);
    mainService = TestBed.inject(MainService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch news successfully and update all streams', () => {
    let newsListResult: NewsItem[] | undefined;
    let currentNewsResult: NewsItem[] | undefined;
    let errorResult: string | null | undefined;
    let loadingResult: boolean | undefined;

    service.newsList$.subscribe(v => (newsListResult = v));
    mainService.currentNews$.subscribe(v => (currentNewsResult = v));
    service.error$.subscribe(v => (errorResult = v));
    service.loading$.subscribe(v => (loadingResult = v));

    service.getNews();

    const req = httpMock.expectOne(`${environment.apiUrl}/news`);
    expect(req.request.method).toBe('GET');
    req.flush(mockNewsArray);

    expect(newsListResult).toEqual(mockNewsArray);
    expect(currentNewsResult).toEqual(mockNewsArray);
    expect(errorResult).toBeNull();
    expect(loadingResult).toBeFalse();
  });

  it('should handle errors and reset lists', () => {
    let newsListResult: NewsItem[] | undefined;
    let currentNewsResult: NewsItem[] | undefined;
    let errorResult: string | null | undefined;
    let loadingResult: boolean | undefined;

    service.newsList$.subscribe(v => (newsListResult = v));
    mainService.currentNews$.subscribe(v => (currentNewsResult = v));
    service.error$.subscribe(v => (errorResult = v));
    service.loading$.subscribe(v => (loadingResult = v));

    service.getNews();

    const req = httpMock.expectOne(`${environment.apiUrl}/news`);
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(errorResult).toBeTruthy();
    expect(newsListResult).toEqual([]);
    expect(currentNewsResult).toEqual([]);
    expect(loadingResult).toBeFalse();
  });

  it('should set loading true while request is in-flight and false after', () => {
    const loadingValues: boolean[] = [];
    service.loading$.subscribe(v => loadingValues.push(v));

    service.getNews();
    expect(loadingValues[loadingValues.length - 1]).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/news`);
    req.flush(mockNewsArray);

    expect(loadingValues[loadingValues.length - 1]).toBeFalse();
  });
});
