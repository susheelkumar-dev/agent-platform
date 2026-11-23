/**
 * Runs a screen that is still Ext JS code (on @extreact/runtime) inside a React display. Used for displays of
 * type 'custom' until they are rewritten, so a whole application works on the new shell from day one.
 *
 * The manifest names the screen: display.config = { xtype: 'gt-dashboard', wrap?: true, extConfig?: {...} }.
 * The app passes its Ext instance and, optionally, how parameters become component config.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { DisplayMeta, DisplayProps, Params } from '../types';

export interface ExtScreenOptions {
  /** extra component config from the display's parameters, e.g. { recordId: Number(params.id) } */
  screenConfig?: (meta: DisplayMeta, params: Params) => Record<string, unknown>;
  /** event fired on the component when a menu entry passes an action (Ext GridTrade: 'screenaction') */
  actionEvent?: string;
}

export function createExtScreen(Ext: any, options: ExtScreenOptions = {}): ComponentType<DisplayProps> {
  function ExtScreen({ meta, params, action, actionId }: DisplayProps) {
    const host = useRef<HTMLDivElement>(null);
    const cmp = useRef<any>(null);
    const [mounted, setMounted] = useState(0);  // bumps when the screen exists, so a pending action reaches it

    useEffect(() => {
      const el = host.current;
      if (!el) return undefined;
      const cfg = meta.config || {};
      if (!cfg.xtype) throw new Error(`Display '${meta.id}' has no config.xtype`);
      const extra = options.screenConfig ? options.screenConfig(meta, params) : {};
      let item: Record<string, unknown> = { xtype: cfg.xtype, ...(cfg.extConfig || {}), ...extra };
      if (cfg.wrap) item = { xtype: 'panel', layout: 'fit', header: false, border: false, items: [item], ...extra };
      let c: any = null;
      let ro: ResizeObserver | null = null;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const create = () => Ext.create({ ...item, renderTo: el, width: el.clientWidth || undefined, height: el.clientHeight || undefined });
      const attach = (created: any) => {
        c = created;
        cmp.current = c;
        el.classList.remove('xf-ext-loading');
        ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
          const w = el.clientWidth, h = el.clientHeight;
          if (w > 0 && h > 0 && c && !c.destroyed && c.setSize) c.setSize(w, h);
        }) : null;
        ro?.observe(el);
        setMounted((n) => n + 1);
      };
      const mount = () => {
        if (cancelled) return;
        let created: any;
        try {
          created = create();
        } catch (err) {
          // a class the screen creates was not in its chunk (referenced in a way the migrator could not see):
          // load every screen once and try again
          if (!Ext.Loader?.loadAll) { fail(err); return; }
          Ext.Loader.loadAll().then(() => { if (!cancelled) attach(create()); }).catch(fail);
          return;
        }
        attach(created);
      };
      const fail = (err: unknown) => {
        if (cancelled) return;
        console.error(`Display '${meta.id}' could not load ${cfg.xtype}`, err);
        el.classList.remove('xf-ext-loading');
        el.innerHTML = '<div class="xf-ext-error">This screen could not be loaded. Reload the page and try again.</div>';
      };
      // Load the screen's classes on first use (Ext.require resolves at once when they are already defined), then
      // create it after React finishes this commit: the runtime renders the Ext component into its own React root
      // synchronously, which React does not allow from inside an effect.
      el.classList.add('xf-ext-loading');
      const ready: Promise<void> = Ext.require ? Ext.require('widget.' + cfg.xtype) : Promise.resolve();
      ready.then(() => { if (!cancelled) timer = setTimeout(mount, 0); }, fail);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        ro?.disconnect();
        cmp.current = null;
        try { if (c && !c.destroyed) c.destroy(); } catch (e) { console.warn('Ext screen cleanup failed', e); }
        el.innerHTML = '';
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meta.id]);

    useEffect(() => {
      if (!action || !options.actionEvent || !cmp.current) return undefined;
      const t = setTimeout(() => { const c = cmp.current; if (c && !c.destroyed) c.fireEvent(options.actionEvent, c, action); }, 80);
      return () => clearTimeout(t);
    }, [action, actionId, mounted]);

    return <div ref={host} className="xf-ext-host" data-display={meta.id} />;
  }
  return ExtScreen;
}
