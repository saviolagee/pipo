// Anexos (seção 9.12): copiados para userData/files/ (a única pasta que o agente pode ler).
// .docx vira .md com o mammoth antes, para o Claude conseguir ler.
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Attachment } from '@shared/types';
import { emit } from '../bus';
import { insertAttachment } from '../db/repos/conversations';
import { paths } from '../paths';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const SUPPORTED = Object.keys(MIME);
const MAX_BYTES = 30 * 1024 * 1024;

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120);
}

function copyWithProgress(src: string, dest: string, filename: string): Promise<void> {
  const total = statSync(src).size || 1;
  let done = 0;
  let lastPct = -1;
  return new Promise((resolve, reject) => {
    const rs = createReadStream(src);
    const ws = createWriteStream(dest);
    rs.on('data', (chunk: Buffer | string) => {
      done += chunk.length;
      const pct = Math.min(99, Math.round((done / total) * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        emit('files:progress', { attachmentId: null, filename, percent: pct, done: false });
      }
    });
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', () => resolve());
    rs.pipe(ws);
  });
}

async function docxToMarkdown(src: string, dest: string): Promise<void> {
  const mammoth = (await import('mammoth')) as unknown as {
    convertToMarkdown?: (o: { path: string }) => Promise<{ value: string }>;
    convertToHtml: (o: { path: string }) => Promise<{ value: string }>;
  };
  const r = mammoth.convertToMarkdown ? await mammoth.convertToMarkdown({ path: src }) : await mammoth.convertToHtml({ path: src });
  writeFileSync(dest, r.value);
}

export async function ingestFile(src: string): Promise<Attachment> {
  const ext = extname(src).toLowerCase();
  const original = basename(src);
  if (!MIME[ext]) throw new Error(`Formato não suportado: ${ext || original}. Use PDF, imagens, texto ou .docx.`);
  if (statSync(src).size > MAX_BYTES) throw new Error(`${original} é grande demais (máx. 30 MB).`);
  const id = randomBytes(4).toString('hex');
  const stored = join(paths.files, `${id}-${safeName(original)}`);
  emit('files:progress', { attachmentId: null, filename: original, percent: 0, done: false });
  try {
    if (ext === '.docx') {
      const md = stored.replace(/\.docx$/i, '.md');
      await docxToMarkdown(src, md);
      const a = insertAttachment({ conversationId: null, filename: original, mime: MIME['.md'], path: md });
      emit('files:progress', { attachmentId: a.id, filename: original, percent: 100, done: true });
      return a;
    }
    await copyWithProgress(src, stored, original);
    const a = insertAttachment({ conversationId: null, filename: original, mime: MIME[ext], path: stored });
    emit('files:progress', { attachmentId: a.id, filename: original, percent: 100, done: true });
    return a;
  } catch (e) {
    emit('files:progress', { attachmentId: null, filename: original, percent: 0, done: true, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Arquivo arrastado sem caminho no disco (ex.: imagem vinda do navegador). */
export async function ingestBuffer(file: { name: string; mime: string; data: ArrayBuffer }): Promise<Attachment> {
  const tmp = join(paths.files, `.tmp-${randomBytes(4).toString('hex')}-${safeName(file.name)}`);
  writeFileSync(tmp, Buffer.from(file.data));
  return ingestFile(tmp);
}
