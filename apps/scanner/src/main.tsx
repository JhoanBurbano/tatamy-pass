import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { setupPwa } from './pwa.js';
import './styles.css';

// Service worker solo en build (en dev Vite sirve los módulos sueltos).
setupPwa({ register: import.meta.env.PROD });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
