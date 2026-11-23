/**
 * Small fetch wrapper used by the shell and by generated services.
 *
 * Every call sends the signed-in user's token and a correlation id, times out, and understands the two common
 * response shapes: a bare JSON value, or an envelope { success, data, message, errors }.
 */

export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string> | null;
  correlationId: string;
  constructor(message: string, status: number, fieldErrors: Record<string, string> | null, correlationId: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.correlationId = correlationId;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null;
  /** called on 401 so the shell can send the user back to sign-in */
  onUnauthorized?: (err: ApiError) => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /** return the whole envelope instead of its data member (to read totals) */
  raw?: boolean;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T = any>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  get<T = any>(path: string, params?: RequestOptions['params'], opts?: RequestOptions): Promise<T>;
  post<T = any>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = any>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = any>(path: string, opts?: RequestOptions): Promise<T>;
  baseUrl: string;
}

const newId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export function joinUrl(base: string, path: string, params?: RequestOptions['params']): string {
  let url = base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
  const q = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (q.length) url += (url.includes('?') ? '&' : '?') + q.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
  return url;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const timeout = options.timeoutMs ?? 30000;
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const correlationId = newId();
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Correlation-Id': correlationId, ...(opts.headers || {}) };
    const token = options.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    opts.signal?.addEventListener('abort', () => ctrl.abort());
    let res: Response;
    try {
      res = await doFetch(joinUrl(options.baseUrl, path, opts.params), { method, headers, body, signal: ctrl.signal });
    } catch (e: any) {
      const msg = ctrl.signal.aborted && !opts.signal?.aborted ? `The server did not answer within ${Math.round(timeout / 1000)} s` : `Cannot reach the server (${e?.message || e})`;
      throw new ApiError(msg, 0, null, correlationId);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    const envelope = json && typeof json === 'object' && !Array.isArray(json) && ('success' in json || 'data' in json);
    if (!res.ok || (envelope && json.success === false)) {
      const message = (json && (json.message || json.detail)) || `Request failed (${res.status} ${res.statusText})`;
      const err = new ApiError(typeof message === 'string' ? message : JSON.stringify(message), res.status,
        (json && json.errors && !Array.isArray(json.errors) ? json.errors : null), correlationId);
      if (res.status === 401) options.onUnauthorized?.(err);
      throw err;
    }
    if (opts.raw) return json as T;
    return (envelope ? json.data : json) as T;
  }

  return {
    baseUrl: options.baseUrl,
    request,
    get: (path, params, opts) => request('GET', path, { ...opts, params }),
    post: (path, body, opts) => request('POST', path, { ...opts, body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    del: (path, opts) => request('DELETE', path, opts),
  };
}
