import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';

export function LoginPage({ title, subtitle }: { title: string; subtitle?: string }) {
  const { login, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) { setError('Enter your username and password.'); return; }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xf-login">
      <form className="xf-login-card" onSubmit={submit} aria-labelledby="xf-login-title" noValidate>
        <h1 id="xf-login-title">{title}</h1>
        {subtitle && <p className="xf-muted">{subtitle}</p>}
        {notice && <p className="xf-notice" role="status">{notice}</p>}
        <label htmlFor="xf-username">Username</label>
        <input id="xf-username" name="username" autoComplete="username" autoFocus value={username}
          onChange={(e) => setUsername(e.target.value)} disabled={busy} />
        <label htmlFor="xf-password">Password</label>
        <input id="xf-password" name="password" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        {error && <p className="xf-error" role="alert">{error}</p>}
        <button type="submit" className="xf-btn xf-btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
