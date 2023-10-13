import { NgModule } from '@angular/core';
import { LayoutComponent } from './layout.component';
import { EmptyLayoutModule } from './empty/empty.module';
import { CommonModule } from '@angular/common';


@NgModule({
	declarations: [LayoutComponent],
	imports: [
		// CommonModule is required for *ngIf in layout.component.html
		CommonModule,
		EmptyLayoutModule
	],
	exports: [LayoutComponent, EmptyLayoutModule],
})
export class LayoutModule {}