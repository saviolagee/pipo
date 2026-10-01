// Máquina de expressões do mascote (seção 6.2): deriva a expressão atual a partir do estado do app.
import { useEffect, useState } from 'react';
import type { Accessory, FocusState, GlowKind, MascotState, Profile } from '@shared/types';
import type { Badge } from './Mascot';
import { useData } from '../store/data';
import { useUi } from '../store/ui';

export interface MascotInputs {
  now: number;
  transient: { state: MascotState; until: number } | null;
  cardMascot: MascotState | null;
  agentBusy: boolean;
  dragOver: boolean;
  listening: boolean;
  inMeeting: boolean;
  paused: boolean;
  focus: FocusState | null;
  hovered: boolean;
  outsideWorkHours: boolean;
  idleLong: boolean;
  overGoalRatio: number;
}

/** Ordem de prioridade: reação temporária > card > agente > drop > voz > reunião > pausado > foco > cansado > sono > hover > idle. */
export function deriveMascotState(i: MascotInputs): MascotState {
  if (i.transient && i.transient.until > i.now) return i.transient.state;
  if (i.cardMascot) return i.cardMascot;
  if (i.agentBusy) return 'thinking';
  if (i.dragOver) return 'eating';
  if (i.listening) return 'listening';
  if (i.inMeeting) return 'shh';
  if (i.paused) return 'sleepy';
  if (i.focus && !i.focus.paused && i.focus.phase === 'focus') return 'working';
  if (i.overGoalRatio >= 1.25) return 'tired';
  if (i.outsideWorkHours || i.idleLong) return 'sleepy';
  if (i.hovered) return 'looking';
  return 'idle';
}

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

export function badgeFor(state: MascotState, focus: FocusState | null): Badge {
  if (state === 'attention') return 'attention';
  if (state === 'happy' || state === 'celebrating') return 'done';
  if (focus && focus.phase === 'focus') return 'working';
  return null;
}

export function glowFor(state: MascotState, focus: FocusState | null, cardGlow: GlowKind | null): GlowKind {
  if (cardGlow && cardGlow !== 'none') return cardGlow;
  if (state === 'dizzy') return 'dizzy';
  if (state === 'eating') return 'done';
  if (state === 'attention') return 'attention';
  if (focus && focus.phase === 'focus' && !focus.paused) return 'focus';
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
    focus: data.focus,
    hovered,
    outsideWorkHours: !isWorkTime(data.profile),
    idleLong: data.activity?.category === 'idle',
    overGoalRatio: stats && stats.goalMin > 0 ? stats.workedMin / stats.goalMin : 0,
  });

  const accessories: Accessory[] = [...data.streak.equipped];
  if (data.focus?.musicActive && data.focus.phase === 'focus') accessories.push('headphones');
  if (state === 'working') accessories.push('coffee');

  return {
    state,
    accessories,
    badge: badgeFor(state, data.focus),
    glow: ui.glowOverride ?? glowFor(state, data.focus, topCard?.glow ?? null),
    mood: data.mood.mood,
  };
}
