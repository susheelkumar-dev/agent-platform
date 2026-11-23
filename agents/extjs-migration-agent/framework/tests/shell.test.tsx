/**
 * The shell end to end in jsdom: sign-in, a menu built only from the registry's answer, opening displays,
 * unknown implementations and forbidden deep links.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FrameworkApp, defineDisplays, useShell } from '../src';
import type { Navigation } from '../src/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function Hello({ meta, params }: any) {
  const shell = useShell();
  return <div data-testid="hello">Hello {meta.title} {params.id ?? ''} as {shell.session.user.username}</div>;
}
const displays = defineDisplays({ Hello: { load: async () => ({ default: Hello }) } });

const NAV: Navigation = {
  app: 'demo', user: 'ann', etag: 'e1',
  menu: [
    { id: 'home', title: 'Home', display: 'home' },
    { id: 'ref', title: 'Reference', children: [
      { id: 'ref.cp', title: 'Counterparties', display: 'cp.summary' },
      { id: 'ref.ghost', title: 'Ghost', display: 'ghost' },
    ] },
  ],
  displays: {
    home: { id: 'home', title: 'Home', type: 'custom', key: 'Hello', route: 'd/home', openMode: 'tab', params: [], config: {}, module: 'm', requiredPermissions: [], actions: {} },
    'cp.summary': { id: 'cp.summary', title: 'Counterparties', type: 'summary', key: 'Hello', route: 'reference/counterparties', openMode: 'tab', params: [], config: {}, module: 'm', requiredPermissions: [], actions: {} },
    ghost: { id: 'ghost', title: 'Ghost', type: 'custom', key: 'NotBundled', route: 'd/ghost', openMode: 'tab', params: [], config: {}, module: 'm', requiredPermissions: [], actions: {} },
  },
};

const calls: string[] = [];
function fakeFetch(url: string, init: RequestInit) {
  calls.push(`${init.method} ${url}`);
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  if (url === '/api/auth/login') {
    const body = JSON.parse(String(init.body));
    if (body.password !== 'right-password-1') return json(401, { success: false, message: 'Wrong username or password' });
    return json(200, { success: true, data: { token: 'tok', expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: { username: 'ann', fullName: 'Ann', roles: ['Trader'] }, permissions: ['x.view'] } });
  }
  const auth = (init.headers as Record<string, string>).Authorization;
  if (auth !== 'Bearer tok') return json(401, { message: 'Sign in required' });
  if (url === '/registry/api/v1/apps/demo/navigation') return json(200, NAV);
  if (url === '/registry/api/v1/apps/demo/displays/secret') return json(403, { message: 'no' });
  return json(404, { message: 'not found' });
}

let root: Root;
let host: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = () => host.textContent || '';
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label));

beforeEach(() => {
  sessionStorage.clear();
  window.location.hash = '';
  (globalThis as any).fetch = vi.fn(fakeFetch as any);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function signIn(password = 'right-password-1') {
  await act(async () => {
    root.render(<FrameworkApp config={{ appId: 'demo', title: 'Demo App', apiBase: '/api', registryBase: '/registry/api/v1', home: 'home' }} displays={displays} />);
  });
  const input = (id: string, value: string) => {
    const el = host.querySelector<HTMLInputElement>(id)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => { input('#xf-username', 'ann'); input('#xf-password', password); });
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
}

it('signs in, renders the server menu and opens the home display', async () => {
  await signIn('wrong-password-1');
  expect(text()).toContain('Wrong username or password');
  await signIn();
  expect(text()).toContain('Ann');
  expect(button('Home')).toBeTruthy();
  expect(button('Reference')).toBeTruthy();
  expect(text()).toContain('Hello Home  as ann');
  expect(window.location.hash).toBe('#/d/home');
  expect(calls).toContain('GET /registry/api/v1/apps/demo/navigation');
});

it('opens displays from folders, reuses tabs and contains unknown implementations', async () => {
  await signIn();
  await click(button('Reference'));
  await click(button('Counterparties'));
  expect(window.location.hash).toBe('#/reference/counterparties');
  expect(text()).toContain('Hello Counterparties');
  await click(button('Reference'));
  await click(button('Counterparties'));
  expect(host.querySelectorAll('[role=tab]').length).toBe(2);
  await click(button('Reference'));
  await click(button('Ghost'));
  expect(text()).toContain('which this build of the application does not include');
});

it('explains forbidden and unknown deep links', async () => {
  await signIn();
  await act(async () => { window.location.hash = '#/d/secret'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await flush();
  expect(text()).toContain('No access');
  await act(async () => { window.location.hash = '#/d/nothing'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await flush();
  expect(text()).toContain('Page not found');
  await click(button('Sign out'));
  expect(host.querySelector('#xf-username')).toBeTruthy();
});
