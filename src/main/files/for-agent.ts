// Como os anexos chegam aos Pipos: na conversa (a lista que o agente lê) e nas execuções de um Pipo
// colorido ({{entrada.arquivos}}). Imagem o agente abre direto; vídeo vem "assistido" (quadros e fala).
import { resolve, sep } from 'node:path';
import type { Attachment } from '@shared/types';
import { attachmentByPath } from '../db/repos/conversations';
import { paths } from '../paths';
import { isImageMime, isVideoMime } from './mime';
import { clock, videoReading } from './video';

/** Quanto esperar o Pipo terminar de assistir antes de responder. */
const WAIT_MS = 4 * 60_000;

/** Um arquivo entregue ao plano de um Pipo colorido. */
export interface InputFile {
  nome: string;
  caminho: string;
  tipo: 'video' | 'imagem' | 'documento';
  mime: string;
  /** Vídeo: descrição com quadros e fala. */
  leitura?: string;
  quadros?: string[];
  duracaoSeg?: number;
  fala?: string | null;
}

/** O texto da mensagem com a lista dos anexos para o agente. */
export async function attachmentsPrompt(atts: Attachment[], onWatching: () => void): Promise<string> {
  if (!atts.length) return '';
  const videos = atts.filter((a) => isVideoMime(a.mime));
  if (videos.length) onWatching();
  const readings = new Map(await Promise.all(videos.map(async (a) => [a.id, await videoReading(a, WAIT_MS)] as const)));
  const lines = atts.map((a) => {
    if (isVideoMime(a.mime)) {
      const r = readings.get(a.id);
      if (!r) return `- ${a.filename} (vídeo): ${a.path}. Não consegui assistir (formato que não abre ou demorou demais); diga isso se precisar do conteúdo.`;
      return `- ${a.filename} (vídeo de ${clock(r.duracaoSeg)}, ${r.largura}×${r.altura}): ${a.path}. Você não abre o vídeo direto: leia a descrição em ${r.descricao} (quadros e fala) e abra os quadros, que são imagens.`;
    }
    if (isImageMime(a.mime)) return `- ${a.filename} (imagem): ${a.path}. Abra com Read para ver.`;
    return `- ${a.filename} (${a.mime}): ${a.path}`;
  });
  return `\n\nArquivos anexados (leia com a ferramenta Read):\n${lines.join('\n')}`;
}

/** Só anexos de verdade: caminhos dentro da pasta de anexos do app. */
export function attachmentAt(path: string): Attachment | null {
  const p = resolve(path);
  if (!p.startsWith(resolve(paths.files) + sep)) return null;
  return attachmentByPath(p) ?? attachmentByPath(path);
}

/** Arquivos que o usuário mandou no chat, prontos para virar {{entrada.arquivos}} de uma execução. */
export async function inputFiles(filePaths: string[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const path of filePaths) {
    const a = attachmentAt(path);
    if (!a) throw new Error(`Esse arquivo não foi anexado nesta conversa: ${path}`);
    if (isVideoMime(a.mime)) {
      const r = await videoReading(a, WAIT_MS);
      out.push({ nome: a.filename, caminho: a.path, tipo: 'video', mime: a.mime, ...(r ? { leitura: r.descricao, quadros: r.quadros.map((q) => q.caminho), duracaoSeg: r.duracaoSeg, fala: r.fala } : {}) });
    } else out.push({ nome: a.filename, caminho: a.path, tipo: isImageMime(a.mime) ? 'imagem' : 'documento', mime: a.mime });
  }
  return out;
}
