import { writeFileSync } from 'node:fs';
import { dialog } from 'electron';
import type { ActivityBlock, Client } from '@shared/types';
import { getWindow } from '../bus';
import { blocksBetween } from '../db/repos/activity';
import { listClients } from '../db/repos/clients';
import { dayKey } from '../time';

function cell(v: string | number): string {
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const hm = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * CSV (data, cliente, início, fim, duração, app, título) para planilhas e sistemas de apontamento.
 * Separador ";" e BOM UTF-8: abre direto no Excel em pt-BR.
 */
export function blocksToCsv(blocks: ActivityBlock[], clients: Client[]): string {
  const byId = new Map(clients.map((c) => [c.id, c.name]));
  const rows = [['data', 'cliente', 'inicio', 'fim', 'duracao_min', 'app', 'titulo', 'categoria']];
  for (const b of blocks) {
    if (b.idle || b.category === 'idle') continue;
    const dur = Math.round(((Date.parse(b.endedAt) - Date.parse(b.startedAt)) / 60_000) * 10) / 10;
    if (dur <= 0) continue;
    rows.push([dayKey(new Date(b.startedAt)), b.clientId ? (byId.get(b.clientId) ?? '') : '', hm(b.startedAt), hm(b.endedAt), String(dur).replace('.', ','), b.app, b.title, b.category]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export async function exportCsv(from: string, to: string): Promise<string | null> {
  const w = getWindow();
  const opts: Electron.SaveDialogOptions = { defaultPath: `pipo-tempo-${dayKey(new Date(from))}_${dayKey(new Date(to))}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] };
  const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  writeFileSync(r.filePath, blocksToCsv(blocksBetween(from, to), listClients(true)));
  return r.filePath;
}
