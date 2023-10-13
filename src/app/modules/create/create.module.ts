import { NgModule } from '@angular/core';
import { CreateComponent } from './create.component';
import { Route, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { KeyboardShortcutsModule } from 'ng-keyboard-shortcuts';
import { CommonModule } from '@angular/common';

const viewRoutes: Route[] = [
	{
		path: '',
		component: CreateComponent,
	},
];
@NgModule({
	declarations: [CreateComponent],
	imports: [
		RouterModule.forChild(viewRoutes),
		CommonModule,
		FormsModule,
		KeyboardShortcutsModule.forRoot()
	],
	exports: [CreateComponent],
})
export class CreateModule {}