import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, CanActivateChild, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';

@Injectable({
	providedIn: 'root',
})
export class AuthGuard implements CanActivate, CanActivateChild {

	constructor() {}

    /**
	 * Can activate
	 */
	canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
		// Showing page loading progress bar
		// this._loadingService.pageLoading();

		return new Promise(async (resolve) => {

            resolve(true);

            // ===================
            // canActivate Example
            // ===================
            //
            // Resolve true for logged in user, redirection and resolve false for non-logged in user
            //
			// Subscribe to the authUser$ to know if a user is logged in
            // Only take 1 result to unsubscribe after that and prevent looping
			// this._authService.authUser$.pipe(take(1)).subscribe((user) => {

			// 	// If user is null, user is not authenticated
			// 	if (!user) {
			// 		this._router.navigate(['sign-in']);
			// 		resolve(false);
			// 		return;
			// 	}

			// 	resolve(true);
			// });

		});
	}

	/**
	 * Can activate child
	 */
	canActivateChild(): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
        return true;
	}
}