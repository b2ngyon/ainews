import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NewsItem } from '../../model/interface';
import { StarService } from '../../services/star.service';

@Component({
  selector: 'app-news-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './news-card.component.html',
  styleUrl: './news-card.component.css'
})
export class NewsCardComponent {
  @Input({ required: true }) item!: NewsItem;

  /**
   * Starred state is passed in rather than read from the service per render:
   * the parent derives it from StarService.starredKeys$, so it stays correct
   * across the 60s feed refresh without ever being written onto the NewsItem.
   */
  @Input() starred = false;

  constructor(private starService: StarService) {}

  /**
   * The backend's degraded path emits severity 'Unknown', and a corrupt
   * localStorage blob can produce a missing one. An unguarded toLowerCase()
   * here throws and takes the whole list down with it.
   */
  get severityClass(): string {
    const severity = (this.item?.severity || '').toLowerCase();
    return ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'unknown';
  }

  get sourceHost(): string {
    try {
      return new URL(this.item.reference_link).hostname.replace(/^www\./, '');
    } catch {
      return 'source';
    }
  }

  toggleStar(): void {
    this.starService.toggle(this.item);
  }
}
