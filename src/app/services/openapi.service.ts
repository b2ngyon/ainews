import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, of } from 'rxjs';
import { NewsItem } from '../model/interface';
import { MainService } from './main.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class OpenapiService {
  private apiUrl = environment.apiUrl;

  private newsListSubject = new BehaviorSubject<NewsItem[]>([]);
  public newsList$ = this.newsListSubject.asObservable();

  error: string | null = null;

  constructor(private httpClient: HttpClient, private mainService: MainService) {}

  getNews(): void {
    this.error = null;

    this.httpClient.get<NewsItem[]>(`${this.apiUrl}/news`)
      .pipe(
        catchError(err => {
          this.error = err.error?.message || 'Failed to fetch news';
          return of([]);
        })
      )
      .subscribe(data => {
        const items = data || [];
        this.newsListSubject.next(items);
        this.mainService.setCurrentNews(items);
      });
  }
}
