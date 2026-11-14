// Eventos de dados que o notch e a janela em tela cheia escutam igual: as duas mostram o mesmo app.
// O que é só do notch (abrir/fechar, sons, cards de atenção) fica no App.
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { api } from './api';

export function bindDataEvents(): () => void {
  const offs = [
    api.on('ui:paused', (paused) => {
      const s = useData.getState().settings;
      if (s) useData.getState().set({ settings: { ...s, paused } });
    }),
    api.on('ui:mini', (mini) => {
      const s = useData.getState().settings;
      if (s) useData.getState().set({ settings: { ...s, mini } });
    }),
    api.on('card:dismiss', ({ id }) => useUi.getState().dropCard(id)),
    api.on('mascot:react', ({ state, ms }) => useUi.getState().react(state, ms)),
    api.on('mascot:say', ({ text, ms }) => useUi.getState().say(text, ms)),
    api.on('claude:status', (claude) => useData.getState().set({ claude })),
    api.on('tasks:changed', () => void useData.getState().refreshTasks()),
    api.on('stats:changed', (stats) => useData.getState().set({ stats })),
    api.on('activity:current', (activity) => useData.getState().set({ activity })),
    api.on('toast:show', (toast) => useUi.getState().pushToast(toast)),
    api.on('meeting:active', (inMeeting) => useData.getState().set({ inMeeting })),
    api.on('integrations:changed', (integrations) => useData.getState().set({ integrations })),
    api.on('music:nowPlaying', (nowPlaying) => useData.getState().set({ nowPlaying })),
    api.on('day:today', (today) => useData.getState().set({ today })),
    api.on('stripe:income', (income) => useData.getState().set({ income })),
    api.on('mood:changed', (mood) => useData.getState().set({ mood })),
    api.on('streak:changed', (streak) => useData.getState().set({ streak })),
  ];
  return () => offs.forEach((off) => off());
}

/** Esta página é o Pipo em tela cheia (janela normal), não o notch? */
export const isFullApp = (): boolean => document.documentElement.classList.contains('full-app');
