import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Dumb paginator. Knows nothing about news, starring or HTTP, so the dashboard
 * and the starred view can both use it - the starred view must never trigger a
 * fetch when its page changes.
 */
@Component({
  selector: 'app-paginator',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './paginator.component.html',
  styleUrl: './paginator.component.css'
})
export class PaginatorComponent {
  @Input() total = 0;
  @Input() pageSize = 12;
  @Input() page = 1;

  /** Suppresses the "of N" count when the data is a stale fallback. */
  @Input() showCount = true;

  /** Names the thing being counted, e.g. "articles" or "starred articles". */
  @Input() label = 'items';

  @Output() pageChange = new EventEmitter<number>();

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  get firstShown(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get lastShown(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  get hasPrevious(): boolean {
    return this.page > 1;
  }

  get hasNext(): boolean {
    return this.page < this.totalPages;
  }

  goTo(page: number): void {
    const clamped = Math.min(Math.max(1, page), this.totalPages);
    if (clamped !== this.page) {
      this.pageChange.emit(clamped);
    }
  }
}
