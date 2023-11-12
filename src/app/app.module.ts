import { NgModule } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";

import { appRoutes } from "./app.routing";
import { RouterModule } from "@angular/router";
import { AppComponent } from "./app.component";
import { LayoutModule } from "./layout/layout.module";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import { HttpClientModule } from "@angular/common/http";

@NgModule({
	declarations: [AppComponent],
	imports: [
		BrowserModule,
		RouterModule.forRoot(appRoutes),
		HttpClientModule,

		// Layout module
		LayoutModule,
		BrowserAnimationsModule,
	],
	providers: [],
	bootstrap: [AppComponent],
})
export class AppModule {}
