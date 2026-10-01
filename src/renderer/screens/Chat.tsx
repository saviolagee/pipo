import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { Accessory, Attachment, Card, MascotState } from '@shared/types';
import { Button } from '../components/Button';
import { usePinOnFocus } from '../components/Form';
import { IconArrowUp, IconFile, IconMic, IconPlus, IconSpark, IconX } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { prettyModel } from '@shared/models';
import type { DraftInfo } from '@shared/pipos';
import { suggestCommands } from '../lib/commands';
import { api } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { useChat } from '../store/chat';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { AttentionCard } from './AttentionCard';
import { useVoice } from '../voice/useVoice';

const c = t.chat;

/** Cards que aparecem dentro da conversa (não por cima). */
export const INLINE_CARD_KINDS: Card['kind'][] = ['action', 'pipo_plan', 'pipo_secret'];

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

const STAGE_ORDER: DraftInfo['stage'][] = ['start', 'personality', 'interview', 'connections', 'plan', 'rehearsal', 'hire'];

/** Barra discreta das 7 etapas do /criarpipo. */
function DraftBar({ draft }: { draft: DraftInfo }): React.JSX.Element {
  const at = STAGE_ORDER.indexOf(draft.stage);
  const color = draft.color ?? '#F4F4F5';
  return (
    <div className="flex items-center gap-[8px] pb-[6px] pl-[66px] pr-[4px]" aria-label={`${t.team.stages[draft.stage]} (${at + 1}/7)`}>
      <span className="h-[8px] w-[8px] shrink-0 rounded-[3px]" style={{ background: draft.name ? color : 'transparent', border: draft.name ? 'none' : '1px dashed #71717A' }} />
      <span className="shrink-0 text-[11.5px] font-medium text-fg">{draft.name ?? 'Pipo novo'}</span>
      {draft.editing && <span className="shrink-0 text-[10.5px] text-fg-3">{t.team.editing}</span>}
      <div className="flex flex-1 items-center gap-[3px]">
        {STAGE_ORDER.map((s, i) => (
          <div key={s} className="flex flex-1 flex-col gap-[2px]" title={t.team.stages[s]}>
            <motion.div className="h-[3px] rounded-full" initial={false} animate={{ background: i <= at ? color : 'rgba(255,255,255,0.1)' }} transition={{ duration: 0.3 }} />
          </div>
        ))}
      </div>
      <span className="w-[78px] shrink-0 text-right text-[10.5px] text-fg-2">{t.team.stages[draft.stage]}</span>
    </div>
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
  const actionCards = cards.filter((x) => INLINE_CARD_KINDS.includes(x.kind));
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

  const voice = useVoice((v) => submit(v));
  const suggestions = suggestCommands(text);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [text]);
  const complete = (name: string): void => {
    setText(`/${name} `);
    inputRef.current?.focus();
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

      {chat.draft && <DraftBar draft={chat.draft} />}
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
          {chat.messages.map((m, i) =>
            m.role === 'user' ? (
              <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                <span className="max-w-[78%] whitespace-pre-wrap rounded-[16px] px-[14px] py-[7px] text-[13px] text-fg" style={{ background: '#26262B' }}>
                  {m.text}
                </span>
              </motion.div>
            ) : (
              <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group max-w-[90%] select-text text-[13px] leading-[1.5] text-fg">
                <Rich text={m.text} />
                <div className="mt-[3px] flex h-[16px] items-center gap-[10px] text-[10.5px] text-fg-3">
                  {m.model && <span title={m.model}>{prettyModel(m.model)}</span>}
                  {i === chat.messages.length - 1 && !chat.busy && (
                    <button type="button" onClick={() => void chat.thinkMore()} className="flex items-center gap-[4px] text-fg-3 transition-colors hover:text-fg" title={c.thinkMoreHint}>
                      <IconSpark size={9} /> {c.thinkMore}
                    </button>
                  )}
                </div>
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

      {chat.draft?.stage === 'start' && !chat.busy && chat.messages.length <= 2 && (
        <div className="flex flex-wrap gap-[5px] pl-[66px] pt-[4px]">
          {t.team.ideas.map((idea) => (
            <button key={idea} type="button" onClick={() => submit(idea)} className="rounded-full px-[10px] py-[4px] text-[11.5px] text-fg-2 transition-colors hover:bg-white/[0.1] hover:text-fg" style={{ background: 'var(--bg-card-hover)' }}>
              {idea}
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-[8px] flex items-end gap-[10px]">
        {suggestions.length > 0 && (
          <div className="absolute bottom-[42px] left-[66px] z-10 w-[340px] rounded-[12px] p-[4px]" role="listbox" style={{ background: '#161618', border: '1px solid var(--border-subtle)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            {suggestions.map((s, i) => (
              <button
                key={s.name}
                type="button"
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => {
                  e.preventDefault();
                  complete(s.name);
                }}
                className={`flex w-full items-baseline gap-[8px] rounded-[8px] px-[10px] py-[5px] text-left ${i === sel ? 'bg-white/[0.08]' : ''}`}
              >
                <span className="mono text-[12px] text-fg">/{s.name}</span>
                <span className="truncate text-[11.5px] text-fg-3">{s.hint}</span>
              </button>
            ))}
          </div>
        )}
        <div className="absolute -top-[58px] left-0">
          <Mascot state={chat.busy ? 'thinking' : chat.error ? 'sad' : state === 'happy' ? 'happy' : 'idle'} size={48} mood={mood} accessories={accessories.filter((a) => a !== 'coffee')} />
        </div>
        <div className="ml-[66px] flex h-[36px] flex-1 items-center gap-[6px] rounded-full pl-[16px] pr-[4px]" style={{ background: '#1A1A1F' }}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setSel((v) => (v + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                return;
              }
              if (suggestions.length && (e.key === 'Tab' || (e.key === 'Enter' && text.trim() !== `/${suggestions[sel].name}`))) {
                e.preventDefault();
                complete(suggestions[sel].name);
                return;
              }
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
          <button
            type="button"
            aria-label={c.voice}
            aria-pressed={voice.state === 'recording'}
            onClick={() => void voice.toggle()}
            title={voice.error ?? undefined}
            className={`flex h-[28px] w-[28px] items-center justify-center rounded-full ${voice.state === 'recording' ? 'bg-red-500 text-white' : 'text-fg-2 hover:text-fg'}`}
          >
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
