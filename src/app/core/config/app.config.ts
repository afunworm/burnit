import { Layout } from '../../layout/layout.type';

// Types
// Can be used ot set parameters other than default, such as 'light' or 'dark'
export type Scheme = 'default';

/**
 * AppConfig interface. Update this interface to strictly type your config
 * object.
 */
export interface AppConfig
{
    layout: Layout;
    scheme: Scheme;
}

/**
 * Default configuration for the entire application. This object is used by
 * FuseConfigService to set the default configuration.
 *
 * If you need to store global configuration for your app, you can use this
 * object to set the defaults. To access, update and reset the config, use
 * FuseConfigService and its methods.
 */
export const appConfig: AppConfig = {
    layout: 'empty',
    scheme : 'default'
};

/*
 * Encryption salt for AES encryption
*/
export const encryptionSalt: string = "NlBK7TgXLpQZ7JbnKSy2nxafGEkyhBpHCmzWGJNz";

/*
 * Salt for Message Content's Reference
*/
export const messageRefSalt: string = "MucFzlqcTd";