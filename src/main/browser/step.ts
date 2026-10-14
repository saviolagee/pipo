// Passo `browser` dos Pipos coloridos: abre a página e faz as ações do plano, em ordem, na sessão
// do próprio Pipo (os logins que o usuário fez na janela do navegador dele).
import { join } from 'node:path';
import { browserSends } from '@shared/plan-check';
import type { BrowserAction, BrowserStep } from '@shared/pipos';
import { renderText } from '@shared/template';
import { StepError, type StepEnv } from '../pipos/steps';
import { pipoPartition, WebError, webSession, type WebSession } from './session';

const MAX_TEXT = 20_000;

/** Como a ação aparece no ensaio (com os templates crus: nenhum segredo é resolvido). */
export function describeAction(a: BrowserAction): string {
  switch (a.do) {
    case 'goto':
      return `abrir ${a.url}`;
    case 'click':
      return `clicar em "${a.target}"`;
    case 'fill':
      return `preencher "${a.target}" com "${a.value.replace(/\{\{segredo\.[^}]+\}\}/g, '••••')}"`;
    case 'submit':
      return a.target ? `enviar o formulário de "${a.target}"` : 'enviar o formulário';
    case 'press':
      return `apertar ${a.key}`;
    case 'wait':
      return a.for ? `esperar "${a.for}" aparecer` : `esperar ${a.seconds ?? 1}s`;
    case 'read':
      return a.target ? `ler "${a.target}"` : 'ler a página';
    case 'list':
      return `listar "${a.target}"${a.attr ? ` (${a.attr})` : ''}`;
    case 'screenshot':
      return 'tirar um retrato da página';
  }
}

async function doAction(s: WebSession, a: BrowserAction, e: StepEnv, stepKey: string, out: Record<string, unknown>): Promise<void> {
  const text = (t: string): string => renderText(t, e.ctx);
  switch (a.do) {
    case 'goto':
      return s.goto(renderText(a.url, e.ctx, { allowSecrets: true }), e.signal);
    case 'click':
      return s.click(text(a.target), e.signal);
    case 'fill':
      return s.fill(text(a.target), renderText(a.value, e.ctx, { allowSecrets: true }));
    case 'submit':
      return s.submit(a.target ? text(a.target) : null, e.signal);
    case 'press':
      return s.press(a.key, e.signal);
    case 'wait':
      if (a.for) return s.waitFor(text(a.for), Math.min(120, a.seconds ?? 15) * 1000, e.signal);
      await new Promise((r) => setTimeout(r, Math.min(60, Math.max(0, a.seconds ?? 1)) * 1000));
      return;
    case 'read':
      out[a.as] = (await s.text(a.target ? text(a.target) : undefined)).slice(0, MAX_TEXT);
      return;
    case 'list':
      out[a.as] = await s.list(text(a.target), a.attr);
      return;
    case 'screenshot':
      // Caminho completo: o arquivo aparece na galeria do painel do Pipo.
      out[a.as] = await s.screenshot(join(e.runDir, `${stepKey}-${a.as}.png`));
      return;
  }
}

export async function runBrowser(step: BrowserStep, e: StepEnv, slug: string): Promise<unknown> {
  const actions = step.actions ?? [];
  // Ensaio: ler roda de verdade; o que pode enviar algo só é descrito.
  if (e.dryRun && (step.external || browserSends(step))) return { seco: true, abriria: step.url.replace(/\{\{segredo\.[^}]+\}\}/g, '••••'), acoes: actions.map(describeAction) };
  const s = webSession(pipoPartition(slug));
  const out: Record<string, unknown> = {};
  const limit = (step.timeoutSec ?? 180) * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    s.close();
  }, limit);
  let doing = `abrir ${step.url}`;
  try {
    await s.goto(renderText(step.url, e.ctx, { allowSecrets: true }), e.signal);
    for (const a of actions) {
      if (e.signal.aborted) throw new StepError('Cancelado.');
      doing = describeAction(a);
      await doAction(s, a, e, step.key, out);
    }
    return { ...out, url: s.url(), titulo: (await s.snapshot(0)).title };
  } catch (x) {
    if (timedOut) throw new StepError(`Passou do tempo limite (${Math.round(limit / 1000)}s) ao ${doing}.`);
    if (x instanceof StepError) throw x;
    const where = s.url();
    throw new StepError(`Não consegui ${doing}: ${(x as Error).message}${where ? ` (página: ${where.slice(0, 120)})` : ''}${x instanceof WebError ? ' Se o site pediu login ou captcha, abra o navegador do Pipo e resolva lá.' : ''}`);
  } finally {
    clearTimeout(timer);
  }
}
