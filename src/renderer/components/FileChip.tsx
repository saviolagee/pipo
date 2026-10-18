// Chip de um arquivo anexado no chat: imagem com miniatura, vídeo com o andamento de "assistir".
import type { Attachment } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { useMediaStatus } from '../local/media';
import { IconFile, IconPlay, IconX } from './Icons';

/** Endereço do anexo para a janela do Pipo (protocolo pipo-file://, só a pasta de anexos). */
export const attachmentUrl = (a: Attachment): string => `pipo-file://anexo/${encodeURIComponent(a.path.split(/[\\/]/).pop() ?? '')}`;

export function FileChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }): React.JSX.Element {
  const status = useMediaStatus((s) => s[a.id]);
  const ext = a.filename.split('.').pop()?.toLowerCase() ?? '';
  const image = a.mime.startsWith('image/');
  const video = a.mime.startsWith('video/');
  const color = ext === 'pdf' ? '#EF4444' : /docx?/.test(ext) ? '#3B82F6' : '#A1A1AA';
  const busy = video && status && !status.done;
  return (
    <span className="inline-flex h-[26px] max-w-[240px] items-center gap-[6px] rounded-[8px] pl-[5px] pr-[9px] text-[12px] text-fg" style={{ background: 'var(--bg-card-hover)' }} title={status?.error ?? a.filename}>
      {image ? (
        <img src={attachmentUrl(a)} alt="" className="h-[18px] w-[18px] shrink-0 rounded-[4px] object-cover" />
      ) : video ? (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: '#7C3AED' }}>
          <IconPlay size={8} />
        </span>
      ) : (
        <IconFile size={14} color={color} />
      )}
      <span className="truncate">{a.filename}</span>
      {busy && <span className="shrink-0 text-[10.5px] text-fg-3">{status.stage === 'fala' ? t.chat.listeningVideo : t.chat.watchingVideo(status.percent)}</span>}
      {video && status?.stage === 'erro' && <span className="shrink-0 text-[10.5px] text-attention">{t.chat.videoFailed}</span>}
      {onRemove && (
        <button type="button" aria-label={`${t.common.remove} ${a.filename}`} onClick={onRemove} className="text-fg-3 hover:text-fg">
          <IconX size={9} />
        </button>
      )}
    </span>
  );
}
