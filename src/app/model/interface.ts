export interface NewsItem {
  title: string;
  summary: string;
  severity: string;
  category: string;
  timestamp: string;
  news_timestamp: string;
  reference_link:string;
  cve_reference: string | null;
  source_author: string;
}

export interface StarredNewsItem {
  title: string;
  summary: string;
  starred_at: string;
}

export interface User {
  username: string;
  password: string;
}
