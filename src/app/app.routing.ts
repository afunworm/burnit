import { Route } from '@angular/router';
import { AuthGuard } from './core/auth/guards/auth.guard';
import { NoAuthGuard } from './core/auth/guards/noAuth.guard';
import { LayoutComponent } from './layout/layout.component';

export const appRoutes: Route[] = [

	// ==========================
	// Redirection Examples
	// ==========================
	//
	// Example of redirecting signed in user
	// After the user signs in, the sign in page will redirect the user to the 'signed-in-redirect'
	// path. Below is another redirection for that path to redirect the user to the desired
	// location. This is a small convenience to keep all main routes together here on this file.
	//
	// { path: 'signed-in-redirect', pathMatch: 'full', redirectTo: 'dashboard' },
	{ path: '', pathMatch: 'full', redirectTo: 'create' },



	// ======================
	// Guest Routing Examples
	// ======================
	//
	// Auth routes for guests
	//
	{
		path: '',
		canActivate: [NoAuthGuard],
		canActivateChild: [NoAuthGuard],
		component: LayoutComponent,
		data: { layout: 'empty' },
		children: [
			{
				path: 'create',
				loadChildren: () => import('./modules/create/create.module').then((m) => m.CreateModule),
			},
			{
				path: ':id',
				loadChildren: () => import('./modules/view/view.module').then((m) => m.ViewModule),
			}
		],
	},



	// ============================
	// Authenticated Users' Routing 
	// ============================
	//
	// {
	// 	path: '',
	// 	canActivate: [AuthGuard],
	// 	canActivateChild: [AuthGuard],
	// 	resolve: { initialData: InitialDataResolver },
	// 	component: LayoutComponent,
	// 	data: { layout: 'empty' },
	// 	children: [
	// 		{
	// 			path: 'sign-out',
	// 			loadChildren: () =>
	// 				import('app/path/to/sign-out/module/sign-out.module').then((m) => m.SignOutModule),
	// 		}
	// 	],
	// }
];