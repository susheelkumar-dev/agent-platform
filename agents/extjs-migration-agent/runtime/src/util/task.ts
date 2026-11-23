/** Ext.util.TaskRunner, Ext.util.TaskManager (Ext.TaskManager), Ext.util.DelayedTask and Ext.Promise. */
import { Ext } from '../core/ext';
import { define } from '../core/class';

export const TaskRunner: any = define('Ext.util.TaskRunner', {
  interval: 10,
  constructor: function (interval?: any) {
    this.tasks = [];
    if (typeof interval === 'number') { this.interval = interval; } else if (interval) { Ext.apply(this, interval); }
    return this;
  },
  newTask: function (config: any) {
    const task = new Task(config);
    task.manager = this;
    return task;
  },
  start: function (task: any) {
    const me = this;
    if (!task.isTask) { task = me.newTask(task); }
    task.manager = me;
    if (task.$timer) { clearInterval(task.$timer); }
    task.taskRunCount = 0;
    task.taskStartTime = Date.now();
    task.stopped = false;
    const tick = () => {
      if (task.stopped) { return; }
      if ((task.repeat && task.taskRunCount >= task.repeat) || (task.duration && Date.now() - task.taskStartTime >= task.duration)) {
        me.stop(task);
        return;
      }
      task.taskRunCount++;
      let r;
      try { r = task.run.apply(task.scope || task, task.args || [task.taskRunCount]); } catch (e) { console.error(e); }
      if (r === false) { me.stop(task); }
    };
    task.$timer = setInterval(tick, task.interval || me.interval);
    if (task.fireOnStart) { tick(); }
    if (me.tasks.indexOf(task) < 0) { me.tasks.push(task); }
    return task;
  },
  stop: function (task: any) {
    if (!task) { return task; }
    if (task.$timer) { clearInterval(task.$timer); task.$timer = null; }
    task.stopped = true;
    Ext.Array.remove(this.tasks, task);
    if (task.onStop) { task.onStop.call(task.scope || task, task); }
    return task;
  },
  stopAll: function () { for (const t of this.tasks.slice()) { this.stop(t); } },
  destroy: function () { this.stopAll(); this.callParent(); }
});

const Task: any = define('Ext.util.TaskRunner.Task', {
  isTask: true,
  stopped: true,
  fireOnStart: false,
  constructor: function (config?: any) { Ext.apply(this, config); return this; },
  start: function (interval?: number) { if (interval) { this.interval = interval; } return this.manager.start(this); },
  stop: function () { return this.manager.stop(this); },
  restart: function (interval?: number) { this.stop(); return this.start(interval); },
  destroy: function () { this.stop(); this.destroyed = true; }
});

Ext.util.TaskManager = Ext.TaskManager = new TaskRunner();

export const DelayedTask: any = define('Ext.util.DelayedTask', {
  constructor: function (fn?: any, scope?: any, args?: any, cancelOnDelay?: boolean, fireIdleEvent?: boolean) {
    this.fn = fn; this.scope = scope; this.args = args; this.id = null;
    void cancelOnDelay; void fireIdleEvent;
    return this;
  },
  delay: function (newDelay: number, newFn?: any, newScope?: any, newArgs?: any) {
    const me = this;
    me.cancel();
    if (newFn) { me.fn = newFn; }
    if (newScope) { me.scope = newScope; }
    if (newArgs) { me.args = newArgs; }
    me.delayTime = newDelay;
    me.id = setTimeout(() => { me.id = null; me.fn.apply(me.scope, me.args || []); }, newDelay || 0);
  },
  cancel: function () { if (this.id) { clearTimeout(this.id); this.id = null; } },
  isPending: function () { return !!this.id; }
});

// Ext.Promise: native promises plus Ext's extra methods.
class ExtPromise<T> extends Promise<T> {
  otherwise(fn: any, scope?: any) { return this.then(undefined, scope ? fn.bind(scope) : fn); }
  always(fn: any, scope?: any) { return this.then((v) => { (scope ? fn.bind(scope) : fn)(); return v; }, (e) => { (scope ? fn.bind(scope) : fn)(); throw e; }); }
  done() { this.then(undefined, (e) => { setTimeout(() => { throw e; }); }); }
  cancel() { /* not cancellable */ }
  log(name?: string) { return this.then((v) => { console.log(name || 'Promise resolved', v); return v; }); }
  delay(ms: number) { return this.then((v) => new ExtPromise((r) => setTimeout(() => r(v), ms))); }
  timeout(ms: number) { return ExtPromise.race([this, new ExtPromise((_, rej) => setTimeout(() => rej(new Error('Promise timeout')), ms))]); }
  static is(v: any) { return !!v && typeof v.then === 'function'; }
}
(ExtPromise as any).defer = function () {
  let resolve, reject;
  const promise = new ExtPromise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
Ext.Promise = ExtPromise;
Ext.Deferred = {
  resolved: (v?: any) => ExtPromise.resolve(v),
  rejected: (e?: any) => ExtPromise.reject(e),
  all: (a: any[]) => ExtPromise.all(a),
  any: (a: any[]) => (ExtPromise as any).any(a),
  delay: (ms: number, v?: any) => new ExtPromise((r) => setTimeout(() => r(v), ms))
};
Ext.ClassManager.classes['Ext.Promise'] = ExtPromise;
Ext.ClassManager.classes['Ext.Deferred'] = Ext.Deferred;

export { ExtPromise };
