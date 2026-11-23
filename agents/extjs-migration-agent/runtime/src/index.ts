/**
 * @extreact/runtime: React + TypeScript implementation of the Ext JS 7 classic APIs that migrated
 * applications use. Importing this module installs the global `Ext` namespace with every class registered,
 * in dependency order. Application modules then run their (ported) Ext.define calls against it.
 */
import { Ext } from './core/ext';
import './core/class';
import './core/loader';
import './core/observable';
import './util/date';
import './util/format';
import './util/template';
import './util/collection';
import './util/task';
import './dom/element';
import './data/connection';
import './data/model';
import './data/proxy';
import './data/store';
import './app/viewmodel';
import './app/router';
import './app/state';
import './ui/componentquery';
import './ui/render';
import './ui/component';
import './ui/container';
import './ui/floating';
import './ui/panel';
import './ui/button';
import './ui/toolbar';
import './ui/menu';
import './ui/tab';
import './ui/window';
import './ui/tip';
import './ui/form/field';
import './ui/form/picker';
import './ui/form/form';
import './ui/grid/column';
import './ui/grid/view';
import './ui/grid/panel';
import './ui/grid/features';
import './ui/grid/plugins';
import './ui/chart';
import './app/controller';

(globalThis as any).Ext = Ext;
export { Ext };
export default Ext;
