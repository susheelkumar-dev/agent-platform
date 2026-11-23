/**
 * Ext-style screens as first-class displays.
 *
 * Screens written in the Ext JS style (Ext.define views, controllers, stores on @extreact/runtime) are displays of
 * type 'custom' whose manifest config names the view: { xtype: 'gt-contractsummary' }. These helpers are all an
 * application needs to host them; nothing about them is generated into the application.
 *
 *   import { Ext } from '@extreact/runtime';
 *   import { classicDisplays, classicBridge } from '@extreact/framework';
 *   export const displays = mergeDisplays(builtinDisplays, classicDisplays(Ext), ...);
 *   <FrameworkApp ... bridge={classicBridge(Ext)} />
 */
import { defineDisplays } from '../display/registry';
import type { ExtBridge } from '../shell/AppShell';
import type { ShellApi } from '../shell/context';
import { createExtScreen, type ExtScreenOptions } from './ExtScreen';

/** Registry entry 'ExtScreen' (display type 'custom') rendering Ext-style views by xtype. */
export function classicDisplays(Ext: any, options: ExtScreenOptions = {}) {
  const Screen = createExtScreen(Ext, options);
  return defineDisplays({ ExtScreen: { load: async () => ({ default: Screen }), types: ['custom'] } });
}

export interface ClassicBridgeOptions {
  /** what the old Application.launch did once signed in: load lookups, start timers, listen to events */
  start?: (shell: ShellApi) => Promise<void> | void;
  stop?: () => void;
}

/**
 * Connects Ext-style screens to the shell: every Ext.Ajax / store proxy request carries the signed-in user's
 * token, and a 401 sends the user back to sign-in like any other display.
 */
export function classicBridge(Ext: any, options: ClassicBridgeOptions = {}): ExtBridge {
  let installed = false;
  return {
    async start(shell) {
      if (!installed && Ext?.Ajax?.on) {
        installed = true;
        Ext.Ajax.on('beforerequest', (_conn: unknown, req: any) => {
          const token = shell.token();
          req.headers = Object.assign(token ? { Authorization: 'Bearer ' + token } : {}, req.headers);
        });
        Ext.Ajax.on('requestexception', (_conn: unknown, res: any) => {
          if (res && res.status === 401) shell.signOut('Your session has ended. Please sign in again.');
        });
      }
      await options.start?.(shell);
    },
    stop() { options.stop?.(); },
  };
}
