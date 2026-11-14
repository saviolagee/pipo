import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import { App } from './App';
import { DashboardApp } from './dashboard/DashboardApp';
import { FullApp } from './FullApp';

// A mesma página serve o notch, a janela de dashboards (?view=dashboard) e o Pipo em tela cheia (?view=app).
const view = new URLSearchParams(location.search).get('view');
if (view === 'dashboard') document.documentElement.classList.add('dashboard');
if (view === 'app') document.documentElement.classList.add('full-app');

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode>{view === 'dashboard' ? <DashboardApp /> : view === 'app' ? <FullApp /> : <App />}</StrictMode>);

// Acesso aos stores para o painel de debug e scripts de validação visual.
import { useUi } from './store/ui';
import { useData } from './store/data';
import { useChat } from './store/chat';
import { usePipos } from './store/pipos';
import { useGoals } from './store/goals';
import { preloadWhisper, whisperListeners } from './voice/recorder';
(window as unknown as { __pipo: unknown }).__pipo = { ui: useUi, data: useData, chat: useChat, pipos: usePipos, goals: useGoals, voice: { preloadWhisper, whisperListeners } };
