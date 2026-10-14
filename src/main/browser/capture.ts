// "Site vira API": o usuário usa o site uma vez na janela do navegador do Pipo, o app grava as
// chamadas internas e o construtor monta passos `http`. Depois, renovar a sessão é entrar de novo.
import type { PipoPlaybook, PipoStep } from '@shared/pipos';
import { secretName, siteSecretsIn, summarizeCapture, type CaptureResult, type RecordedCall } from '@shared/site-api';
import { dismissCard, showCard } from '../cards';
import { setPipoSecret } from '../pipos/secrets';
import { openVisible, pipoPartition, webPartition } from './session';
import { startRecording } from './recorder';

const WAIT_MS = 15 * 60_000;

/**
 * Abre a janela à vista, gravando. Termina quando o usuário fecha a janela ou responde ao card
 * (se houver). Devolve null se ele cancelou.
 */
export async function recordSite(o: { slug: string; url: string; title: string; card?: { label: string; title: string; subject: string; color?: string } }): Promise<RecordedCall[] | null> {
  let rec: ReturnType<typeof startRecording> | null = null;
  const win = openVisible(pipoPartition(o.slug), o.url, o.title, { fresh: true, beforeLoad: (w) => (rec = startRecording(w.webContents)) });
  const recorder = rec as ReturnType<typeof startRecording> | null;
  if (!recorder) throw new Error('Não consegui começar a gravar.');
  const closed = new Promise<'closed'>((resolve) => win.once('closed', () => resolve('closed')));
  const cardId = o.card ? `capture:${o.slug}:${Date.now()}` : null;
  const answered = cardId
    ? showCard(
        {
          id: cardId,
          kind: 'action',
          glow: 'attention',
          mascot: 'listening',
          pipoColor: o.card?.color,
          label: o.card?.label ?? '',
          title: o.card?.title,
          subject: o.card?.subject,
          buttons: [
            { id: 'cancel', label: 'Cancelar', kbd: 'N', variant: 'secondary' },
            { id: 'done', label: 'Terminei', kbd: 'Y', variant: 'primary' },
          ],
        },
        { timeoutMs: WAIT_MS, timeoutValue: 'cancel' },
      )
    : new Promise<string>(() => undefined);
  const how = await Promise.race([closed, answered]);
  // Com a janela ainda aberta dá para buscar o corpo das últimas respostas antes de fechar.
  const calls = await recorder.stop();
  if (how === 'closed') {
    if (cardId) dismissCard(cardId, 'done');
    return calls;
  }
  if (!win.isDestroyed()) win.destroy();
  return how === 'done' ? calls : null;
}

/** Guarda no cofre do Pipo os cookies e tokens de uma captura. Devolve os nomes guardados. */
export function storeCapture(slug: string, capture: CaptureResult, only?: string[]): string[] {
  const names = Object.keys(capture.secrets).filter((n) => !only || only.includes(n));
  for (const n of names) setPipoSecret(slug, n, capture.secrets[n]);
  return names.sort();
}

function textsOf(steps: PipoStep[]): string[] {
  return steps.map((s) => JSON.stringify(s));
}

/** O plano usa chamadas capturadas de um site? */
export function usesCapturedSite(playbook: PipoPlaybook | null | undefined): boolean {
  return !!playbook && siteSecretsIn(textsOf(playbook.steps)).length > 0;
}

/**
 * Renova a sessão: o usuário entra no site de novo, e os cookies e tokens que o plano usa são
 * trocados pelos novos. O plano não muda.
 */
export async function renewSession(slug: string, playbook: PipoPlaybook, url: string, title: string): Promise<string[]> {
  const calls = await recordSite({ slug, url, title });
  if (!calls) return [];
  const used = siteSecretsIn(textsOf(playbook.steps));
  const renewed = storeCapture(slug, summarizeCapture(calls, url), used);
  await refreshSiteCookies(slug, playbook);
  return renewed;
}

/**
 * Antes de cada execução: o cookie de cada chamada capturada vem fresco da sessão do navegador do
 * Pipo (onde o usuário está logado), em vez do valor do dia da captura.
 */
export async function refreshSiteCookies(slug: string, playbook: PipoPlaybook): Promise<void> {
  const jar = webPartition(pipoPartition(slug)).cookies;
  for (const s of playbook.steps) {
    if (s.kind !== 'http' || !s.capturedFrom) continue;
    const url = s.url.replace(/\{\{[^}]+\}\}/g, 'x');
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    const name = secretName(host, 'cookie');
    if (!JSON.stringify(s.headers ?? {}).includes(`segredo.${name}`)) continue;
    const cookies = await jar.get({ url });
    if (cookies.length) setPipoSecret(slug, name, cookies.map((c) => `${c.name}=${c.value}`).join('; '));
  }
}
