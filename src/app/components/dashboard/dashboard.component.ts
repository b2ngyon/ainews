import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OpenapiService } from '../../services/openapi.service';
import { MainService } from '../../services/main.service';
import { StarService, starKey } from '../../services/star.service';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NewsItem } from '../../model/interface';
import { NewsCardComponent } from '../news-card/news-card.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, NewsCardComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  newsList: NewsItem[] = [];
  isLoading = false;
  errorMessage: string | null = null;

  /**
   * Starred state is derived from StarService, never written onto the NewsItem:
   * the feed is replaced wholesale every 60s with fresh object references, so a
   * flag stored on the item would be wiped every minute.
   */
  starredKeys = new Set<string>();

  private destroy$ = new Subject<void>();

  constructor(
    private openapiService: OpenapiService,
    private mainService: MainService,
    private starService: StarService
  ) {}

  ngOnInit(): void {
    this.mainService.currentNews$
      .pipe(takeUntil(this.destroy$))
      .subscribe(news => {
        this.newsList = news;
        // Keep stored snapshots of starred articles current while they are
        // still in the feed.
        this.starService.refreshFromFeed(news);
      });

    this.starService.starredKeys$
      .pipe(takeUntil(this.destroy$))
      .subscribe(keys => {
        this.starredKeys = keys;
      });

    this.openapiService.loading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => {
        this.isLoading = loading;
      });

    this.openapiService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(err => {
        this.errorMessage = err;
      });

    this.loadNews();

    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadNews());
  }

  loadNews(): void {
    this.openapiService.getNews();
  }

  isStarred(item: NewsItem): boolean {
    const key = starKey(item);
    return key !== null && this.starredKeys.has(key);
  }

  /** Without this the 60s refresh rebuilds every card, losing focus on the star button. */
  trackByStarKey(_index: number, item: NewsItem): string {
    return starKey(item) ?? item.title;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
