import { Component, OnInit } from '@angular/core';
import { OpenapiService } from '../../services/openapi.service';
import { NewsItem } from '../../model/interface';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {

constructor(private aiService:OpenapiService){}

  results :NewsItem[] = [];

  async ngOnInit(): Promise<void> {
   this.results = await this.aiService.getNews();
   console.log(this.results)
  }

}
