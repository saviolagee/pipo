// Lê o app e a janela em foco a cada 5s, localmente (seção 9.5). Nada sai da máquina.
import { app, powerMonitor } from 'electron';
import { ACTIVITY } from '@shared/config';
import type { CurrentActivity } from '@shared/types';
import { emit } from '../bus';
import { listClients } from '../db/repos/clients';
import { getSettings } from '../db/repos/settings';
import { macPermissions } from '../system';
import { classify, isIgnored } from './classifier';
import { BlockRecorder, type Reading } from './recorder';

type ActiveWindowFn = (opts?: { accessibilityPermission?: boolean; screenRecordingPermission?: boolean }) => Promise<
  { title: string; owner: { name: string; processId: number }; url?: string } | undefined
>;

let activeWindow: ActiveWindowFn | null = null;
let loadFailed = false;
let timer: NodeJS.Timeout | null = null;
let lastEmitted = '';

export const recorder = new BlockRecorder((r) => {
  const s = getSettings();
  return classify({ distractions: s.distractions.items, allowed: s.distractions.allowed, clients: listClients() }, r.app, r.title, r.url);
});

/** Ouvintes de cada leitura (guardião de distração, reunião, contexto). */
export const activityListeners: Array<(a: CurrentActivity | null, distraction: string | null) => void> = [];

/** Fonte alternativa de leituras (testes/simulação no painel de debug). */
let fakeSource: (() => Reading | null) | null = null;
export function setFakeActivitySource(fn: (() => Reading | null) | null): void {
  fakeSource = fn;
}

async function readWindow(): Promise<Reading | null> {
  if (fakeSource) return fakeSource();
  if (!activeWindow && !loadFailed) {
    try {
      const mod = (await import('get-windows')) as { activeWindow: ActiveWindowFn };
      activeWindow = mod.activeWindow;
    } catch (e) {
      loadFailed = true;
      console.warn('[atividade] get-windows indisponível; o registro usará só as sessões de foco.', e);
    }
  }
  if (!activeWindow) return null;
  try {
    const perms = macPermissions();
    // Sem as permissões do macOS, registra só o nome do app (sem título/URL) e não pede nada.
    const w = await activeWindow({ accessibilityPermission: perms.accessibility, screenRecordingPermission: perms.screen });
    if (!w) return null;
    if (w.owner.processId === process.pid || w.owner.name === app.getName() || w.owner.name === 'Electron') return { app: '__self__', title: '', url: null };
    return { app: w.owner.name, title: w.title ?? '', url: w.url ?? null };
  } catch {
    return null;
  }
}

function publish(): void {
  const cur = recorder.current();
  const key = cur ? `${cur.app}|${cur.title}|${cur.category}` : '';
  for (const l of activityListeners) l(cur, recorder.currentDistraction());
  if (key !== lastEmitted) {
    lastEmitted = key;
    emit('activity:current', cur);
  }
}

async function poll(): Promise<void> {
  const s = getSettings();
  const now = Date.now();
  if (s.privacy.trackingPaused || s.paused) {
    recorder.stop();
    return publish();
  }
  const idleSec = fakeSource ? 0 : powerMonitor.getSystemIdleTime();
  // O tempo só conta com mouse/teclado em uso. Vídeo rodando sem mexer em nada não conta;
  // reunião (Zoom, Meet, Teams…) conta mesmo parado.
  const limit = s.activity?.idleAfterSec ?? ACTIVITY.idleThresholdSec;
  const inMeeting = recorder.current()?.category === 'meeting';
  if (idleSec >= limit && !inMeeting) {
    recorder.idle(now, now - idleSec * 1000);
    return publish();
  }
  const r = await readWindow();
  if (!r) return publish();
  if (r.app === '__self__') {
    // Interagir com o próprio Pipo não muda o bloco atual.
    const cur = recorder.current();
    if (cur) recorder.ingest({ app: cur.app, title: cur.title, url: cur.url }, now);
    return publish();
  }
  if (isIgnored(s.privacy.ignoredApps, r.app)) {
    recorder.stop();
    return publish();
  }
  recorder.ingest(r, now);
  publish();
}

export function startTracker(): void {
  if (timer) return;
  timer = setInterval(() => void poll(), ACTIVITY.pollMs);
  powerMonitor.on('suspend', () => recorder.stop());
  powerMonitor.on('lock-screen', () => recorder.stop());
}

export function currentActivity(): CurrentActivity | null {
  return recorder.current();
}
