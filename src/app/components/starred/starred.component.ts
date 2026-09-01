import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { StarredNewsItem } from '../../model/interface';
import { StarService } from '../../services/star.service';
import { NewsCardComponent } from '../news-card/news-card.component';

@Component({
  selector: 'app-starred',
  standalone: true,
  imports: [CommonModule, NewsCardComponent],
  templateUrl: './starred.component.html',
  styleUrl: './starred.component.css'
})
export class StarredComponent implements OnInit, OnDestroy {
  starredList: StarredNewsItem[] = [];
  storageError: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(private starService: StarService) {}

  ngOnInit(): void {
    // Ordered most recently starred first by the service.
    this.starService.starred$
      .pipe(takeUntil(this.destroy$))
      .subscribe(items => {
        this.starredList = items;
      });

    this.starService.error$
      .pipe(takeUntil(this.destroy$))
      .subscribe(err => {
        this.storageError = err;
      });
  }

  trackByStarKey(_index: number, item: StarredNewsItem): string {
    return item.star_key;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
