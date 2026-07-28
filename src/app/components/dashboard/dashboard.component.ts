import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OpenapiService } from '../../services/openapi.service';
import { MainService } from '../../services/main.service';
import { Subject, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NewsItem } from '../../model/interface';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  newsList: NewsItem[] = [];
  isLoading = false;
  errorMessage: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private openapiService: OpenapiService,
    private mainService: MainService
  ) {}

  ngOnInit(): void {
    this.mainService.currentNews$
      .pipe(takeUntil(this.destroy$))
      .subscribe(news => {
        this.newsList = news;
        this.isLoading = false;
      });

    this.loadNews();

    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadNews());
  }

  loadNews(): void {
    this.isLoading = true;
    this.errorMessage = null;
    this.openapiService.getNews();

    setTimeout(() => {
      if (this.openapiService.error) {
        this.errorMessage = this.openapiService.error;
        this.isLoading = false;
      }
    }, 5000);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
