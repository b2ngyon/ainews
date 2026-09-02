import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { StarredNewsItem } from '../../model/interface';
import { StarService } from '../../services/star.service';
import { NewsCardComponent } from '../news-card/news-card.component';
import { PaginatorComponent } from '../paginator/paginator.component';

/** Fixed: the starred list can hold up to 500 items. */
const PAGE_SIZE = 12;

@Component({
  selector: 'app-starred',
  standalone: true,
  imports: [CommonModule, NewsCardComponent, PaginatorComponent],
  templateUrl: './starred.component.html',
  styleUrl: './starred.component.css'
})
export class StarredComponent implements OnInit, OnDestroy {
  starredList: StarredNewsItem[] = [];
  storageError: string | null = null;

  readonly pageSize = PAGE_SIZE;
  page = 1;

  private destroy$ = new Subject<void>();

  constructor(private starService: StarService) {}

  ngOnInit(): void {
    // Ordered most recently starred first by the service.
    this.starService.starred$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        this.starredList = items;
        // Unstarring the last item on the final page must not leave the reader
        // staring at an empty list.
        const totalPages = Math.max(1, Math.ceil(items.length / this.pageSize));
        if (this.page > totalPages) this.page = totalPages;
      });

    this.starService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(err => {
        this.storageError = err;
      });
  }

  /** Paging here is pure presentation - there is no network call to make. */
  onPageChange(page: number): void {
    this.page = page;
  }

  get pagedStarred(): StarredNewsItem[] {
    const start = (this.page - 1) * this.pageSize;
    return this.starredList.slice(start, start + this.pageSize);
  }

  trackByStarKey(_index: number, item: StarredNewsItem): string {
    return item.star_key;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
