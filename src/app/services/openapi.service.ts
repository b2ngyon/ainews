import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, OnInit, Version } from '@angular/core';
import { NewsItem } from '../model/interface';

@Injectable({
  providedIn: 'root'
})
export class OpenapiService{

  newsList : NewsItem[] = []; 
  error:string='';
  constructor(private httpClient:HttpClient) { }


  private openApikey = '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';
  private prompt:string=`Act as a cybersecurity news analyst. Search through trusted news sources, security blogs, and technical forums to gather the latest information about:
  Zero-day vulnerabilities and attacks
  Emerging cyber threats and campaigns
  Critical security vulnerabilities and patches
  Advanced cybersecurity technologies and innovationFor each relevant finding, compile the information in this structured JSON format:
  {
    "news_title": "The headline of the news article",
    "key_point": "A single, most critical takeaway from the news",
    "summary": "A concise 1-2 sentence overview describing the event, targets, and impact",
    "category": "The primary threat type (e.g., Zero-Day, Ransomware, Phishing, Espionage, Vulnerability, Security Update)",
    "severity_level": "Assessed threat level (Critical, High, Medium, Low)",
    "timestamp": "Publication or event date in YYYY-MM-DD format",
    "related_url": "Direct link to the primary source article",
    "source_author": "Publication name or author",
    "trusted_level": "Source credibility assessment (High, Medium, Low)",
    "cve_references": ["List", "Of", "Relevant", "CVE", "IDs"]
}`;
private openAiUrl = 'https://api.openai.com/v1/responses';


async getNews() : Promise<NewsItem[]>{
const requestData = {
      // model: 'gpt-5',
      // messages: [{
      //   role: "developer",
      //   content: this.prompt,
      // }],
      // max_completion_tokens: 10000,
      // temperature: 1
      prompt:
        {
          id:'pmpt_6917617613a881908b2bc29efc8a8e670d52a8a0b883d5da',
          version:'7'
        }
      
}

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.openApikey}`
    });

    await this.httpClient.post<any>(this.openAiUrl,requestData,{headers}).subscribe({
      next:(response)=>{
        //console.log(response.choices)
        if(response.output && response.output.length >0){
          this.newsList = JSON.parse(response.output[1].content[0].text)
          console.log(JSON.parse(response.output[1].content[0].text));
        }
      },
      error:(error)=>{
       if (error.error?.error) {
            this.error = error.error.error.message;
          } else if (error.status === 401) {
            this.error = 'Invalid API key. Please check your OpenAI API key.';
          } else if (error.status === 429) {
            this.error = 'Rate limit exceeded. Please try again later.';
          } else if (error.status === 0) {
            this.error = 'Network error. Please check your internet connection.';
          } else {
            this.error = `An error occurred: ${error.statusText || 'Unknown error'}`;
          }
    }
    });
    // console.log(this.error);
     
    return this.newsList;
}

}
