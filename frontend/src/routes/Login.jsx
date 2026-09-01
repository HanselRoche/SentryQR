import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../lib/auth.jsx';

// Demo fixtures matching backend/src/db/seed.js — one-click login keeps the
// live demo moving instead of stopping to type credentials.
const DEMO = [
  { label: 'Student', username: 's.aisha', password: 'student12345' },
  { label: 'Guard', username: 'guard.ramesh', password: 'guard12345' },
  { label: 'Admin', username: 'admin', password: 'admin12345' },
];

export default function Login() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate(homeFor(user.role), { replace: true });
  }, [user, loading, navigate]);

  const submit = async (event, credentials) => {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const account = credentials ?? { username, password };
      const loggedIn = await login(account.username, account.password);
      navigate(homeFor(loggedIn.role), { replace: true });
    } catch (err) {
      setError(
        err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : err.message || 'Login failed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>
          Sentry<span>QR</span>
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Secure hostel entry — dynamic, signed, single-use QR credentials.
        </p>

        {error && <div className="alert error">{error}</div>}

        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="demo-accounts">
          Demo accounts:
          <div>
            {DEMO.map((account) => (
              <button
                key={account.username}
                type="button"
                disabled={busy}
                onClick={(e) => submit(e, account)}
              >
                {account.label}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
