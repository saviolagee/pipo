// Google Agenda: eventos de hoje e dos próximos 7 dias (sync a cada 5 min), blocos de foco e link de reunião.
import type { CalendarEvent } from '@shared/types';
import { googleConnected, googleFetch } from './google-auth';

interface GEvent {
  id: string;
  summary?: string;
  status?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  hangoutLink?: string;
  location?: string;
  description?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  transparency?: string;
}

const MEETING_URL = /https?:\/\/(?:[\w-]+\.)?(?:meet\.google\.com\/[a-z0-9-]+|zoom\.us\/(?:j|my|w)\/[\w?=&./-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+|teams\.live\.com\/meet\/[^\s"<>]+)/i;

/** Extrai o link de Meet/Zoom/Teams do evento. Exportado para testes. */
export function meetingUrlOf(e: Pick<GEvent, 'hangoutLink' | 'conferenceData' | 'location' | 'description'>): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  if (video) return video;
  for (const text of [e.location, e.description]) {
    const m = text ? MEETING_URL.exec(text) : null;
    if (m) return m[0];
  }
  return null;
}

/** Converte e filtra (sem dia inteiro, sem recusados, sem "disponível"). Exportado para testes. */
export function mapEvents(items: GEvent[]): CalendarEvent[] {
  return items
    .filter((e) => e.status !== 'cancelled' && e.start.dateTime && e.end.dateTime)
    .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === 'declined'))
    .filter((e) => e.transparency !== 'transparent')
    .map((e) => ({ id: e.id, title: e.summary ?? '(sem título)', start: new Date(e.start.dateTime as string).toISOString(), end: new Date(e.end.dateTime as string).toISOString(), meetingUrl: meetingUrlOf(e) }));
}

let cache: { at: number; events: CalendarEvent[] } = { at: 0, events: [] };

export async function listEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
  const r = await googleFetch<{ items: GEvent[] }>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q.toString()}`);
  return mapEvents(r.items ?? []);
}

/** Hoje + 7 dias, em cache (atualizado pelo agendador a cada 5 min). */
export async function syncCalendar(): Promise<CalendarEvent[]> {
  if (!googleConnected()) {
    cache = { at: Date.now(), events: [] };
    return [];
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 8 * 86_400_000);
  cache = { at: Date.now(), events: await listEvents(start.toISOString(), end.toISOString()) };
  return cache.events;
}

export function cachedEvents(): CalendarEvent[] {
  return cache.events;
}

export async function createBlock(b: { title: string; start: string; end: string; recurrence?: string }): Promise<CalendarEvent> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: b.title,
    description: 'Bloco criado pelo Pipo.',
    start: { dateTime: new Date(b.start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(b.end).toISOString(), timeZone: tz },
    ...(b.recurrence ? { recurrence: [b.recurrence] } : {}),
    colorId: '9',
    reminders: { useDefault: false, overrides: [] },
  };
  const e = await googleFetch<GEvent>('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });
  void syncCalendar().catch(() => undefined);
  return mapEvents([e])[0] ?? { id: e.id, title: b.title, start: b.start, end: b.end, meetingUrl: null };
}

/** Minutos de reunião e próxima reunião num intervalo (a partir do cache). */
export function meetingsBetween(start: string, end: string): { meetingMin: number; next: CalendarEvent | null } {
  const s = Date.parse(start);
  const e = Date.parse(end);
  const now = Date.now();
  let min = 0;
  let next: CalendarEvent | null = null;
  for (const ev of cache.events) {
    const a = Math.max(s, Date.parse(ev.start));
    const b = Math.min(e, Date.parse(ev.end));
    if (b > a) min += (b - a) / 60_000;
    if (Date.parse(ev.start) > now && Date.parse(ev.start) < e && (!next || Date.parse(ev.start) < Date.parse(next.start))) next = ev;
  }
  return { meetingMin: min, next };
}

/** Há uma reunião (com link) acontecendo agora? */
export function meetingNow(): boolean {
  const now = Date.now();
  return cache.events.some((ev) => ev.meetingUrl && Date.parse(ev.start) <= now && Date.parse(ev.end) > now);
}
