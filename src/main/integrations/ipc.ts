import { shell } from 'electron';
import type { CalendarEvent, IntegrationInfo } from '@shared/types';
import { providers } from '../bootstrap';
import { emit } from '../bus';
import { showCard } from '../cards';
import { getIntegration } from '../db/repos/integrations';
import { focusState } from '../focus/session';
import { meetingHooks } from '../insights/context-reactions';
import { handle } from '../ipc';
import { agentHooks } from '../mcp/tools';
import { musicApi, setMusicApi, startMusic } from '../music';
import { connectSpotify, disconnectSpotify, setSpotifyClientId, spotifyApi } from '../music/spotify';
import { every } from '../scheduler';
import { statsHooks, todayStats } from '../stats';
import { cachedEvents, createBlock, listEvents, meetingNow, meetingsBetween, syncCalendar } from './calendar';
import { connectGoogle, disconnectGoogle, googleConnected, setGoogleClient } from './google-auth';
import { unreadEmails } from './gmail';

export function integrationsList(): IntegrationInfo[] {
  return [getIntegration('google').info, getIntegration('spotify').info];
}

function changed(): void {
  emit('integrations:changed', integrationsList());
  emit('stats:changed', todayStats());
}

const reminded = new Map<string, number>();

/** Lembrete de reunião 5 min antes (não gasta orçamento: é um evento que o usuário marcou). */
async function remindMeetings(): Promise<void> {
  const now = Date.now();
  for (const ev of cachedEvents()) {
    const start = Date.parse(ev.start);
    const remindAt = reminded.get(ev.id) ?? start - 5 * 60_000;
    if (remindAt === -1 || now < remindAt || now > start + 60_000) continue;
    reminded.set(ev.id, -1);
    void meetingCard(ev, start);
  }
}

async function meetingCard(ev: CalendarEvent, start: number): Promise<void> {
  const mins = Math.max(0, Math.round((start - Date.now()) / 60_000));
  const answer = await showCard(
    {
      kind: 'meeting',
      glow: 'attention',
      mascot: 'attention',
      label: 'reunião chegando',
      subject: `${ev.title} · ${mins > 0 ? `em ${mins} min` : 'agora'}`,
      buttons: [
        { id: 'snooze', label: 'Adiar 5 min', kbd: 'N', variant: 'secondary' },
        { id: 'join', label: 'Entrar', kbd: 'Y', variant: 'primary' },
      ],
    },
    { timeoutMs: 10 * 60_000 },
  );
  if (answer === 'join') {
    if (ev.meetingUrl) void shell.openExternal(ev.meetingUrl);
    else void shell.openExternal('https://calendar.google.com/calendar/r');
  } else if (answer === 'snooze') reminded.set(ev.id, Date.now() + 5 * 60_000);
}

export function registerIntegrations(): void {
  setMusicApi(spotifyApi);

  const activityMeetings = statsHooks.meetings;
  statsHooks.meetings = (s, e) => (googleConnected() ? meetingsBetween(s, e) : (activityMeetings?.(s, e) ?? { meetingMin: 0, next: null }));
  meetingHooks.calendarMeetingNow = () => googleConnected() && meetingNow();
  // Para o agente, agenda e Gmail só existem com o Google conectado (as ferramentas avisam quando não).
  Object.defineProperties(agentHooks, {
    calendar: { get: () => (googleConnected() ? (from: string, to: string) => listEvents(from, to) : null), configurable: true },
    createBlock: { get: () => (googleConnected() ? (b: { title: string; start: string; end: string; recurrence?: string }) => createBlock(b) : null), configurable: true },
    unreadEmails: { get: () => (googleConnected() ? (max: number) => unreadEmails(max) : null), configurable: true },
  });

  const prevExtra = providers.extra;
  providers.extra = () => ({ ...prevExtra(), integrations: integrationsList() });

  handle('integrations:list', () => integrationsList());
  handle('integrations:connect', async (p) => {
    if (p === 'google') {
      await connectGoogle();
      await syncCalendar().catch(() => undefined);
    } else await connectSpotify();
    changed();
    return getIntegration(p).info;
  });
  handle('integrations:disconnect', (p) => {
    if (p === 'google') disconnectGoogle();
    else disconnectSpotify();
    changed();
    return getIntegration(p).info;
  });
  handle('integrations:setGoogleClient', (cfg) => setGoogleClient(cfg));
  handle('integrations:setSpotifyClient', (cfg) => setSpotifyClientId(cfg.clientId));
  handle('calendar:upcoming', () => cachedEvents());
  handle('music:toggle', async () => {
    const r = (await musicApi()?.toggle().catch(() => null)) ?? null;
    emit('music:nowPlaying', r);
    return r;
  });
  handle('music:nowPlaying', async () => (musicApi()?.isConnected() ? ((await musicApi()?.nowPlaying().catch(() => null)) ?? null) : null));
  handle('music:test', async () => {
    await startMusic();
  });

  every('calendar', 5 * 60_000, async () => {
    if (!googleConnected()) return;
    await syncCalendar();
    emit('stats:changed', todayStats());
  });
  every('meetingReminder', 30_000, remindMeetings);
  // Faixa atual: só durante o foco (CPU/rede em idle).
  every('nowPlaying', 10_000, async () => {
    if (!focusState() || !musicApi()?.isConnected()) return;
    emit('music:nowPlaying', (await musicApi()?.nowPlaying().catch(() => null)) ?? null);
  });
  void syncCalendar().catch(() => undefined);
}
