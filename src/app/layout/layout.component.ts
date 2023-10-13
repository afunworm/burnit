import { Component, ViewEncapsulation, inject } from '@angular/core';
import { Layout } from './layout.type';
import { ActivatedRoute } from '@angular/router';
import { AppConfig, appConfig } from '../core/config/app.config';

@Component({
    selector     : 'layout',
    templateUrl  : './layout.component.html',
    styleUrls    : ['./layout.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class LayoutComponent {

    private _activatedRoute = inject(ActivatedRoute);
    private config:AppConfig = appConfig;
    layout: Layout = "empty";

    /**
     * Constructor
     */
    constructor() {

        // 1. Set the layout from the config
        this.layout = this.config.layout;

        // 2. Update the layout if found in route options
        this._activatedRoute.data.subscribe(data => {
            this.layout = data.layout;
        });

    }

}