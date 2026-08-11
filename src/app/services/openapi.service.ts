import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, of } from 'rxjs';
import { NewsItem } from '../model/interface';
import { MainService } from './main.service';
import { environment } from '../../environments/environment';

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

  constructor(private httpClient: HttpClient, private mainService: MainService) {}

  getNews(): void {
    this.errorSubject.next(null);
    this.loadingSubject.next(true);

    this.httpClient.get<NewsItem[]>(`${this.apiUrl}/news`)
      .pipe(
        catchError(err => {
          this.errorSubject.next(err.error?.message || 'Failed to fetch news');
          return of([]);
        })
      )
      .subscribe(data => {
        const items = data || [];
        console.log('Fetched news items:', items);
        this.newsListSubject.next(items);
        this.mainService.setCurrentNews(items);
        this.loadingSubject.next(false);
      });
  }
}
