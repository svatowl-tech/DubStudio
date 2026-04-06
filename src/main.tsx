import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import DebugConsole from './components/DebugConsole.tsx';
import './index.css';

const isDebug = window.location.hash === '#/debug';

window.addEventListener('error', (event) => {
  if (window.electronAPI && window.electronAPI.send) {
    window.electronAPI.send('log-error', event.error ? event.error.stack : event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (window.electronAPI && window.electronAPI.send) {
    window.electronAPI.send('log-error', event.reason ? event.reason.stack : 'Unhandled Rejection');
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDebug ? <DebugConsole /> : <App />}
  </StrictMode>,
);
