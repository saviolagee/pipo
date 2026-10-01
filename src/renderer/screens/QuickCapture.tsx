import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { usePinOnFocus } from '../components/Form';
import { IconArrowUp, IconMic } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { play } from '../sound/sfx';
import { useChat } from '../store/chat';
import { useUi } from '../store/ui';
import { useVoice } from '../voice/useVoice';

const q = t.capture;

/** Captura rápida (Ctrl/Cmd+Shift+K): só um input + microfone (seção 9.7). */
export function QuickCapture({ autoVoice }: { autoVoice?: boolean }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const pin = usePinOnFocus('capture');

  const submit = async (value: string, source: 'manual' | 'voice'): Promise<void> => {
    const v = value.trim();
    if (!v || busy) return;
    if (useUi.getState().capturePurpose === 'meeting') {
      // Anotações da reunião: o agente transforma em tarefas (cada uma pede confirmação).
      useUi.setState({ captureMode: false, capturePurpose: null });
      useUi.getState().setTab('chat');
      useChat.getState().newConversation();
      void useChat.getState().send(`Anotações da reunião que acabou. Transforme os próximos passos em tarefas (com data e estimativa quando der):\n${v}`);
      return;
    }
    setBusy(true);
    useUi.setState({ agentBusy: true });
    try {
      await api.invoke('capture:submit', { text: v, source });
      play('tick');
      useUi.getState().react('happy', 900);
      setText('');
      useUi.setState({ captureMode: false });
      setTimeout(() => useUi.getState().setExpanded(false), 600);
    } finally {
      setBusy(false);
      useUi.setState({ agentBusy: false });
    }
  };

  const voice = useVoice((transcribed) => {
    setText(transcribed);
    void submit(transcribed, 'voice');
  });

  useEffect(() => {
    ref.current?.focus();
    if (autoVoice) void voice.start();
  }, []);

  // Apertar o atalho de novo com a captura aberta liga/desliga a gravação.
  useEffect(() => api.on('ui:navigate', (p) => p.capture && p.voice && void voice.toggle()), [voice]);

  const recording = voice.state === 'recording';
  const meeting = useUi((st) => st.capturePurpose === 'meeting');
  const mascotState = recording ? 'listening' : busy || voice.state === 'transcribing' ? 'thinking' : 'idle';
  const status =
    voice.modelProgress !== null && voice.state === 'transcribing'
      ? q.downloadingModel(voice.modelProgress)
      : voice.state === 'transcribing'
        ? q.transcribing
        : recording
          ? q.listening
          : busy
            ? q.saving
            : voice.error
              ? voice.error
              : q.hint;

  return (
    <div className="flex items-center gap-[12px] px-[14px] pb-[12px] pt-[2px]">
      <Mascot state={mascotState} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex h-[38px] items-center gap-[6px] rounded-full pl-[16px] pr-[4px]" style={{ background: '#1A1A1F' }}>
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit(text, 'manual')}
            {...pin}
            placeholder={meeting ? q.meetingPlaceholder : q.placeholder}
            aria-label={q.placeholder}
            disabled={busy}
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-fg-3"
          />
          <button
            type="button"
            aria-label={recording ? q.stop : q.speak}
            aria-pressed={recording}
            onPointerDown={() => !recording && void voice.start()}
            onPointerUp={() => recording && void voice.stop()}
            onClick={(e) => e.preventDefault()}
            className={`relative flex h-[30px] w-[30px] items-center justify-center rounded-full transition-colors ${recording ? 'bg-red-500 text-white' : 'text-fg-2 hover:text-fg'}`}
          >
            {recording && <motion.span className="absolute inset-0 rounded-full bg-red-500/40" animate={{ scale: 1 + voice.level * 1.4 }} transition={{ duration: 0.08 }} />}
            <IconMic size={15} className="relative" />
          </button>
          <button type="button" aria-label={t.chat.send} disabled={!text.trim() || busy} onClick={() => void submit(text, 'manual')} className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white text-black disabled:opacity-40">
            <IconArrowUp size={14} />
          </button>
        </div>
        <AnimatePresence mode="wait">
          <motion.p key={status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-[5px] truncate pl-[16px] text-[11px] text-fg-3">
            {status}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
