// Máquina de expressões do mascote (seção 6.2): deriva a expressão atual a partir do estado do app.
import { useEffect, useState } from 'react';
import { deriveMascotState } from '@shared/mascot-state';
import type { Accessory, GlowKind, MascotState, Profile } from '@shared/types';
import type { Badge } from './Mascot';
import { useData } from '../store/data';
import { useUi } from '../store/ui';


export function isWorkTime(profile: Profile | null, d = new Date()): boolean {
  if (!profile) return true;
  if (!profile.workDays.includes(d.getDay() as Profile['workDays'][number])) return false;
  const hm = d.getHours() * 60 + d.getMinutes();
  const toMin = (s: string): number => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  return hm >= toMin(profile.startTime) && hm < toMin(profile.endTime);
}

export function badgeFor(state: MascotState): Badge {
  if (state === 'attention') return 'attention';
  if (state === 'happy' || state === 'celebrating') return 'done';
  return null;
}

export function glowFor(state: MascotState, cardGlow: GlowKind | null): GlowKind {
  if (cardGlow && cardGlow !== 'none') return cardGlow;
  if (state === 'dizzy') return 'dizzy';
  if (state === 'eating') return 'done';
  if (state === 'attention') return 'attention';
  return 'none';
}

/** Hook com a expressão atual, acessórios, badge e glow. */
export function useMascot(hovered: boolean): { state: MascotState; accessories: Accessory[]; badge: Badge; glow: GlowKind; mood: number } {
  const [now, setNow] = useState(Date.now());
  const ui = useUi();
  const data = useData();
  const topCard = ui.cards[ui.cards.length - 1] ?? null;

  useEffect(() => {
    const next = ui.transient && ui.transient.until > Date.now() ? ui.transient.until - Date.now() + 10 : 30_000;
    const id = setTimeout(() => setNow(Date.now()), next);
    return () => clearTimeout(id);
  }, [ui.transient, now]);

  const stats = data.stats;
  const state = deriveMascotState({
    now,
    transient: ui.transient,
    cardMascot: topCard?.mascot ?? null,
    agentBusy: ui.agentBusy,
    dragOver: ui.dragOver,
    listening: ui.voiceRequested,
    inMeeting: data.inMeeting,
    paused: data.settings?.paused ?? false,
    music: (data.settings?.reactions.music ?? true) && data.nowPlaying?.playing === true,
    hovered,
    outsideWorkHours: !isWorkTime(data.profile),
    idleLong: data.activity?.category === 'idle',
    overGoalRatio: stats && stats.goalMin > 0 ? stats.workedMin / stats.goalMin : 0,
  });

  const accessories: Accessory[] = ui.debug.accessories ? [...ui.debug.accessories] : [...data.streak.equipped];
  // Folga, férias, feriado ou doente: pijama (Fase 15).
  const today = data.today;
  if (today && ['off', 'vacation', 'holiday', 'sick'].includes(today.kind) && !ui.debug.accessories) accessories.push('pajama', 'nightcap');
  const finalState = ui.debug.state ?? state;
  if (finalState === 'working' && !ui.debug.accessories) accessories.push('coffee');
  if (finalState === 'dancing' && !accessories.includes('headphones')) accessories.push('headphones');
  return {
    state: finalState,
    accessories,
    badge: badgeFor(finalState),
    glow: ui.glowOverride ?? glowFor(finalState, topCard?.glow ?? null),
    mood: ui.debug.mood ?? data.mood.mood,
  };
}
