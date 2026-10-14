import { Routes } from "@angular/router";

export const routes: Routes = [
	{ path: "", pathMatch: "full", redirectTo: "create" },
	{
		path: "create",
		title: "Burn It - Share Your Secret. Safely. Minimally.",
		loadComponent: () => import("./pages/create/create").then((m) => m.CreatePage),
	},
	{
		path: "edit/:id",
		title: "Burn It - Edit Message",
		loadComponent: () => import("./pages/create/create").then((m) => m.CreatePage),
	},
	{
		path: "account",
		title: "Burn It - Account",
		loadComponent: () => import("./pages/account/account").then((m) => m.AccountPage),
	},
	{
		path: "v/:id",
		title: "Burn It - Secret Message",
		loadComponent: () => import("./pages/view/view").then((m) => m.ViewPage),
	},
	{
		// Short links, e.g. /test. Fixed paths above win; anything else goes to the editor.
		matcher: (segments) =>
			segments.length === 1 && /^[A-Za-z0-9]{3,20}$/.test(segments[0].path)
				? { consumed: segments, posParams: { code: segments[0] } }
				: null,
		title: "Burn It - Short Link",
		loadComponent: () => import("./pages/short-link/short-link").then((m) => m.ShortLinkPage),
	},
	{ path: "**", redirectTo: "create" },
];
