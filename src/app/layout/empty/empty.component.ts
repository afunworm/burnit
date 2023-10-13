import { Component, ViewEncapsulation } from '@angular/core';

@Component({
    selector     : 'empty-layout',
    templateUrl  : './empty.component.html',
    encapsulation: ViewEncapsulation.None
})
export class EmptyLayoutComponent {

    /**
     * Constructor
     */
    constructor() {}

}