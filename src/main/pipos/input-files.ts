// Arquivos que o usuário mandou para um Pipo ({{entrada.arquivos}}) entram na pasta da execução:
// os passos de IA só leem essa pasta, então imagens, documentos e os quadros de um vídeo vão para
// lá (vínculo no disco quando dá, cópia quando não). O vídeo em si fica onde está: os scripts leem
// pelo caminho, e a IA vê os quadros.
import { copyFileSync, existsSync, linkSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

interface FileLike {
  caminho?: unknown;
  tipo?: unknown;
  leitura?: unknown;
  quadros?: unknown;
}

function place(src: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, basename(src));
  if (!existsSync(dest)) {
    try {
      linkSync(src, dest);
    } catch {
      copyFileSync(src, dest);
    }
  }
  return dest;
}

/** Devolve a entrada com os caminhos apontando para dentro da execução (o resto fica igual). */
export function stageInputFiles(input: unknown, runDir: string): unknown {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { arquivos?: unknown }).arquivos)) return input;
  const dir = join(runDir, 'entrada');
  const arquivos = ((input as { arquivos: unknown[] }).arquivos as FileLike[]).map((f, i) => {
    if (!f || typeof f !== 'object' || typeof f.caminho !== 'string' || !existsSync(f.caminho)) return f;
    const own = join(dir, String(i + 1));
    const next: Record<string, unknown> = { ...f };
    if (f.tipo !== 'video') next.caminho = place(f.caminho, own);
    if (typeof f.leitura === 'string' && existsSync(f.leitura)) next.leitura = place(f.leitura, own);
    if (Array.isArray(f.quadros)) next.quadros = f.quadros.map((q) => (typeof q === 'string' && existsSync(q) ? place(q, own) : q));
    return next;
  });
  return { ...(input as Record<string, unknown>), arquivos };
}
