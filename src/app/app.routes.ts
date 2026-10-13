import { Routes } from "@angular/router";

export const routes: Routes = [
	{ path: "", pathMatch: "full", redirectTo: "create" },
	{
		path: "create",
		title: "Burn It - Share Your Secret. Safely. Minimally.",
		loadComponent: () => import("./pages/create/create").then((m) => m.CreatePage),
	},
	{
		path: "v/:id",
		title: "Burn It - Secret Message",
		loadComponent: () => import("./pages/view/view").then((m) => m.ViewPage),
	},
	{ path: "**", redirectTo: "create" },
];
