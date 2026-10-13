import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { keyOf, type Goal } from '@shared/trail';
import { api } from '../lib/api';

interface GoalsState {
  list: Goal[];
  /** Plano aberto na aba Trilha. */
  selectedId: number | null;
  load: () => Promise<void>;
  select: (id: number | null) => void;
}

export const useGoals = create<GoalsState>((set) => ({
  list: [],
  selectedId: null,
  load: async () => set({ list: await api.invoke('goals:list') }),
  select: (selectedId) => set({ selectedId }),
}));

export function bindGoalEvents(): () => void {
  void useGoals.getState().load();
  return api.on('goals:changed', (list) => useGoals.setState({ list }));
}

/** Dia de hoje (AAAA-MM-DD), atualizado na virada do dia. */
export function useToday(): string {
  const [today, setToday] = useState(() => keyOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const now = keyOf(new Date());
      setToday((t) => {
        // Virou o dia: o main recalcula a trilha e devolve os dias novos.
        if (t !== now) void useGoals.getState().load();
        return now;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}
