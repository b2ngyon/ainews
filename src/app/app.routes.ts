import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { StarredComponent } from './components/starred/starred.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent, title: 'Dashboard | AINews' },
  { path: 'starred', component: StarredComponent, title: 'Starred | AINews' },
  { path: '**', redirectTo: '' }
];
