/**
 * Renders one registered display: resolves its key in the approved registry, loads it lazily, and contains
 * loading and failure so one broken display never takes the whole application down.
 */
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import type { DisplayMeta, DisplayRegistry, Params } from '../types';
import { resolveDisplay } from './registry';

class Boundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Display "${this.props.title}" failed`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <Problem title={`“${this.props.title}” stopped working`}>
          <p>{this.state.error.message}</p>
          <button type="button" className="xf-btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </Problem>
      );
    }
    return this.props.children;
  }
}

export function Problem({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="xf-problem" role="alert">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="xf-loading" role="status" aria-live="polite"><span className="xf-spinner" aria-hidden="true" />{label}</div>;
}

export function DisplayHost({ registry, meta, params, action, actionId }: { registry: DisplayRegistry; meta: DisplayMeta; params: Params; action?: string; actionId?: number }) {
  const missing = meta.params.filter((p) => p.required && !(p.name in params)).map((p) => p.name);
  if (missing.length) {
    return <Problem title={`“${meta.title}” cannot open`}><p>It needs {missing.join(', ')}.</p></Problem>;
  }
  const r = resolveDisplay(registry, meta);
  if (!r.ok || !r.component) return <Problem title="This page is not available"><p>{r.message}</p></Problem>;
  const View = r.component;
  return (
    <Boundary title={meta.title}>
      <Suspense fallback={<Loading label={`Loading ${meta.title}…`} />}>
        <View meta={meta} params={params} action={action} actionId={actionId} />
      </Suspense>
    </Boundary>
  );
}
