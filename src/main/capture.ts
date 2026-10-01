// Captura rápida, desfazer, área de transferência e microfone (seção 9.7).
import { clipboard, session, systemPreferences } from 'electron';
import { parseCapture } from '@shared/parse-capture';
import { captureToTask } from './agent/service';
import { emit } from './bus';
import { getSettings } from './db/repos/settings';
import { deleteTask } from './db/repos/tasks';
import { ingestBuffer, ingestFile } from './files/ingest';
import { handle } from './ipc';
import { tasksChanged } from './tasks/ipc';

const DEADLINE_WORDS = /\b(prazo|vence|vencimento|até (o dia|dia|amanhã|segunda|terça|quarta|quinta|sexta)|entregar|entrega|deadline|due)\b/i;

/** O texto copiado parece ter uma data ou prazo? Exportado para testes. */
export function looksLikeDeadline(text: string): boolean {
  const t = text.trim();
  if (t.length < 6 || t.length > 400) return false;
  if (/^https?:\/\/\S+$/.test(t)) return false;
  return DEADLINE_WORDS.test(t) || parseCapture(t, []).dueAt !== null;
}

let lastClip = '';
let clipTimer: NodeJS.Timeout | null = null;

async function readClip(): Promise<string> {
  // Electron 44: readText pode ser assíncrono.
  return (await Promise.resolve(clipboard.readText() as string | Promise<string>)) ?? '';
}

function watchClipboard(): void {
  void readClip().then((t) => (lastClip = t));
  clipTimer = setInterval(async () => {
    const s = getSettings();
    if (!s.reactions.clipboard || s.paused) return;
    const text = await readClip();
    if (!text || text === lastClip) return;
    lastClip = text;
    if (looksLikeDeadline(text)) {
      // Só uma carinha curiosa e um botão na pill por 5s: não expande nem gasta orçamento.
      emit('mascot:react', { state: 'looking', ms: 5000 });
      emit('clipboard:candidate', { text: text.trim().slice(0, 300) });
    }
  }, 1500);
}

export function registerCapture(): void {
  handle('capture:submit', ({ text, source }) => (text.trim() ? captureToTask(text.trim(), source) : null));
  handle('capture:clipboardToTask', (text) => captureToTask(text, 'clipboard'));
  handle('toasts:undo', (toastId) => {
    const m = /^task:(\d+)$/.exec(toastId);
    if (m) {
      deleteTask(Number(m[1]));
      tasksChanged();
    }
  });
  handle('files:ingest', async (paths) => {
    const out = [];
    for (const p of paths) out.push(await ingestFile(p));
    return out;
  });
  handle('files:ingestBuffer', (file) => ingestBuffer(file));
  handle('app:askMic', async () => {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  // Só o microfone (áudio) é permitido; o pedido acontece no primeiro uso da voz.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    cb(permission === 'media' && types.length > 0 && types.every((t) => t === 'audio'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  watchClipboard();
}

export function stopCapture(): void {
  if (clipTimer) clearInterval(clipTimer);
}

