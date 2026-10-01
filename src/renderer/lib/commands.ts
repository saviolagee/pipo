// Comandos com "/" no chat. O app resolve na hora, sem passar pelo agente.
import { parseDateRange } from '@shared/holidays';
import type { DayKind } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { useChat } from '../store/chat';
import { usePipos } from '../store/pipos';
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

/** /criarpipo [descrição | novo]: abre (ou retoma) a conversa de criação com o Pipo branco. */
async function createPipo(args: string): Promise<void> {
  const a = args.trim();
  const fresh = /^novo$/i.test(a);
  const r = await api.invoke('pipos:startDraft', { fresh });
  useUi.getState().setTab('chat');
  await useChat.getState().openConversation(r.conversationId);
  if (r.resumed) {
    toast(t.team.resumed(r.name));
    return;
  }
  await useChat.getState().send(a && !fresh ? a : t.team.createFirstMessage);
}

function findPipo(arg: string): { id: number; name: string; slug: string } | null {
  const k = norm(arg.replace(/^@/, '').trim());
  if (!k) return null;
  const list = usePipos.getState().list;
  return list.find((p) => p.slug === k) ?? list.find((p) => norm(p.name) === k) ?? list.find((p) => norm(p.name).includes(k) || p.slug.includes(k)) ?? null;
}

function withPipo(fn: (p: { id: number; name: string; slug: string }, rest: string) => Promise<void>): (args: string) => Promise<void> {
  return async (args) => {
    const [first, ...rest] = args.trim().split(/\s+/);
    const p = findPipo(first ?? '');
    if (!p) {
      toast(first ? t.team.notFound(first) : t.team.whichPipo);
      return;
    }
    await fn(p, rest.join(' '));
  };
}

export const COMMANDS: SlashCommand[] = [
  { name: 'criarpipo', usage: '/criarpipo', hint: t.team.cmdCreate, run: createPipo },
  {
    name: 'editarpipo',
    usage: '/editarpipo nome',
    hint: t.team.cmdEdit,
    run: withPipo(async (p, rest) => {
      const r = await api.invoke('pipos:startDraft', { editSlug: p.slug });
      useUi.getState().setTab('chat');
      await useChat.getState().openConversation(r.conversationId);
      if (!r.resumed) await useChat.getState().send(rest || t.team.editFirstMessage(p.name));
    }),
  },
  {
    name: 'equipe',
    usage: '/equipe',
    hint: t.team.cmdTeam,
    run: async () => useUi.getState().setTab('team'),
  },
  {
    name: 'rodar',
    usage: '/rodar nome',
    hint: t.team.cmdRun,
    run: withPipo(async (p) => {
      try {
        await api.invoke('pipos:run', p.id, { trigger: 'chat' });
        toast(t.team.running(p.name));
      } catch (e) {
        toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
      }
    }),
  },
  {
    name: 'pausar',
    usage: '/pausar nome',
    hint: t.team.cmdPause,
    run: withPipo(async (p) => {
      await api.invoke('pipos:update', p.id, { paused: true });
      toast(t.team.pausedToast(p.name));
    }),
  },
  {
    name: 'retomar',
    usage: '/retomar nome',
    hint: t.team.cmdResume,
    run: withPipo(async (p) => {
      await api.invoke('pipos:update', p.id, { paused: false });
      toast(t.team.resumedToast(p.name));
    }),
  },
  { name: 'ferias', usage: '/ferias 10 a 20 de dez', hint: t.days.cmdVacation, run: markDays('vacation', t.days.kinds.vacation, '') },
  { name: 'folga', usage: '/folga amanhã', hint: t.days.cmdOff, run: markDays('off', t.days.kinds.off, 'hoje') },
  { name: 'doente', usage: '/doente', hint: t.days.cmdSick, run: markDays('sick', t.days.kinds.sick, 'hoje') },
];

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "@prospector roda", "@prospector rodar agora" → dispara a execução (Fase 19). */
export async function runAtMention(text: string): Promise<boolean> {
  const m = /^@([\w-]+)[,:]?\s+(?:roda|rodar|rode|executa|executar|run)\b(?:\s+agora)?[.!]*$/i.exec(text.trim());
  if (!m) return false;
  await (COMMANDS.find((c) => c.name === 'rodar') as SlashCommand).run(m[1]);
  return true;
}

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
