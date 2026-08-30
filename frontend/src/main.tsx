import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Leaderboard from './Leaderboard';
import './index.css';

/**
 * Lightweight path-based router. Full navigation to and from /leaderboard
 * triggers a full page load (the links below use plain <a href>), so the
 * pathname is stable across renders within the same mount.
 */
function Root() {
  const [pathname] = useState(() => window.location.pathname);
  return pathname === '/leaderboard' ? <Leaderboard /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);