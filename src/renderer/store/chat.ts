import { create } from 'zustand';
import type { AgentErrorCode, Attachment, ChatMessage } from '@shared/types';
import { isFocusNextIntent } from '@shared/intents';
import { api } from '../lib/api';
import { matchCommand } from '../lib/commands';
import { focusNext } from '../lib/focus';
import { play } from '../sound/sfx';
import { useUi } from './ui';

interface ChatState {
  conversationId: number | null;
  messages: ChatMessage[];
  streaming: string;
  busy: boolean;
  tool: string | null;
  error: { code: AgentErrorCode; message: string } | null;
  lastPrompt: string | null;
  pending: Attachment[];
  send: (text: string) => Promise<void>;
  /** Refaz a última resposta com o Opus e effort alto. */
  thinkMore: () => Promise<void>;
  newConversation: () => void;
  addAttachments: (a: Attachment[]) => void;
  removeAttachment: (id: number) => void;
  reload: () => Promise<void>;
}

let tempId = -1;

export const useChat = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  streaming: '',
  busy: false,
  tool: null,
  error: null,
  lastPrompt: null,
  pending: [],
  send: async (text) => {
    const t = text.trim();
    if (!t || get().busy) return;
    // Comandos com "/" (ex.: /ferias 10 a 20 de dez) rodam no app.
    const slash = matchCommand(t);
    if (slash) {
      await slash.cmd.run(slash.args);
      return;
    }
    // "foca na próxima": o app resolve na hora, sem esperar o agente.
    if (isFocusNextIntent(t) && !get().pending.length) {
      await focusNext();
      return;
    }
    const atts = get().pending;
    const optimistic: ChatMessage = { id: tempId--, conversationId: get().conversationId ?? 0, role: 'user', text: t, attachments: atts, createdAt: new Date().toISOString() };
    set((s) => ({ messages: [...s.messages, optimistic], pending: [], busy: true, streaming: '', error: null, tool: null, lastPrompt: t }));
    useUi.setState({ agentBusy: true });
    try {
      const r = await api.invoke('agent:send', { conversationId: get().conversationId, text: t, attachmentIds: atts.map((a) => a.id) });
      set({ conversationId: r.conversationId });
    } catch (e) {
      set({ busy: false, error: { code: 'failed', message: e instanceof Error ? e.message : String(e) } });
      useUi.setState({ agentBusy: false });
    }
  },
  thinkMore: async () => {
    const id = get().conversationId;
    if (!id || get().busy) return;
    set({ busy: true, streaming: '', error: null, tool: null });
    useUi.setState({ agentBusy: true });
    try {
      await api.invoke('agent:send', { conversationId: id, text: '', thinkMore: true });
    } catch (e) {
      set({ busy: false, error: { code: 'failed', message: e instanceof Error ? e.message : String(e) } });
      useUi.setState({ agentBusy: false });
    }
  },
  newConversation: () => set({ conversationId: null, messages: [], streaming: '', error: null, busy: false, tool: null }),
  addAttachments: (a) => set((s) => ({ pending: [...s.pending, ...a.filter((x) => !s.pending.some((p) => p.id === x.id))] })),
  removeAttachment: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),
  reload: async () => {
    const id = get().conversationId;
    if (id) set({ messages: await api.invoke('agent:messages', id) });
  },
}));

/** Liga os eventos do agente ao chat e ao mascote (seção 11.4). */
export function bindAgentEvents(): () => void {
  return api.on('agent:event', (e) => {
    const s = useChat.getState();
    if (s.conversationId !== null && e.conversationId !== s.conversationId && e.type !== 'start') return;
    switch (e.type) {
      case 'start':
        useChat.setState({ conversationId: e.conversationId, busy: true, streaming: '', error: null });
        useUi.setState({ agentBusy: true });
        break;
      case 'delta':
        useChat.setState((st) => ({ streaming: st.streaming + e.text, tool: null }));
        break;
      case 'tool':
        // Narração antes da ferramenta some; fica só a resposta final.
        useChat.setState({ tool: e.name, streaming: '' });
        break;
      case 'done':
        useChat.setState({ busy: false, tool: null });
        useUi.setState({ agentBusy: false });
        useUi.getState().react('happy', 1200);
        void useChat
          .getState()
          .reload()
          .then(() => useChat.setState({ streaming: '' }));
        break;
      case 'error':
        useChat.setState({ busy: false, tool: null, streaming: '', error: { code: e.code, message: e.message } });
        useUi.setState({ agentBusy: false });
        useUi.getState().react('sad', 3000);
        play('alert');
        break;
    }
  });
}
