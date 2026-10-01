import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import { App } from './App';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Acesso aos stores para o painel de debug e scripts de validação visual.
import { useUi } from './store/ui';
import { useData } from './store/data';
(window as unknown as { __pipo: unknown }).__pipo = { ui: useUi, data: useData };
