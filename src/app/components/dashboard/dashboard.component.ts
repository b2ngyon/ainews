import { Component, OnInit } from '@angular/core';
import { OpenapiService } from '../../services/openapi.service';
import { NewsItem } from '../../model/interface';
import { MainService } from '../../services/main.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {

constructor(private aiService:OpenapiService,private mainService:MainService){}

  results :NewsItem[] = [];

  async ngOnInit(): Promise<void> {
    this.aiService.getNews();
   this.mainService.currentNews.subscribe(news => this.results = news);
  

     setInterval(() => {
     this.aiService.getNews();
      console.log(this.results);
    }, 60000);
  }

}
