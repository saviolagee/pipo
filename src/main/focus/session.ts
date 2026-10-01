// Sessão de foco (seção 9.3): ritual → ciclos de foco/pausa → concluído. O timer roda no main.
import type { FocusPreset, FocusState, Task } from '@shared/types';
import { bus, emit } from '../bus';
import { showCard } from '../cards';
import { db } from '../db';
import { getProfile } from '../db/repos/profile';
import { listRituals } from '../db/repos/rituals';
import { getKV, setKV } from '../db/repos/settings';
import { getTask, listTasks } from '../db/repos/tasks';
import { pauseMusic, resumeMusic, startMusic, stopMusic } from '../music';
import { dayKey } from '../time';
import { pickNextTask } from '@shared/suggest';
import { fmtDuration } from './format';

import { app } from 'electron';

/** Acelera o relógio em desenvolvimento para testes (PIPO_TIME_SCALE=300 → 25 min em 5 s). */
const TIME_SCALE = !app.isPackaged && process.env.PIPO_TIME_SCALE ? Number(process.env.PIPO_TIME_SCALE) : 1;

let state: FocusState | null = null;
let preset: FocusPreset | null = null;
let ticker: NodeJS.Timeout | null = null;
let lastTick = 0;
let phaseElapsedMs = 0;
let waitingCard = false;
let stretchEvery = 0;

/** Hooks de outros módulos (distrações, humor, agente). */
export const focusHooks: {
  onStart: Array<(s: FocusState) => void>;
  onPhase: Array<(s: FocusState) => void>;
  onEnd: Array<(s: FocusState, completed: boolean) => void>;
  proposeSubtasks: ((task: Task) => Promise<void>) | null;
} = { onStart: [], onPhase: [], onEnd: [], proposeSubtasks: null };

export function focusState(): FocusState | null {
  return state;
}

function publish(): void {
  emit('focus:state', state ? { ...state } : null);
  bus.emit('focus:changed', null);
}

function phaseDuration(phase: FocusState['phase'], p: FocusPreset): number {
  if (phase === 'focus') return p.focusMin * 60;
  if (phase === 'break') return p.breakMin * 60;
  if (phase === 'longBreak') return p.longBreakMin * 60;
  return 0;
}

function enterPhase(phase: FocusState['phase'], durationSec?: number): void {
  if (!state || !preset) return;
  state.phase = phase;
  state.phaseStartedAt = Date.now();
  state.phaseDurationSec = durationSec ?? phaseDuration(phase, preset);
  state.remainingSec = state.phaseDurationSec;
  state.paused = false;
  phaseElapsedMs = 0;
  lastTick = Date.now();
  focusHooks.onPhase.forEach((h) => h(state as FocusState));
  publish();
}

function persist(): void {
  if (!state) return;
  db().run('UPDATE focus_sessions SET cycles_done = ?, focused_sec = ?, distracted_sec = ? WHERE id = ?', state.cycle - 1, Math.round(state.focusedSec), Math.round(state.distractedSec), state.sessionId);
}

function tick(): void {
  if (!state) return;
  const now = Date.now();
  const dt = (now - lastTick) * TIME_SCALE;
  lastTick = now;
  if (state.paused || state.phase === 'ritual' || waitingCard) return;
  phaseElapsedMs += dt;
  if (state.phase === 'focus') {
    state.focusedSec += dt / 1000;
    // A cada 10 min, uma espreguiçada curta para lembrar que está ali.
    stretchEvery += dt;
    if (stretchEvery >= 10 * 60_000) {
      stretchEvery = 0;
      emit('mascot:react', { state: 'happy', ms: 900 });
    }
  }
  state.remainingSec = Math.max(0, Math.ceil(state.phaseDurationSec - phaseElapsedMs / 1000));
  if (Math.round(phaseElapsedMs / 1000) % 15 === 0) persist();
  if (state.remainingSec <= 0) void onPhaseEnd();
  else publish();
}

async function onPhaseEnd(): Promise<void> {
  if (!state || !preset || waitingCard) return;
  waitingCard = true;
  publish();
  const s = state;
  try {
    if (s.phase === 'focus') {
      const cyclesDone = s.cycle;
      persist();
      if (cyclesDone >= s.totalCycles) {
        waitingCard = false;
        await completeSession();
        return;
      }
      const answer = await showCard({
        kind: 'pomodoro_end',
        glow: 'attention',
        mascot: 'attention',
        label: 'fim do ciclo',
        subject: `${preset.focusMin} min · ciclo ${cyclesDone}/${s.totalCycles}`,
        buttons: [
          { id: 'continue', label: 'Continuar', kbd: 'N', variant: 'secondary' },
          { id: 'break', label: 'Pausa', kbd: 'Y', variant: 'primary' },
        ],
      });
      waitingCard = false;
      if (!state || state.sessionId !== s.sessionId) return;
      state.cycle = cyclesDone + 1;
      if (answer === 'continue') {
        enterPhase('focus');
      } else {
        const long = cyclesDone % 4 === 0;
        await pauseMusic();
        state.musicActive = false;
        emit('mascot:react', { state: 'happy', ms: 1000 });
        enterPhase(long ? 'longBreak' : 'break');
      }
    } else if (s.phase === 'break' || s.phase === 'longBreak') {
      const answer = await showCard({
        kind: 'break_end',
        glow: 'attention',
        mascot: 'attention',
        label: 'fim da pausa',
        subject: 'Pausa acabou',
        buttons: [
          { id: 'more', label: '+2 min', kbd: 'N', variant: 'secondary' },
          { id: 'back', label: 'Voltar', kbd: 'Y', variant: 'primary' },
        ],
      });
      waitingCard = false;
      if (!state || state.sessionId !== s.sessionId) return;
      if (answer === 'more') {
        enterPhase(s.phase, 120);
      } else {
        state.musicActive = (await resumeMusicIfAny()) || state.musicActive;
        enterPhase('focus');
      }
    }
  } finally {
    waitingCard = false;
  }
}

async function resumeMusicIfAny(): Promise<boolean> {
  const r = listRituals().find((x) => x.kind === 'music' && x.enabled);
  if (!r) return false;
  await resumeMusic();
  return true;
}

function ritualsPending(): boolean {
  const skipDay = getKV<string | null>('skipRitualsDay', null);
  if (skipDay === dayKey(new Date())) return false;
  return listRituals().some((r) => r.enabled && (r.kind !== 'custom' || (r.config as { remind?: boolean }).remind !== false));
}

export async function startFocus(opts: { taskId: number | null; minutes?: number; microStep?: string | null; skipRituals?: boolean }): Promise<FocusState> {
  if (state) await stopFocus(false);
  const profile = getProfile();
  const base = profile?.focusPreset ?? { id: 'p25', focusMin: 25, breakMin: 5, longBreakMin: 15, cycles: 4 };
  preset = opts.minutes ? { ...base, id: 'custom', focusMin: opts.minutes, cycles: 1 } : { ...base };
  const task = opts.taskId ? getTask(opts.taskId) : null;
  const now = new Date();
  const { lastId } = db().run(
    "INSERT INTO focus_sessions (task_id, started_at, preset_json, micro_step, status) VALUES (?, ?, ?, ?, 'active')",
    task?.id ?? null,
    now.toISOString(),
    JSON.stringify(preset),
    opts.microStep ?? null,
  );
  state = {
    sessionId: lastId,
    taskId: task?.id ?? null,
    taskTitle: opts.microStep ?? task?.title ?? 'Foco livre',
    phase: 'ritual',
    cycle: 1,
    totalCycles: preset.cycles,
    phaseStartedAt: Date.now(),
    phaseDurationSec: preset.focusMin * 60,
    remainingSec: preset.focusMin * 60,
    paused: false,
    microStep: opts.microStep ?? null,
    musicActive: false,
    focusedSec: 0,
    distractedSec: 0,
  };
  stretchEvery = 0;
  if (task && task.status === 'todo') db().run("UPDATE tasks SET status = 'doing' WHERE id = ?", task.id);
  if (!ticker) ticker = setInterval(tick, 1000);

  // Música começa junto com o ritual e o Pipo coloca o fone.
  state.musicActive = await startMusic().catch(() => false);
  const skip = opts.skipRituals || !!opts.microStep || !ritualsPending();
  if (skip) enterPhase('focus');
  else publish();
  focusHooks.onStart.forEach((h) => h(state as FocusState));

  // Sem subtarefas: o agente propõe de 3 a 5 (com confirmação).
  if (task && task.subtasks.length === 0 && !opts.microStep && focusHooks.proposeSubtasks) {
    void focusHooks.proposeSubtasks(task).catch((e) => console.warn('[foco] proposta de subtarefas falhou:', e));
  }
  return { ...state };
}

export function ritualDone(skipToday = false): FocusState | null {
  if (!state || state.phase !== 'ritual') return state;
  if (skipToday) setKV('skipRitualsDay', dayKey(new Date()));
  enterPhase('focus');
  return { ...state };
}

export function pauseFocus(): FocusState | null {
  if (state) {
    state.paused = true;
    publish();
  }
  return state;
}

export function resumeFocus(): FocusState | null {
  if (state) {
    state.paused = false;
    lastTick = Date.now();
    publish();
  }
  return state;
}

export function skipPhase(): FocusState | null {
  if (state && state.phase !== 'ritual') {
    phaseElapsedMs = state.phaseDurationSec * 1000;
    tick();
  }
  return state;
}

export function addDistracted(sec: number): void {
  if (state && state.phase === 'focus' && !state.paused) state.distractedSec += sec;
}

async function completeSession(): Promise<void> {
  if (!state) return;
  const s = { ...state };
  const task = s.taskId ? getTask(s.taskId) : null;
  await endSession(true);
  bus.emit('focus:completed', { sessionId: s.sessionId, taskId: s.taskId });
  const done = task ? task.subtasks.filter((x) => x.done).length : 0;
  const total = task?.subtasks.length ?? 0;
  if (s.microStep) {
    // Destravar (9.6): terminou o passo de 2 minutos → continua num foco normal?
    const next = await showCard({
      kind: 'done',
      glow: 'done',
      mascot: 'happy',
      label: 'primeiro passo feito',
      title: s.microStep,
      body: 'Continua num foco normal?',
      buttons: [
        { id: 'no', label: 'Por hoje chega', kbd: 'N', variant: 'secondary' },
        { id: 'go', label: 'Continuar', kbd: 'Y', variant: 'primary' },
      ],
    });
    if (next === 'go' && s.taskId) await startFocus({ taskId: s.taskId, skipRituals: true });
    return;
  }
  const answer = await showCard({
    kind: 'done',
    glow: 'done',
    mascot: 'happy',
    label: 'sessão concluída',
    title: total ? `${s.taskTitle} · ${done}/${total}` : s.taskTitle,
    body: `${fmtDuration(s.focusedSec)} focado`,
    buttons: [
      { id: 'next', label: 'Próxima tarefa', kbd: 'Y', variant: 'primary' },
      { id: 'ok', label: 'OK', variant: 'secondary' },
    ],
    autoDismissMs: 6000,
  });
  if (answer === 'next') {
    const p = getProfile();
    const next = pickNextTask(listTasks('open').filter((x) => x.id !== s.taskId), new Date(), p?.energyPeak ?? 'varies');
    if (next) await startFocus({ taskId: next.id });
  }
}

async function endSession(completed: boolean): Promise<void> {
  if (!state) return;
  const s = state;
  persist();
  db().run('UPDATE focus_sessions SET ended_at = ?, status = ?, cycles_done = ? WHERE id = ?', new Date().toISOString(), completed ? 'completed' : 'abandoned', completed ? s.totalCycles : s.cycle - 1, s.sessionId);
  if (s.taskId) db().run("UPDATE tasks SET status = 'todo' WHERE id = ? AND status = 'doing'", s.taskId);
  state = null;
  preset = null;
  waitingCard = false;
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  await stopMusic();
  focusHooks.onEnd.forEach((h) => h(s, completed));
  publish();
}

export async function stopFocus(completed: boolean): Promise<void> {
  if (!state) return;
  if (completed) await completeSession();
  else await endSession(false);
}
