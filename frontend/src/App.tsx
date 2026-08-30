import { useCallback, useEffect, useState } from 'react';
import { fetchMe, type MeResponse } from './api';

type AuthState =
  | { status: 'loading' }
  | { status: 'loggedOut' }
  | { status: 'loggedIn'; user: MeResponse };

function errorParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('error');
}

export default function App() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [error] = useState<string | null>(errorParam);

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const me = await fetchMe();
      setState(me ? { status: 'loggedIn', user: me } : { status: 'loggedOut' });
    } catch (err) {
      setState({ status: 'loggedOut' });
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state.status === 'loading') {
    return (
      <div className="card">
        <p className="status">Checking session…</p>
      </div>
    );
  }

  if (state.status === 'loggedOut') {
    // Full-page navigation so the OAuth cookie/state flow runs against the backend.
    const login = () => {
      window.location.href = '/auth/github/login';
    };
    return (
      <div className="card">
        <h1>RepoPulse</h1>
        <p className="subtitle">GitHub engineering health dashboard</p>
        {error && (
          <div className="error">Login failed: {error}. Please try again.</div>
        )}
        <button type="button" className="login" onClick={login}>
          Login with GitHub
        </button>
      </div>
    );
  }

  const { user } = state;
  const initials = user.username.slice(0, 2).toUpperCase();
  return (
    <div className="card">
      <h1>RepoPulse</h1>
      <p className="subtitle">GitHub engineering health dashboard</p>
      <div className="profile">
        <div className="avatar">{initials}</div>
        <div>
          <div style={{ fontWeight: 600 }}>Logged in as {user.username}</div>
          <div className="subtitle" style={{ margin: 0 }}>
            {user.email ?? 'no public email'}
          </div>
        </div>
      </div>
      <button type="button" className="connect" disabled title="Coming soon">
        Connect a repo
      </button>
      <p className="status">
        Repo health metrics land here in Day&nbsp;2.
      </p>
    </div>
  );
}