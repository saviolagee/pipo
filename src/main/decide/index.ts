// Decisões dos Pipos: lista das atividades, ligar/desligar o modelo local de cada uma e exportar os
// exemplos no formato de treino do Laya.
import { readFileSync, writeFileSync } from 'node:fs';
import { dialog } from 'electron';
import { ACTIVITY_NAME, normalizeOptions, QUESTION_KEY, trainingLine } from '@shared/decide';
import { getWindow } from '../bus';
import { handle } from '../ipc';
import { embedTexts } from './embedder';
import { examplesOf, listActivities, record, setLocalModel } from './engine';
import { removeOwn, trainOwn } from './own';

/**
 * Exemplos já com a resposta certa, um JSON por linha: o formato da exportação
 * ({state, questions.decisao.{instructions, criteria}, expected.decisao}) ou o simples
 * ({texto, resposta, pergunta, opcoes}). Devolve quantos entraram.
 */
export function importExamples(activity: string, text: string): number {
  if (!ACTIVITY_NAME.test(activity)) throw new Error('Nome de atividade inválido.');
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const q = (j.questions as Record<string, { instructions?: unknown; criteria?: unknown }> | undefined)?.[QUESTION_KEY];
    const state = typeof j.state === 'string' ? j.state : typeof j.texto === 'string' ? j.texto : '';
    const options = normalizeOptions(q?.criteria ?? j.opcoes);
    const choice = String((j.expected as Record<string, unknown> | undefined)?.[QUESTION_KEY] ?? j.resposta ?? '');
    const question = String(q?.instructions ?? j.pergunta ?? '');
    if (!state.trim() || !(choice in options) || Object.keys(options).length < 2) continue;
    record({ activity, pipoId: null, runId: null, state, question, options, choice, confidence: null, source: 'usuario' });
    n++;
  }
  return n;
}

export function registerDecide(): void {
  handle('decide:activities', () => listActivities());
  handle('decide:setLocal', (activity, cfg) => setLocalModel(activity, cfg));
  // Modelo do próprio Pipo: treina com os exemplos da atividade e só liga se passar na prova.
  handle('decide:trainOwn', (activity) => trainOwn(activity, examplesOf(activity), embedTexts));
  handle('decide:removeOwn', (activity) => removeOwn(activity));
  handle('decide:import', async (activity, path) => {
    let file = path ?? null;
    if (!file) {
      const win = getWindow();
      const opts = { properties: ['openFile' as const], filters: [{ name: 'JSONL', extensions: ['jsonl', 'json', 'txt'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      file = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    return file ? importExamples(activity, readFileSync(file, 'utf8')) : 0;
  });
  handle('decide:export', async (activity) => {
    const lines = examplesOf(activity)
      .reverse()
      .map(trainingLine)
      .filter((l): l is string => !!l);
    if (!lines.length) return null;
    const win = getWindow();
    const opts = { defaultPath: `${activity}.jsonl`, filters: [{ name: 'JSONL', extensions: ['jsonl'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, `${lines.join('\n')}\n`);
    return r.filePath;
  });
}
