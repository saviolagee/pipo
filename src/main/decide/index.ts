// Decisões dos Pipos: lista das atividades, ligar/desligar o modelo local de cada uma e exportar os
// exemplos no formato de treino do Laya.
import { writeFileSync } from 'node:fs';
import { dialog } from 'electron';
import { trainingLine } from '@shared/decide';
import { getWindow } from '../bus';
import { handle } from '../ipc';
import { examplesOf, listActivities, setLocalModel } from './engine';

export function registerDecide(): void {
  handle('decide:activities', () => listActivities());
  handle('decide:setLocal', (activity, cfg) => setLocalModel(activity, cfg));
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
