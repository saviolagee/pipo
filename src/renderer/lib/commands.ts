// Comandos com "/" no chat. O app resolve na hora, sem passar pelo agente.
import { parseDateRange } from '@shared/holidays';
import type { DayKind } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { useUi } from '../store/ui';
import { api } from './api';

export interface SlashCommand {
  name: string;
  /** Exemplo de uso mostrado no autocompletar. */
  usage: string;
  hint: string;
  run: (args: string) => Promise<void>;
}

const br = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const toast = (text: string): void => useUi.getState().pushToast({ id: `cmd:${Date.now()}`, text, durationMs: 5000 });

function markDays(kind: DayKind, label: string, defaultArgs: string): (args: string) => Promise<void> {
  return async (args) => {
    const range = parseDateRange(args.trim() || defaultArgs);
    if (!range) {
      toast(t.days.notUnderstood);
      return;
    }
    await api.invoke('days:setRange', range.start, range.end, kind, null);
    toast(range.start === range.end ? t.days.markedOne(label, br(range.start)) : t.days.markedRange(label, br(range.start), br(range.end)));
  };
}

export const COMMANDS: SlashCommand[] = [
  { name: 'ferias', usage: '/ferias 10 a 20 de dez', hint: t.days.cmdVacation, run: markDays('vacation', t.days.kinds.vacation, '') },
  { name: 'folga', usage: '/folga amanhã', hint: t.days.cmdOff, run: markDays('off', t.days.kinds.off, 'hoje') },
  { name: 'doente', usage: '/doente', hint: t.days.cmdSick, run: markDays('sick', t.days.kinds.sick, 'hoje') },
];

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "/ferias 10 a 20 de dez" → comando + argumentos. */
export function matchCommand(text: string): { cmd: SlashCommand; args: string } | null {
  const m = /^\/(\S+)\s*(.*)$/s.exec(text.trim());
  if (!m) return null;
  const cmd = COMMANDS.find((c) => c.name === norm(m[1]));
  return cmd ? { cmd, args: m[2] } : null;
}

/** Sugestões para o autocompletar enquanto digita "/…". */
export function suggestCommands(text: string): SlashCommand[] {
  const m = /^\/(\S*)$/.exec(text.trim());
  if (!m) return [];
  return COMMANDS.filter((c) => c.name.startsWith(norm(m[1])));
}
