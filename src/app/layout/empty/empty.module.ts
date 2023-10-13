import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { EmptyLayoutComponent } from './empty.component';

@NgModule({
    declarations: [
        EmptyLayoutComponent
    ],
    imports: [
        RouterModule
    ],
    exports: [
        EmptyLayoutComponent
    ]
})
export class EmptyLayoutModule {
}