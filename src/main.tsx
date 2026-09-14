import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MobileDemo from './components/MobileDemo';
import './index.css';

// Simple router: mobile viewer at hash #/m or #/mobile, or path /m or /mobile.
// Hash routing is primary (works on GitHub Pages with no server config).
function isMobileRoute(): boolean {
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  if (hash === 'm' || hash === 'mobile') return true;
  const path = window.location.pathname.replace(/\/+$/, '');
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const rel = path.startsWith(base) ? path.slice(base.length) : path;
  return rel === '/m' || rel === '/mobile' || rel === 'm' || rel === 'mobile';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isMobileRoute() ? <MobileDemo /> : <App />}
  </React.StrictMode>,
);
