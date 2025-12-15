export interface NewsItem {
    news_title: string;
    key_point: string;
    summary: string;
    related_url: string;
    category_level:string;
    timestamp:string;
    cve_reference:string[];
    source_auothor: string;
    trusted_level:string;
}


export interface StarredNewsItem {
    news_title: string;
    key_point: string;
    summary: string;
    related_url: string;
    starred_at:string;
}

export interface User{
    username:string;
    password:string;
}