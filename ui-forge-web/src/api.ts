/** Calls to the UI Forge service. The service token (UI_FORGE_TOKEN) and the app token are kept for the tab. */
import type { Display, Entity, GeneratedFile, Inventory, Issue, PlanResult, ProjectInfo } from './types';

let forgeToken = sessionStorage.getItem('uiforge.token') || '';
let appToken = '';

export const setForgeToken = (t: string) => { forgeToken = t; sessionStorage.setItem('uiforge.token', t); };
export const setAppToken = (t: string) => { appToken = t; };
export const getAppToken = () => appToken;

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (forgeToken) headers['X-UI-Forge-Token'] = forgeToken;
  if (appToken) headers['X-App-Token'] = appToken;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ServiceError(`UI Forge service not reachable (${(e as Error).message})`, 0);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const detail = json?.detail ?? json?.message ?? text ?? res.statusText;
    throw new ServiceError(typeof detail === 'string' ? detail : JSON.stringify(detail), res.status);
  }
  return json as T;
}

export interface Workspace { entities: Entity[]; displays: Display[]; files: Record<string, string>; issues: Issue[] }
export interface PreviewResult { issues: Issue[]; configs: Record<string, any>; metas: Record<string, any>; files: GeneratedFile[] }
export interface StagedFile { root: string; path: string; owner: string; role: string; action: string; exists: boolean }
export interface StageResult { folder: string; previous: string | null; files: StagedFile[]; readme: string }
export interface ChecklistItem { id: string; title: string; status: 'ok' | 'todo' | 'unknown'; detail: string; fix: string }

export const api = {
  project: (refresh = false) => call<{ project: ProjectInfo; inventory: Inventory; version: string; schemaVersion: string; tokenRequired: boolean }>('GET', `/api/project${refresh ? '?refresh=true' : ''}`),
  workspace: () => call<Workspace>('GET', '/api/workspace'),
  preview: (body: { entities: Entity[]; displays: Display[]; replace?: Record<string, string>; focus?: string[]; files?: boolean }) => call<PreviewResult>('POST', '/api/preview', body),
  save: (body: { entities: Entity[]; displays: Display[]; replace?: Record<string, string>; removed?: string[] }) => call<{ saved: string[]; issues: Issue[]; workspace: Workspace }>('POST', '/api/save', body),
  deleteEntity: (name: string) => call<{ deleted: string; note: string }>('DELETE', `/api/entities/${encodeURIComponent(name)}`),
  deleteDisplay: (id: string) => call<{ deleted: string; note: string }>('DELETE', `/api/displays/${encodeURIComponent(id)}`),
  plan: (body: { prune?: boolean; overrides?: Record<string, string> }) => call<{ blocked: boolean; issues: Issue[]; plan?: PlanResult }>('POST', '/api/plan', body),
  apply: (body: { hash: string; force: string[]; prune?: boolean; overrides?: Record<string, string> }) => call<{ result: { written: string[]; skipped: string[]; deleted: string[]; backups: string[]; retired?: string[] }; plan: PlanResult }>('POST', '/api/apply', body),
  session: (user: string, password: string) => call<{ token: string }>('POST', '/api/session', { user, password }),
  register: (dryRun: boolean) => call<{ results: { file: string; status: number; report: any }[] }>('POST', '/api/register', { dryRun }),
  checklist: () => call<{ items: ChecklistItem[] }>('GET', '/api/checklist'),
  test: (kind: 'build' | 'api') => call<{ ok: boolean; output: string }>('POST', `/api/test/${kind}`),
  infer: (endpoint: string) => call<{ count: number; fields: any[] }>('GET', `/api/infer?endpoint=${encodeURIComponent(endpoint)}`),
  parse: (doc: unknown) => call<{ issues: Issue[] }>('POST', '/api/parse', { doc }),
  stage: (displayId: string, overrides?: Record<string, string>) => call<StageResult>('POST', '/api/stage', { displayId, overrides }),
  packageUrl: () => '/api/package',
};
