import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { NewsItem, NewsLimit, DEFAULT_LIMIT } from '../model/interface';
import { MainService } from './main.service';
import { environment } from '../../environments/environment';

interface NewsResponse {
  items: NewsItem[];
  stale: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class OpenapiService {
  private apiUrl = environment.apiUrl;

  private newsListSubject = new BehaviorSubject<NewsItem[]>([]);
  public newsList$ = this.newsListSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private errorSubject = new BehaviorSubject<string | null>(null);
  public error$ = this.errorSubject.asObservable();

  /**
   * True when the server served a previous batch because the feeds are
   * currently failing. The dashboard suppresses its "showing N of M" line in
   * this state - a stale 12-item body answering a request for 50 is not a
   * supply shortfall, and reporting it as one would be a lie.
   */
  private staleSubject = new BehaviorSubject<boolean>(false);
  public stale$ = this.staleSubject.asObservable();

  /**
   * Requests are funnelled through a Subject and switchMap so that a rapid
   * 12 -> 25 -> 50 sequence resolves to whichever was requested last, not
   * whichever happened to land last. Without this the list and the selector
   * disagree, intermittently, and it looks like a random bug.
   */
  private request$ = new Subject<NewsLimit>();

  constructor(private httpClient: HttpClient, private mainService: MainService) {
    this.request$
      .pipe(
        switchMap(limit => this.fetch(limit))
      )
      .subscribe(({ items, stale }) => {
        items.sort((a, b) => b.severity_index - a.severity_index);
        this.staleSubject.next(stale);
        this.newsListSubject.next(items);
        this.mainService.setCurrentNews(items);
        this.loadingSubject.next(false);
      });
  }

  getNews(limit: NewsLimit = DEFAULT_LIMIT): void {
    this.errorSubject.next(null);
    this.loadingSubject.next(true);
    this.request$.next(limit);
  }

  private fetch(limit: NewsLimit) {
    return this.httpClient
      .get<NewsItem[]>(`${this.apiUrl}/news`, {
        params: { limit: String(limit) },
        observe: 'response'
      })
      .pipe(
        map((res): NewsResponse => ({
          items: res.body ?? [],
          stale: res.headers.get('X-News-Stale') === 'true'
        })),
        catchError(err => {
          this.errorSubject.next(err.error?.message || 'Failed to fetch news');
          return of<NewsResponse>({ items: [], stale: false });
        })
      );
  }
}
