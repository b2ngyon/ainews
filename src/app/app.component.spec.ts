import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { environment } from '../environments/environment';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'cyberSec-news-ai' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('cyberSec-news-ai');
  });

  it('should render the dashboard at the default route', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    await TestBed.inject(Router).navigate(['/']);
    fixture.detectChanges();

    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(`${environment.apiUrl}/news?limit=12`).flush([]);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-dashboard')).toBeTruthy();
    expect(compiled.querySelector('app-starred')).toBeFalsy();

    httpMock.verify();
  });

  it('should render the starred view at /starred', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    await TestBed.inject(Router).navigate(['/starred']);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-starred')).toBeTruthy();
    expect(compiled.querySelector('app-dashboard')).toBeFalsy();
  });

  it('should not mark the Dashboard link active while on /starred', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    await TestBed.inject(Router).navigate(['/starred']);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const links = Array.from(compiled.querySelectorAll('nav a'));
    const dashboardLink = links.find(a => a.textContent?.includes('Dashboard'));
    const starredLink = links.find(a => a.textContent?.includes('Starred'));

    // '/' is a prefix of every route, so this only holds with exact matching.
    expect(dashboardLink?.classList.contains('text-accent')).toBeFalse();
    expect(starredLink?.classList.contains('text-accent')).toBeTrue();
  });
});
