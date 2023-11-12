import { NgModule } from "@angular/core";
import { ViewComponent } from "./view.component";
import { Route, RouterModule } from "@angular/router";
import { CommonModule } from "@angular/common";
import { KeyboardShortcutsModule } from "ng-keyboard-shortcuts";
import { FormsModule } from "@angular/forms";

const viewRoutes: Route[] = [
	{
		path: "",
		component: ViewComponent,
	},
];
@NgModule({
	declarations: [ViewComponent],
	imports: [
		RouterModule.forChild(viewRoutes),
		FormsModule,
		CommonModule,
		KeyboardShortcutsModule.forRoot(),
	],
	exports: [ViewComponent],
})
export class ViewModule {}
