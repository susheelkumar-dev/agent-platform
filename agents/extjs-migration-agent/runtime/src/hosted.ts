/**
 * Import first (before an application's classes) when a shell such as @extreact/framework creates the screens:
 * Ext.application() then registers the application class without launching a viewport.
 */
import { Ext } from './index';

(Ext as any).$hosted = true;

export { Ext };
