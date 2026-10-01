// Simulações do painel de debug (Ctrl+Alt+D) para validar cards e reações sem esperar o mundo real.
import { emit } from './bus';
import { showCard } from './cards';
import { createTask } from './db/repos/tasks';
import { interruptions } from './interruptions/manager';
import { simulateMeeting } from './insights/context-reactions';
import { handle } from './ipc';
import { tasksChanged } from './tasks/ipc';

/** Ganchos das fases seguintes (padrões, streak, dados simulados). */
export const debugHooks: Partial<Record<'pattern' | 'unlock' | 'seed4weeks', () => void | Promise<void>>> = {};

export function registerDebug(): void {
  handle('debug:simulate', async (what) => {
    switch (what) {
      case 'meeting':
        simulateMeeting(true);
        setTimeout(() => simulateMeeting(false), 8000);
        break;
      case 'pomodoro_end':
        void showCard({
          kind: 'pomodoro_end',
          glow: 'attention',
          mascot: 'attention',
          label: 'fim do ciclo',
          subject: '25 min · ciclo 2/4',
          buttons: [
            { id: 'continue', label: 'Continuar', kbd: 'N', variant: 'secondary' },
            { id: 'break', label: 'Pausa', kbd: 'Y', variant: 'primary' },
          ],
        });
        break;
      case 'distraction':
        void interruptions.request({
          type: 'distraction',
          queueable: false,
          fallbackExpression: 'looking',
          card: {
            kind: 'distraction',
            glow: 'attention',
            mascot: 'attention',
            label: 'distração no foco',
            subject: 'YouTube há 1 min',
            buttons: [
              { id: 'more', label: 'Mais 5 min', kbd: 'N', variant: 'secondary' },
              { id: 'back', label: 'Voltar ao foco', kbd: 'Y', variant: 'primary' },
              { id: 'allow', label: 'Sempre permitir', variant: 'tertiary' },
            ],
          },
        });
        break;
      case 'deadline': {
        const t = createTask({ title: 'Enviar NF do mês', dueAt: new Date(Date.now() + 90 * 60_000).toISOString(), estimateMin: 15, isToday: true });
        tasksChanged();
        void interruptions.request({
          type: 'deadline',
          card: {
            kind: 'deadline',
            glow: 'attention',
            mascot: 'attention',
            label: 'prazo vencendo',
            subject: `${t.title} · vence em 1h30`,
            buttons: [
              { id: 'tomorrow', label: 'Amanhã', kbd: 'N', variant: 'secondary' },
              { id: 'start', label: 'Começar agora', kbd: 'Y', variant: 'primary' },
            ],
          },
        });
        break;
      }
      case 'goal':
        emit('mascot:react', { state: 'celebrating', ms: 2600 });
        void interruptions.request({
          type: 'goal',
          card: {
            kind: 'goal_reached',
            glow: 'done',
            mascot: 'celebrating',
            label: 'meta batida',
            subject: '6h feitas!',
            buttons: [
              { id: 'more', label: 'Mais um pouco', kbd: 'N', variant: 'secondary' },
              { id: 'close', label: 'Fechar o dia', kbd: 'Y', variant: 'primary' },
            ],
          },
        });
        break;
      default:
        await debugHooks[what]?.();
    }
  });
}
