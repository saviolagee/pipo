// Prioridade das expressões do mascote (seção 6.2). Função pura, testada em tests/music.test.ts.
import type { FocusState, MascotState } from './types';

export interface MascotInputs {
  now: number;
  transient: { state: MascotState; until: number } | null;
  cardMascot: MascotState | null;
  agentBusy: boolean;
  dragOver: boolean;
  listening: boolean;
  inMeeting: boolean;
  paused: boolean;
  /** Música tocando e a reação "dançar" ligada. */
  music: boolean;
  focus: FocusState | null;
  hovered: boolean;
  outsideWorkHours: boolean;
  idleLong: boolean;
  overGoalRatio: number;
}

/** Ordem de prioridade: reação temporária > card > agente > drop > voz > reunião > pausado > música > foco > cansado > sono > hover > idle. */
export function deriveMascotState(i: MascotInputs): MascotState {
  if (i.transient && i.transient.until > i.now) return i.transient.state;
  if (i.cardMascot) return i.cardMascot;
  if (i.agentBusy) return 'thinking';
  if (i.dragOver) return 'eating';
  if (i.listening) return 'listening';
  if (i.inMeeting) return 'shh';
  if (i.paused) return 'sleepy';
  if (i.music) return 'dancing';
  if (i.focus && !i.focus.paused && i.focus.phase === 'focus') return 'working';
  if (i.overGoalRatio >= 1.25) return 'tired';
  if (i.outsideWorkHours || i.idleLong) return 'sleepy';
  if (i.hovered) return 'looking';
  return 'idle';
}
