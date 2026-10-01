import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import { App } from './App';
import { DashboardApp } from './dashboard/DashboardApp';

// A mesma página serve o notch e a janela de dashboards (?view=dashboard).
const isDashboard = new URLSearchParams(location.search).get('view') === 'dashboard';
if (isDashboard) document.documentElement.classList.add('dashboard');

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode>{isDashboard ? <DashboardApp /> : <App />}</StrictMode>);

// Acesso aos stores para o painel de debug e scripts de validação visual.
import { useUi } from './store/ui';
import { useData } from './store/data';
import { useChat } from './store/chat';
import { usePipos } from './store/pipos';
import { preloadWhisper, whisperListeners } from './voice/recorder';
(window as unknown as { __pipo: unknown }).__pipo = { ui: useUi, data: useData, chat: useChat, pipos: usePipos, voice: { preloadWhisper, whisperListeners } };
