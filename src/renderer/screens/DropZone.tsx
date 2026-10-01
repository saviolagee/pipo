import { AnimatePresence, motion, useMotionValue, useSpring } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { Attachment, IngestProgress } from '@shared/types';
import { IconFile } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { useUi } from '../store/ui';

const d = t.drop;

/** Zona de drop [Ref 7, 8]: o mascote abre a boca, segue o cursor e engole o arquivo. */
export function DropZone({ progress, swallowing }: { progress: IngestProgress | null; swallowing: string | null }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 26 });
  const dragOver = useUi((s) => s.dragOver);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: DragEvent): void => {
      const r = el.getBoundingClientRect();
      // O mascote acompanha o cursor na horizontal, sem sair da zona.
      x.set(Math.max(-r.width / 2 + 60, Math.min(r.width / 2 - 60, e.clientX - (r.left + r.width / 2))));
    };
    window.addEventListener('dragover', onMove);
    return () => window.removeEventListener('dragover', onMove);
  }, [x]);

  const busy = progress && !progress.done;

  return (
    <div className="px-[10px] pb-[10px]">
      <div
        ref={ref}
        className="relative flex h-[136px] items-center justify-center overflow-hidden rounded-[16px]"
        style={{
          border: '1.5px dashed rgba(255,255,255,0.18)',
          background: dragOver || busy ? 'radial-gradient(80% 120% at 50% 100%, rgba(34,197,94,0.16), rgba(34,197,94,0.03) 60%, transparent), #0A0A0C' : '#0A0A0C',
        }}
      >
        <div className="pointer-events-none absolute left-[calc(50%-150px)] top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[13px] text-fg-2">{busy ? d.reading(progress.filename, progress.percent) : d.title}</p>
          {!busy && (
            <div className="mt-[8px] flex justify-center gap-[6px]">
              {d.kinds.map((k) => (
                <span key={k} className="rounded-[7px] px-[8px] py-[2px] text-[11px] text-fg-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {k}
                </span>
              ))}
            </div>
          )}
          {busy && (
            <div className="mx-auto mt-[8px] h-[3px] w-[160px] overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full bg-done" animate={{ width: `${progress.percent}%` }} />
            </div>
          )}
        </div>
        <motion.div style={{ x: sx }} className="pointer-events-none relative">
          <Mascot state={dragOver || swallowing ? 'eating' : busy ? 'thinking' : 'happy'} size={64} />
          <AnimatePresence>
            {swallowing && (
              <motion.div
                key={swallowing}
                className="absolute left-1/2 top-[-34px] -translate-x-1/2"
                initial={{ y: -10, scale: 1, opacity: 1 }}
                animate={{ y: 30, scale: 0.15, opacity: 0 }}
                transition={{ duration: 0.45, ease: 'easeIn' }}
              >
                <IconFile size={30} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      {!busy && <p className="mt-[8px] px-[4px] text-[11px] text-fg-3">{d.hint}</p>}
    </div>
  );
}

/** Usado pelo App: lê os arquivos soltos e devolve os anexos criados. */
export async function ingestDropped(files: FileList): Promise<{ attachments: Attachment[]; error: string | null }> {
  const attachments: Attachment[] = [];
  let error: string | null = null;
  for (const f of Array.from(files)) {
    try {
      const path = api.pathForFile(f);
      const atts = path ? await api.invoke('files:ingest', [path]) : [await api.invoke('files:ingestBuffer', { name: f.name, mime: f.type, data: await f.arrayBuffer() })];
      attachments.push(...atts);
    } catch (e) {
      error = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
    }
  }
  return { attachments, error };
}
