import type { Goal, GoalAction } from '@shared/trail';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { play } from '../sound/sfx';
import { useChat } from '../store/chat';
import { useUi } from '../store/ui';

/** Conclui a ação e comemora: um passo na trilha ou, se era a última, o plano inteiro. */
export async function completeAction(action: GoalAction): Promise<Goal> {
  const goal = await api.invoke('goals:setDone', action.id, true);
  const ui = useUi.getState();
  if (goal.status === 'done') {
    ui.react('celebrating', 2600);
    ui.confetti(40);
    ui.say(t.trail.goalDone, 4000);
  } else {
    ui.react('happy', 900);
    ui.confetti(10);
    ui.say(t.trail.cheers[Math.floor(Math.random() * t.trail.cheers.length)], 2500);
  }
  play('chime');
  return goal;
}

/** Abre uma conversa nova com o Pipo branco: já enviando o pedido ou só com o começo da mensagem pronto. */
export function askPipo(text: string, send: boolean): void {
  useUi.getState().setTab('chat');
  useChat.getState().newConversation();
  if (send) void useChat.getState().send(text);
  else useUi.setState({ chatDraft: text });
}
