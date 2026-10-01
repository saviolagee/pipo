// Equipe de Pipos coloridos no renderer: lista, estado ao vivo e seleção.
import { create } from 'zustand';
import type { PipoLive, PipoSummary } from '@shared/pipos';
import { api } from '../lib/api';

interface PiposState {
  list: PipoSummary[];
  loaded: boolean;
  /** Pipo aberto na Equipe (detalhe/execução). */
  openId: number | null;
  openRunId: number | null;
  load: () => Promise<void>;
  setLive: (l: PipoLive) => void;
  open: (id: number | null, runId?: number | null) => void;
}

export const usePipos = create<PiposState>((set) => ({
  list: [],
  loaded: false,
  openId: null,
  openRunId: null,
  load: async () => set({ list: await api.invoke('pipos:list'), loaded: true }),
  setLive: (l) => set((s) => ({ list: s.list.map((p) => (p.id === l.pipoId ? { ...p, live: l } : p)) })),
  open: (id, runId = null) => set({ openId: id, openRunId: runId }),
}));

export function bindPipoEvents(): () => void {
  const offs = [api.on('pipos:changed', (list) => usePipos.setState({ list, loaded: true })), api.on('pipos:live', (l) => usePipos.getState().setLive(l))];
  void usePipos.getState().load();
  return () => offs.forEach((o) => o());
}
