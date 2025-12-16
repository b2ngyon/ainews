import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { NewsItem } from '../model/interface';

@Injectable({
  providedIn: 'root'
})
export class MainService {

  constructor() { }

 private getResults = new BehaviorSubject<NewsItem[]>([<NewsItem>{}]);
 currentNews = this.getResults.asObservable();


 setCurrentNews(news:NewsItem[]){
  this.getResults.next(news);
 }
}
