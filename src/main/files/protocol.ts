// Protocolo pipo-file://: a janela do Pipo abre os anexos (vídeo, imagem) direto do disco, em pedaços
// (Range), para o vídeo poder pular para qualquer ponto. Só serve arquivos da pasta de anexos.
import { createReadStream, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { paths } from '../paths';
import { MIME } from './mime';

export const FILE_SCHEME = 'pipo-file';

/** Endereço de um anexo para a janela do Pipo. */
export const fileUrl = (path: string): string => `${FILE_SCHEME}://anexo/${encodeURIComponent(basename(path))}`;

export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
}

/** Pedaço pedido no cabeçalho Range ("bytes=100-", "bytes=0-99", "bytes=-500"), ou null para o arquivo inteiro. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return start >= size || start > end ? 'invalid' : { start, end };
}

const notFound = (): Response => new Response('não encontrado', { status: 404 });

export function handleFileProtocol(): void {
  protocol.handle(FILE_SCHEME, (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    // Só um nome de arquivo da pasta de anexos: nada de subpastas nem arquivos temporários.
    if (!name || name !== basename(name) || name.startsWith('.')) return notFound();
    const file = join(paths.files, name);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return notFound();
    }
    const type = MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
    if (size === 0) return new Response('', { status: 200, headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' } });
    const range = parseRange(req.headers.get('range'), size);
    if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
    // Só a janela do Pipo usa este protocolo (as janelas de navegação dos Pipos têm sessão própria).
    const headers: Record<string, string> = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}
