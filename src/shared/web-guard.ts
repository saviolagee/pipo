// Que endereços o Pipo branco pode abrir sem perguntar. Regra: só o que o usuário citou ou o que
// apareceu numa busca ou numa página já aberta. Um endereço montado pelo modelo (que poderia levar
// dados do usuário embutidos) pede confirmação. Funções puras: tests/web-guard.test.ts.

/** Endereços citados num texto do usuário: com "http(s)://" vale qualquer um (até IP ou localhost); sem, só o que parece domínio. */
export function urlsInText(text: string): string[] {
  const found = text.match(/\bhttps?:\/\/[^\s<>"')\]]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"')\]]*)?/gi) ?? [];
  return found.map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)).map((u) => u.replace(/[.,;:!?]+$/, ''));
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Mesmo endereço, ignorando "www.", a barra final e o trecho depois de "#". */
export function urlKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

export class UrlGuard {
  private hosts = new Set<string>();
  private urls = new Set<string>();
  private max: number;

  constructor(max = 5000) {
    this.max = max;
  }

  /** O usuário falou deste site: qualquer página dele pode ser aberta. */
  trustHost(url: string): void {
    const h = hostOf(url);
    if (h) this.hosts.add(h);
  }

  /** O endereço apareceu numa busca ou numa página: pode ser aberto exatamente assim. */
  see(url: string | null | undefined): void {
    const k = url ? urlKey(url) : null;
    if (!k) return;
    if (this.urls.size >= this.max) this.urls.delete(this.urls.values().next().value as string);
    this.urls.add(k);
  }

  noteUserText(text: string): void {
    for (const u of urlsInText(text)) this.trustHost(u);
  }

  allowed(url: string): boolean {
    const h = hostOf(url);
    const k = urlKey(url);
    if (!h || !k) return false;
    return this.hosts.has(h) || this.urls.has(k);
  }
}
