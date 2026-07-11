import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// TypeScript global declaration for window.metardu (set by preload.ts)
declare global {
  interface Window {
    metardu: import('../../electron/preload.js').MetarduApi;
  }
}
