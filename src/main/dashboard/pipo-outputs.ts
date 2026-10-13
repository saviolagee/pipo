// O que uma execução produziu, para a galeria do painel de cada Pipo: arquivos que existem no
// computador e links, lidos das saídas dos passos (runs/<id>/<passo>.json) e do que o script deixou
// na pasta da execução. Nada é guardado à parte: sai do que o executor já grava.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import type { PipoDashOutput, PipoOutputMedia } from '@shared/dashboard';

const MEDIA: Record<string, PipoOutputMedia> = {
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio',
  pdf: 'doc', docx: 'doc', xlsx: 'doc', pptx: 'doc', csv: 'doc', txt: 'doc', md: 'doc', json: 'doc', srt: 'doc',
};

/** Só estes tipos abrem direto; o resto é mostrado na pasta (a saída de um passo pode vir de fora). */
export function opensDirectly(file: string): boolean {
  return extname(file).slice(1).toLowerCase() in MEDIA;
}

export function mediaOf(file: string): PipoOutputMedia {
  return MEDIA[extname(file).slice(1).toLowerCase()] ?? 'other';
}

const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
const MAX_JSON_BYTES = 2_000_000;
const MAX_NODES = 5000;
const MAX_PER_RUN = 12;

function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const s = `${u.hostname.replace(/^www\./, '')}${path}`;
    return s.length > 60 ? `${s.slice(0, 59)}…` : s;
  } catch {
    return url.slice(0, 60);
  }
}

/** Percorre uma saída e devolve as strings que são um caminho completo ou um link inteiro. */
function candidates(value: unknown): string[] {
  const out: string[] = [];
  const stack: Array<{ v: unknown; depth: number }> = [{ v: value, depth: 0 }];
  let nodes = 0;
  while (stack.length && nodes++ < MAX_NODES) {
    const { v, depth } = stack.pop() as { v: unknown; depth: number };
    if (typeof v === 'string') {
      if (v.length >= 4 && v.length <= 500 && !/[\n\r]/.test(v) && (URL_RE.test(v) || isAbsolute(v))) out.push(v);
    } else if (v && typeof v === 'object' && depth < 6) {
      // Empilhado ao contrário para sair na ordem em que aparece na saída.
      for (const x of Object.values(v as Record<string, unknown>).reverse()) stack.push({ v: x, depth: depth + 1 });
    }
  }
  return out;
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Arquivos e links de uma execução. `steps` é a ordem do plano (chave → título); arquivos primeiro,
 * depois links, sem repetir. `more` conta o que passou do limite por execução.
 */
export function collectOutputs(pipoDir: string, runId: number, at: string, steps: Array<{ key: string; title: string }>): { items: PipoDashOutput[]; more: number } {
  const runDir = join(pipoDir, 'runs', String(runId));
  if (!existsSync(runDir)) return { items: [], more: 0 };
  const files: PipoDashOutput[] = [];
  const links: PipoDashOutput[] = [];
  const seen = new Set<string>();
  const add = (target: string, kind: 'file' | 'link', step: string | null): void => {
    const k = kind === 'file' ? target.toLowerCase() : target;
    if (seen.has(k)) return;
    seen.add(k);
    if (kind === 'file') files.push({ runId, at, step, kind, media: mediaOf(target), label: basename(target), target });
    else links.push({ runId, at, step, kind, media: 'link', label: linkLabel(target), target });
  };
  for (const s of steps) {
    const file = join(runDir, `${s.key}.json`);
    try {
      if (!existsSync(file) || statSync(file).size > MAX_JSON_BYTES) continue;
      for (const c of candidates(JSON.parse(readFileSync(file, 'utf8')))) {
        if (URL_RE.test(c)) add(c, 'link', s.title);
        else if (isFile(c)) add(c, 'file', s.title);
      }
    } catch {
      // saída ilegível não entra na galeria
    }
  }
  // O que o script deixou na pasta da execução (PIPO_RUN_DIR), fora as saídas dos passos.
  const own = new Set(['entrada.json', ...steps.map((s) => `${s.key}.json`)]);
  try {
    for (const name of readdirSync(runDir)) {
      const full = join(runDir, name);
      if (!own.has(name) && isFile(full)) add(full, 'file', null);
    }
  } catch {
    // pasta sumiu no meio
  }
  const all = [...files, ...links];
  return { items: all.slice(0, MAX_PER_RUN), more: Math.max(0, all.length - MAX_PER_RUN) };
}
