// Lembretes das atividades do dia: quando avisar e o que dizer. Funções puras; quem agenda e mostra a
// notificação é o main (src/main/reminders.ts).
import { fmtDay } from './trail';

/** Começo do expediente, meio da tarde e perto do fim. */
export type Slot = 'manha' | 'tarde' | 'fim';
export const SLOTS: Slot[] = ['manha', 'tarde', 'fim'];

/** Uma atividade de hoje ainda por fazer. */
export interface TodayItem {
  title: string;
  kind: 'tarefa' | 'trilha';
}

/** Algo que passou para frente: ação da trilha empurrada ou tarefa que venceu. */
export interface PushedItem {
  kind: 'tarefa' | 'trilha';
  title: string;
  /** AAAA-MM-DD de onde saiu (dia da ação ou vencimento da tarefa). */
  from: string;
  /** AAAA-MM-DD para onde foi. */
  to: string;
  goal?: string;
  /** Novo fim do plano (trilha). */
  end?: string | null;
}

export interface ReminderText {
  title: string;
  body: string;
}

/** Minuto do dia em que cada lembrete vale. */
export function slotTimes(startMin: number, endMin: number): Record<Slot, number> {
  const afternoon = startMin + Math.round((endMin - startMin) * 0.6);
  return { manha: startMin, tarde: afternoon, fim: Math.max(afternoon + 30, endMin - 60) };
}

/**
 * O lembrete da vez, ou null. Se o app abriu tarde, só o mais recente vale (os anteriores não
 * acumulam); depois do expediente, nada.
 */
export function dueSlot(nowMin: number, startMin: number, endMin: number, sent: Slot[]): Slot | null {
  if (endMin <= startMin || nowMin < startMin || nowMin >= endMin) return null;
  const at = slotTimes(startMin, endMin);
  const due = SLOTS.filter((s) => nowMin >= at[s]);
  const last = due[due.length - 1];
  if (!last) return null;
  const lastSent = Math.max(-1, ...sent.map((s) => SLOTS.indexOf(s)));
  return SLOTS.indexOf(last) > lastSent ? last : null;
}

const quote = (s: string): string => `“${s.length > 60 ? `${s.slice(0, 59)}…` : s}”`;

/** "A, B e C" (e "e mais N" quando passa de três). */
export function listTitles(items: Array<{ title: string }>, max = 3): string {
  const shown = items.slice(0, max).map((x) => quote(x.title));
  const more = items.length - shown.length;
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}` : (shown[0] ?? '');
  return more > 0 ? `${shown.join(', ')} e mais ${more}` : head;
}

/** Uma linha por plano (as ações dele juntas) e uma para as tarefas que venceram; no máximo três. */
export function pushedLines(pushed: PushedItem[], today: string): string[] {
  const lines: string[] = [];
  const byGoal = new Map<string, PushedItem[]>();
  for (const p of pushed.filter((x) => x.kind === 'trilha')) byGoal.set(p.goal ?? '', [...(byGoal.get(p.goal ?? '') ?? []), p]);
  for (const [goal, list] of byGoal) {
    const end = list[list.length - 1].end;
    if (list.length === 1) lines.push(`${quote(list[0].title)} passou de ${fmtDay(list[0].from, today)} para ${fmtDay(list[0].to, today)}${goal && end ? `; ${quote(goal)} agora termina ${fmtDay(end, today)}` : ''}.`);
    else lines.push(`${list.length} ações ${goal ? `de ${quote(goal)} ` : ''}passaram para frente (${listTitles(list, 2)})${end ? `; o plano agora termina ${fmtDay(end, today)}` : ''}.`);
  }
  const tasks = pushed.filter((x) => x.kind === 'tarefa');
  if (tasks.length === 1) lines.push(`${quote(tasks[0].title)} venceu ${fmtDay(tasks[0].from, today)} e continua em Hoje.`);
  else if (tasks.length > 1) lines.push(`${tasks.length} tarefas venceram e continuam em Hoje: ${listTitles(tasks, 2)}.`);
  return lines.length > 3 ? [...lines.slice(0, 2), 'E mais coisas passaram para frente (veja na trilha e em Tarefas).'] : lines;
}

/** O texto da notificação, ou null quando não há nada a dizer. */
export function reminderText(slot: Slot, items: TodayItem[], pushed: PushedItem[], o: { remind: boolean; pushed: boolean; today: string }): ReminderText | null {
  const moved = o.pushed ? pushedLines(pushed, o.today) : [];
  const n = items.length;
  if (o.remind && n > 0) {
    if (slot === 'manha') return { title: n === 1 ? 'Hoje: 1 atividade' : `Hoje: ${n} atividades`, body: [...moved, listTitles(items)].join('\n') };
    if (slot === 'tarde') return { title: n === 1 ? 'Falta 1 atividade de hoje' : `Faltam ${n} atividades de hoje`, body: [...moved, `Que tal agora: ${quote(items[0].title)}?`].join('\n') };
    return { title: n === 1 ? 'Ainda falta 1 de hoje' : `Ainda faltam ${n} de hoje`, body: [...moved, `${listTitles(items)}. O que não der hoje passa para amanhã.`].join('\n') };
  }
  if (moved.length) return { title: pushed.length === 1 ? 'Uma atividade passou para frente' : `${pushed.length} atividades passaram para frente`, body: moved.join('\n') };
  return null;
}
