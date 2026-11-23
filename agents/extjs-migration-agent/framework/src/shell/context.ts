import { createContext, useContext } from 'react';
import type { ApiClient } from '../api/client';
import type { DisplayMeta, Navigation, Params, SessionInfo } from '../types';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** What any display (and the Ext bridge) can ask of the shell. */
export interface ShellApi {
  /** the application's backend */
  api: ApiClient;
  session: SessionInfo;
  /** the current token (it changes when the session is refreshed) */
  token(): string | null;
  can(permission?: string | null): boolean;
  navigation: Navigation;
  /** open a registered display; returns false when the user may not open it */
  open(displayId: string, params?: Record<string, unknown>, action?: string | null): boolean;
  /** find a display by a value in its config, e.g. findDisplay('screenKey', 'contracts') */
  findDisplay(configKey: string, value: unknown): DisplayMeta | undefined;
  notify(message: string, kind?: ToastKind): void;
  /** tell other displays that records of an entity changed (summaries reload) */
  emit(event: string, detail?: unknown): void;
  on(event: string, handler: (detail: unknown) => void): () => void;
  signOut(reason?: string): void;
}

/** What one open display can do to itself. */
export interface DisplayFrame {
  tabId: string;
  close(): void;
  setTitle(title: string): void;
  /** swap the parameters, e.g. after a new record is saved and gets its id */
  replaceParams(params: Params): void;
  /** true when this display is the visible one */
  active: boolean;
}

export const ShellContext = createContext<ShellApi | null>(null);
export const FrameContext = createContext<DisplayFrame | null>(null);

export function useShell(): ShellApi {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell must be used inside the application shell');
  return s;
}

export function useFrame(): DisplayFrame {
  const f = useContext(FrameContext);
  if (!f) throw new Error('useFrame must be used inside a display');
  return f;
}
