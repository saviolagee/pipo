import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { Accessory, Attachment, MascotState } from '@shared/types';
import { Button } from '../components/Button';
import { usePinOnFocus } from '../components/Form';
import { IconArrowUp, IconFile, IconMic, IconPlus, IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { useChat } from '../store/chat';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { AttentionCard } from './AttentionCard';

const c = t.chat;

/** Markdown mínimo: **negrito**, `código`, listas e quebras de linha. */
function Rich({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n');
  const inline = (s: string, key: number): React.ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}-${i}`} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={`${key}-${i}`} className="mono rounded bg-white/[0.08] px-1 text-[12px]">{part.slice(1, -1)}</code>;
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });
  return (
    <div className="flex flex-col gap-[3px]">
      {lines.map((l, i) => {
        const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l);
        if (m) return <div key={i} className="flex gap-[6px] pl-[2px]"><span className="mono shrink-0 text-fg-3">{/\d/.test(m[1]) ? m[1] : '•'}</span><span>{inline(m[2], i)}</span></div>;
        if (!l.trim()) return <div key={i} className="h-[4px]" />;
        return <div key={i}>{inline(l.replace(/^#+\s*/, ''), i)}</div>;
      })}
    </div>
  );
}

function FileChip({ a, onRemove }: { a: Attachment; onRemove?: () => void }): React.JSX.Element {
  const ext = a.filename.split('.').pop()?.toLowerCase() ?? '';
  const color = ext === 'pdf' ? '#EF4444' : /png|jpe?g|gif|webp/.test(ext) ? '#22C55E' : /docx?/.test(ext) ? '#3B82F6' : '#A1A1AA';
  return (
    <span className="inline-flex h-[26px] max-w-[200px] items-center gap-[6px] rounded-[8px] pl-[7px] pr-[9px] text-[12px] text-fg" style={{ background: 'var(--bg-card-hover)' }}>
      <IconFile size={14} color={color} />
      <span className="truncate">{a.filename}</span>
      {onRemove && (
        <button type="button" aria-label={`${t.common.remove} ${a.filename}`} onClick={onRemove} className="text-fg-3 hover:text-fg">
          <IconX size={9} />
        </button>
      )}
    </span>
  );
}

export function ChatScreen({ mood, accessories, state }: { mood: number; accessories: Accessory[]; state: MascotState }): React.JSX.Element {
  const chat = useChat();
  const cards = useUi((s) => s.cards);
  const claude = useData((s) => s.claude);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pin = usePinOnFocus('chat');
  const actionCards = cards.filter((x) => x.kind === 'action');
  const allAtts = [...new Map([...chat.messages.flatMap((m) => m.attachments), ...chat.pending].map((a) => [a.id, a])).values()];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages.length, chat.streaming, actionCards.length, chat.error]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Prende o notch enquanto há conversa em andamento ou texto digitado.
  useEffect(() => {
    useUi.getState().pin('chat-busy', chat.busy || text.length > 0);
    return () => useUi.getState().pin('chat-busy', false);
  }, [chat.busy, text]);

  const submit = (v = text): void => {
    if (!v.trim()) return;
    void chat.send(v);
    setText('');
  };

  const empty = chat.messages.length === 0 && !chat.busy;

  return (
    <div className="flex flex-col px-[12px] pb-[12px]" style={{ height: 384 }}>
      <div className="flex min-h-[28px] items-center gap-[6px] pl-[66px]">
        {allAtts.map((a) => (
          <FileChip key={a.id} a={a} onRemove={chat.pending.some((p) => p.id === a.id) ? () => chat.removeAttachment(a.id) : undefined} />
        ))}
        <span className="flex-1" />
        {!empty && (
          <button type="button" onClick={chat.newConversation} className="flex items-center gap-1 text-[11px] text-fg-3 hover:text-fg" aria-label={c.newChat}>
            <IconPlus size={10} /> {c.newChat}
          </button>
        )}
      </div>

      <div ref={listRef} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto pl-[66px] pr-[4px]" style={{ background: 'radial-gradient(80% 60% at 50% 100%, rgba(99,102,241,0.08), transparent)' }}>
        {empty && (
          <div className="flex h-full flex-col items-start justify-center gap-[10px]">
            <p className="text-[13px] text-fg-2">{claude.state === 'ok' ? c.emptyHint : c.noClaude}</p>
            <div className="flex flex-wrap gap-[6px]">
              {c.suggestions.map((s) => (
                <button key={s} type="button" disabled={claude.state !== 'ok'} onClick={() => submit(s)} className="rounded-full px-[12px] py-[6px] text-[12px] text-fg transition-colors hover:bg-white/[0.1] disabled:opacity-40" style={{ background: 'var(--bg-card-hover)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-[12px] py-[8px]">
          {chat.messages.map((m) =>
            m.role === 'user' ? (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                <span className="max-w-[78%] whitespace-pre-wrap rounded-[16px] px-[14px] py-[7px] text-[13px] text-fg" style={{ background: '#26262B' }}>
                  {m.text}
                </span>
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-[90%] select-text text-[13px] leading-[1.5] text-fg">
                <Rich text={m.text} />
              </motion.div>
            ),
          )}
          {chat.busy && (
            <div className="max-w-[90%] select-text text-[13px] leading-[1.5] text-fg">
              {chat.streaming ? <Rich text={chat.streaming} /> : <span className="text-fg-3">{chat.tool ? c.usingTool(c.toolNames[chat.tool] ?? chat.tool) : c.thinking}</span>}
              {chat.streaming && chat.tool && <span className="mt-1 block text-[11px] text-fg-3">{c.usingTool(c.toolNames[chat.tool] ?? chat.tool)}</span>}
            </div>
          )}
          <AnimatePresence>
            {actionCards.map((card) => (
              <div key={card.id} className="-ml-[66px] -mr-[4px]">
                <AttentionCard card={card} mood={mood} accessories={accessories} />
              </div>
            ))}
          </AnimatePresence>
          {chat.error && (
            <div className="rounded-[12px] px-[12px] py-[10px] text-[12.5px]" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-fg">{c.errors[chat.error.code] ?? c.errors.failed}</p>
              <div className="mt-[8px] flex gap-[6px]">
                {(chat.error.code === 'not_logged' || chat.error.code === 'not_installed' || chat.error.code === 'unavailable') && (
                  <>
                    <Button size="sm" onClick={() => void api.invoke('app:openTerminal')}>
                      {t.onboarding.openTerminal}
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => void api.invoke('claude:status', true).then((s) => useData.getState().set({ claude: s }))}>
                      {t.common.retry}
                    </Button>
                  </>
                )}
                {(chat.error.code === 'failed' || chat.error.code === 'rate_limited') && chat.lastPrompt && (
                  <Button size="sm" variant="primary" onClick={() => submit(chat.lastPrompt ?? '')}>
                    {c.retry}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-[8px] flex items-end gap-[10px]">
        <div className="absolute -top-[58px] left-0">
          <Mascot state={chat.busy ? 'thinking' : chat.error ? 'sad' : state === 'happy' ? 'happy' : 'idle'} size={48} mood={mood} accessories={accessories.filter((a) => a !== 'coffee')} />
        </div>
        <div className="ml-[66px] flex h-[36px] flex-1 items-center gap-[6px] rounded-full pl-[16px] pr-[4px]" style={{ background: '#1A1A1F' }}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            {...pin}
            placeholder={c.placeholder}
            aria-label={c.placeholder}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-3"
          />
          <button type="button" aria-label={c.voice} onClick={() => useUi.setState({ voiceRequested: true, captureMode: false })} className="flex h-[28px] w-[28px] items-center justify-center rounded-full text-fg-2 hover:text-fg">
            <IconMic size={15} />
          </button>
          <button type="button" aria-label={c.send} disabled={!text.trim() || chat.busy} onClick={() => submit()} className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-white text-black disabled:opacity-40">
            <IconArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
