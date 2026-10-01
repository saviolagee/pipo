import { create } from 'zustand';
import type { Accessory, Card, GlowKind, MascotState, Toast } from '@shared/types';

export type Tab = 'home' | 'tasks' | 'chat' | 'team' | 'add' | 'settings' | 'review';

interface UiState {
  expanded: boolean;
  tab: Tab;
  /** Motivos que impedem o colapso automático (input com foco, card, onboarding…). */
  pins: Record<string, boolean>;
  /** Momento do último pagamento da Stripe (a pill pisca o valor). */
  moneyFlash: number;
  cards: Card[];
  toasts: Toast[];
  /** Expressão temporária por cima da expressão derivada. */
  transient: { state: MascotState; until: number } | null;
  speech: { text: string; until: number } | null;
  glowOverride: GlowKind | null;
  dragOver: boolean;
  captureMode: boolean;
  /** Captura pós-reunião: o texto vira tarefas pelo agente (com confirmação). */
  capturePurpose: 'meeting' | null;
  weeklyReview: boolean;
  voiceRequested: boolean;
  debugOpen: boolean;
  entranceKey: number;
  confettiKey: number;
  confettiCount: number;
  agentBusy: boolean;
  /** Overrides do painel de debug (Ctrl+Alt+D). */
  debug: { state: MascotState | null; mood: number | null; accessories: Accessory[] | null };
  setExpanded: (v: boolean) => void;
  setTab: (tab: Tab, expand?: boolean) => void;
  pin: (key: string, on: boolean) => void;
  pushCard: (c: Card) => void;
  dropCard: (id: string) => void;
  pushToast: (t: Toast) => void;
  dropToast: (id: string) => void;
  react: (state: MascotState, ms: number) => void;
  say: (text: string, ms: number) => void;
  set: (p: Partial<UiState>) => void;
  confetti: (count: number) => void;
}

export const useUi = create<UiState>((set) => ({
  expanded: false,
  tab: 'home',
  pins: {},
  moneyFlash: 0,
  cards: [],
  toasts: [],
  transient: null,
  speech: null,
  glowOverride: null,
  dragOver: false,
  captureMode: false,
  capturePurpose: null,
  weeklyReview: false,
  voiceRequested: false,
  debugOpen: false,
  entranceKey: 0,
  confettiKey: 0,
  confettiCount: 0,
  agentBusy: false,
  debug: { state: null, mood: null, accessories: null },
  setExpanded: (expanded) => set({ expanded }),
  setTab: (tab, expand = true) => set((s) => ({ tab, expanded: expand ? true : s.expanded, captureMode: tab === 'add' ? s.captureMode : false })),
  pin: (key, on) =>
    set((s) => {
      if (!!s.pins[key] === on) return s;
      const pins = { ...s.pins };
      if (on) pins[key] = true;
      else delete pins[key];
      return { pins };
    }),
  pushCard: (c) => set((s) => ({ cards: [...s.cards.filter((x) => x.id !== c.id), c] })),
  dropCard: (id) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== t.id), t] })),
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  react: (state, ms) => set({ transient: { state, until: Date.now() + ms } }),
  say: (text, ms) => set({ speech: { text, until: Date.now() + ms } }),
  set: (p) => set(p),
  confetti: (count) => set((s) => ({ confettiKey: s.confettiKey + 1, confettiCount: count })),
}));

export const isPinned = (pins: Record<string, boolean>): boolean => Object.keys(pins).length > 0;
