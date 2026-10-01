// Classificação de blocos de atividade (seção 9.5). Funções puras (testadas em tests/classifier.test.ts).
import type { ActivityCategory, Client } from '@shared/types';

export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Domínios e padrões de título das distrações padrão. */
const KNOWN: Record<string, { hosts: string[]; title: RegExp[] }> = {
  youtube: { hosts: ['youtube.com', 'youtu.be'], title: [/youtube/] },
  instagram: { hosts: ['instagram.com'], title: [/instagram/] },
  'whatsapp web': { hosts: ['web.whatsapp.com'], title: [/whatsapp/] },
  x: { hosts: ['x.com', 'twitter.com'], title: [/\/ x$/, /\bon x\b/, /\btwitter\b/, /\bx\.com\b/] },
  tiktok: { hosts: ['tiktok.com'], title: [/tiktok/] },
  netflix: { hosts: ['netflix.com'], title: [/netflix/] },
  noticias: {
    hosts: ['g1.globo.com', 'uol.com.br', 'folha.uol.com.br', 'estadao.com.br', 'cnnbrasil.com.br', 'metropoles.com', 'terra.com.br', 'r7.com'],
    title: [/\bg1\b/, /\buol\b/, /folha de s\.?paulo/, /estadao/, /cnn brasil/, /metropoles/],
  },
};

const MEETING: { apps: RegExp[]; title: RegExp[]; hosts: string[] } = {
  apps: [/^zoom/, /zoom\.us/, /microsoft teams/, /^teams$/, /webex/],
  title: [/^meet\s*[-–:]/, /google meet/, /\bzoom meeting\b/, /reuniao do zoom/, /\| microsoft teams$/, /chamada.*teams/],
  hosts: ['meet.google.com', 'zoom.us/j', 'teams.microsoft.com', 'teams.live.com'],
};

function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return norm(u.host + u.pathname);
  } catch {
    return norm(url);
  }
}

function matchesItem(item: string, app: string, title: string, host: string): boolean {
  const key = norm(item).trim();
  if (!key) return false;
  const known = KNOWN[key];
  if (known) {
    if (known.hosts.some((h) => host.includes(h))) return true;
    if (known.title.some((re) => re.test(title) || re.test(app))) return true;
    return false;
  }
  // Item personalizado: nome de app, domínio ou trecho do título.
  if (key.includes('.')) return host.includes(key) || title.includes(key);
  return app === key || app.includes(key) || title.includes(key);
}

export function isDistraction(items: string[], allowed: string[], app: string, title: string, url: string | null): string | null {
  const a = norm(app);
  const t = norm(title);
  const h = hostOf(url);
  for (const item of items) {
    if (allowed.some((x) => norm(x) === norm(item))) continue;
    if (matchesItem(item, a, t, h)) return item;
  }
  return null;
}

export function isMeeting(app: string, title: string, url: string | null): boolean {
  const a = norm(app);
  const t = norm(title);
  const h = hostOf(url);
  return MEETING.apps.some((re) => re.test(a)) || MEETING.title.some((re) => re.test(t)) || MEETING.hosts.some((x) => h.includes(x));
}

export function matchClient(clients: Client[], app: string, title: string, url: string | null): Client | null {
  const hay = `${norm(title)} ${hostOf(url)} ${norm(app)}`;
  const compact = hay.replace(/[^a-z0-9]/g, '');
  for (const c of clients) {
    const keys = [c.name, ...c.keywords].map(norm).filter((k) => k.length >= 3);
    for (const k of keys) {
      if (hay.includes(k)) return c;
      const kc = k.replace(/[^a-z0-9]/g, '');
      if (kc.length >= 4 && compact.includes(kc)) return c;
    }
  }
  return null;
}

export function isIgnored(ignored: string[], app: string): boolean {
  const a = norm(app);
  return ignored.some((x) => {
    const k = norm(x).trim();
    return k.length > 0 && (a === k || a.includes(k));
  });
}

export interface Classification {
  category: ActivityCategory;
  clientId: number | null;
  distraction: string | null;
}

export function classify(
  opts: { distractions: string[]; allowed: string[]; clients: Client[] },
  app: string,
  title: string,
  url: string | null,
): Classification {
  if (isMeeting(app, title, url)) return { category: 'meeting', clientId: matchClient(opts.clients, app, title, url)?.id ?? null, distraction: null };
  const d = isDistraction(opts.distractions, opts.allowed, app, title, url);
  if (d) return { category: 'distraction', clientId: null, distraction: d };
  const c = matchClient(opts.clients, app, title, url);
  if (c) return { category: 'client', clientId: c.id, distraction: null };
  return { category: 'work', clientId: null, distraction: null };
}
