import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import type { Toast as ToastT } from '@shared/types';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { useUi } from '../store/ui';

function ToastItem({ toast }: { toast: ToastT }): React.JSX.Element {
  useEffect(() => {
    const id = setTimeout(() => useUi.getState().dropToast(toast.id), toast.durationMs ?? 5000);
    return () => clearTimeout(id);
  }, [toast]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6 }}
      className="pointer-events-auto flex items-center gap-[10px] rounded-full py-[6px] pl-[14px] pr-[6px] text-[12.5px] text-fg"
      style={{ background: '#151518', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
      onMouseEnter={() => void api.invoke('window:setInteractive', true)}
      onMouseLeave={() => void api.invoke('window:setInteractive', false)}
      role="status"
    >
      <span className="max-w-[380px] truncate">{toast.text}</span>
      {toast.undoable && (
        <button
          type="button"
          onClick={() => {
            void api.invoke('toasts:undo', toast.id);
            useUi.getState().dropToast(toast.id);
          }}
          className="rounded-full bg-white/[0.1] px-[10px] py-[3px] text-[12px] font-medium hover:bg-white/[0.16]"
        >
          {t.common.undo}
        </button>
      )}
    </motion.div>
  );
}

/** Toasts logo abaixo do notch (ex.: "Anotado: Ligar pro Leo · sex 10h" + Desfazer). */
export function Toasts({ top }: { top: number }): React.JSX.Element {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-[6px]" style={{ top: top + 10 }}>
      <AnimatePresence>
        {toasts.map((x) => (
          <ToastItem key={x.id} toast={x} />
        ))}
      </AnimatePresence>
    </div>
  );
}
