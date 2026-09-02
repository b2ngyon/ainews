import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OpenapiService } from '../../services/openapi.service';
import { MainService } from '../../services/main.service';
import { StarService, starKey } from '../../services/star.service';
import { CountService } from '../../services/count.service';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NewsItem, NewsLimit } from '../../model/interface';
import { NewsCardComponent } from '../news-card/news-card.component';
import { PaginatorComponent } from '../paginator/paginator.component';

/** Cards per page. Independent of how many items are fetched. */
const PAGE_SIZE = 12;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, NewsCardComponent, PaginatorComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  newsList: NewsItem[] = [];
  isLoading = false;
  errorMessage: string | null = null;
  isStale = false;

  count: NewsLimit = 12;
  readonly countOptions: readonly NewsLimit[];
  readonly pageSize = PAGE_SIZE;
  page = 1;

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
    private starService: StarService,
    private countService: CountService
  ) {
    this.countOptions = this.countService.options;
    this.count = this.countService.count;
  }

  /** Only the current page is rendered, so trackBy operates on this slice. */
  get pagedNews(): NewsItem[] {
    const start = (this.page - 1) * this.pageSize;
    return this.newsList.slice(start, start + this.pageSize);
  }

  ngOnInit(): void {
    this.mainService.currentNews$
      .pipe(takeUntil(this.destroy$))
      .subscribe(news => {
        this.newsList = news;
        // The 60s refresh replaces the list wholesale, and supply moves - a
        // feed going down can shrink 50 items to 47. Without this, a reader
        // sitting on the last page would watch it silently render empty.
        this.clampPage();
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

    this.openapiService.stale$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stale => {
        this.isStale = stale;
      });

    this.loadNews();

    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadNews());
  }

  loadNews(): void {
    this.openapiService.getNews(this.count);
  }

  /** Changing how many items to fetch refetches and returns to the first page. */
  onCountChange(value: string): void {
    const next = Number(value);
    this.countService.set(next);
    this.count = this.countService.count;
    this.page = 1;
    this.loadNews();
  }

  /** Changing page is pure presentation - it must never hit the network. */
  onPageChange(page: number): void {
    this.page = page;
  }

  private clampPage(): void {
    const totalPages = Math.max(1, Math.ceil(this.newsList.length / this.pageSize));
    if (this.page > totalPages) {
      this.page = totalPages;
    }
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
