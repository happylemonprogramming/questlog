import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { watchMilestones } from './lib/celebrate';
import './lib/desktop';

watchMilestones();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lets the app install to a home screen and open offline. Not in dev, where
// a cached build would shadow live edits.
// The desktop app ships its files with it, so it needs no service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.questlogDesktop) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
