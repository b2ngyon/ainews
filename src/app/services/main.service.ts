import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { NewsItem } from '../model/interface';

@Injectable({
  providedIn: 'root'
})
export class MainService {
  private currentNewsSubject = new BehaviorSubject<NewsItem[]>([]);
  public currentNews$: Observable<NewsItem[]> = this.currentNewsSubject.asObservable();

  constructor() {}

  setCurrentNews(news: NewsItem[]): void {
    this.currentNewsSubject.next(news);
  }
}
