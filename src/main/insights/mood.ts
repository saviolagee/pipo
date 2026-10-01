// Humor do Pipo (seção 6.3): reflete como está o dia e a semana. 0–100.
import type { MoodComponents, MoodInfo, Tone } from '@shared/types';
import { emit } from '../bus';
import { db } from '../db';
import { getProfile } from '../db/repos/profile';
import { focusMinutes, statsFor } from '../stats';
import { addDays, dayRange } from '../time';

export interface DayInputs {
  plannedTasks: number;
  doneTasks: number;
  focusCompleted: number;
  focusAbandoned: number;
  focusMin: number;
  distractedMin: number;
  workedMin: number;
  goalMin: number;
}

const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));

/** Humor do dia (0–100) e seus componentes. Funções puras: tests/mood.test.ts. */
export function dayMood(d: DayInputs): { score: number; adherence: number; focusCompletion: number; distraction: number; overworkPenalty: number } {
  // Sem dado ainda, cada componente começa neutro (0.5) para o humor não despencar de manhã.
  const adherence = d.plannedTasks > 0 ? clamp(d.doneTasks / d.plannedTasks) : 0.5;
  const sessions = d.focusCompleted + d.focusAbandoned;
  const focusCompletion = sessions > 0 ? d.focusCompleted / sessions : 0.5;
  const distraction = d.focusMin + d.distractedMin > 0 ? clamp(d.distractedMin / (d.focusMin + d.distractedMin)) : 0;
  const progress = d.goalMin > 0 ? clamp(d.workedMin / d.goalMin) : 0.5;
  // Passar muito da meta também baixa o humor: o Pipo quer a meta, não trabalho infinito.
  const ratio = d.goalMin > 0 ? d.workedMin / d.goalMin : 0;
  const overworkPenalty = ratio > 1.1 ? clamp((ratio - 1.1) * 1.5, 0, 0.6) : 0;
  const base = 0.35 * adherence + 0.3 * focusCompletion + 0.2 * (1 - distraction) + 0.15 * progress;
  return { score: Math.round(clamp(base - overworkPenalty) * 100), adherence, focusCompletion, distraction, overworkPenalty };
}

/** Mistura: 60% hoje, 40% média móvel de 7 dias. */
export function blendMood(today: number, last7: number[]): number {
  if (!last7.length) return today;
  const avg = last7.reduce((a, b) => a + b, 0) / last7.length;
  return Math.round(0.6 * today + 0.4 * avg);
}

const PHRASES: Record<Tone, Record<'high' | 'normal' | 'low' | 'veryLow', string[]>> = {
  cute: {
    high: ['Tô animado, semana tá rendendo!', 'Que dia bom! Bora manter o ritmo?', 'A gente tá voando hoje.'],
    normal: ['Bora fazer uma coisa de cada vez?', 'Tô aqui do seu lado.', 'Um foco por vez e a gente chega lá.'],
    low: ['Hoje tá difícil né? Bora só uma tarefinha.', 'Devagar também é progresso.', 'Que tal um foco curtinho?'],
    veryLow: ['Tá puxado... Bora começar com 2 minutos?', 'Respira. Uma coisa pequena e já melhora.', 'Tô contigo. Só o primeiro passo.'],
  },
  direct: {
    high: ['Semana rendendo. Mantém.', 'Bom ritmo hoje.', 'Tudo nos trilhos.'],
    normal: ['Próxima tarefa?', 'Um foco por vez.', 'Bora.'],
    low: ['Dia lento. Escolhe uma tarefa.', 'Comece pelo menor passo.', 'Um foco curto resolve.'],
    veryLow: ['Dia difícil. 2 minutos e pronto.', 'Só o primeiro passo.', 'Uma coisa pequena agora.'],
  },
};

export function moodPhrase(mood: number, tone: Tone, seed = new Date().getHours()): string {
  const band = mood >= 80 ? 'high' : mood >= 40 ? 'normal' : mood >= 20 ? 'low' : 'veryLow';
  const list = PHRASES[tone][band];
  return list[seed % list.length];
}

// ---------- Coleta dos dados reais ----------

export function dayInputs(date: Date): DayInputs {
  const { start, end } = dayRange(date);
  // "Hoje" só vale para o dia atual; dias passados usam prazo no dia ou conclusão no dia.
  const isToday = dayRange(new Date()).start === start;
  const planned =
    db().get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tasks WHERE ${isToday ? '(is_today = 1 AND status != \'done\') OR ' : ''}(due_at >= ? AND due_at < ? AND status != 'done') OR (status = 'done' AND completed_at >= ? AND completed_at < ?)`,
      start,
      end,
      start,
      end,
    )?.n ?? 0;
  const done = db().get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?", start, end)?.n ?? 0;
  const s = db().get<{ c: number | null; a: number | null }>(
    "SELECT SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS c, SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS a FROM focus_sessions WHERE started_at >= ? AND started_at < ?",
    start,
    end,
  );
  const f = focusMinutes(start, end);
  const st = statsFor(date);
  return { plannedTasks: planned, doneTasks: done, focusCompleted: s?.c ?? 0, focusAbandoned: s?.a ?? 0, focusMin: f.focusMin, distractedMin: st.distractedMin, workedMin: st.workedMin, goalMin: st.goalMin };
}

function last7DayMoods(today: Date): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, -i);
    const { start, end } = dayRange(d);
    const r = db().get<{ mood: number }>('SELECT mood FROM mood_snapshots WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT 1', start, end);
    if (r) out.push(r.mood);
  }
  return out;
}

let current: MoodInfo | null = null;

export function computeMood(now = new Date()): MoodInfo {
  const d = dayMood(dayInputs(now));
  const week = last7DayMoods(now);
  const mood = blendMood(d.score, week);
  const components: MoodComponents = {
    adherence: d.adherence,
    focusCompletion: d.focusCompletion,
    distraction: d.distraction,
    overworkPenalty: d.overworkPenalty,
    today: d.score,
    weekAvg: week.length ? Math.round(week.reduce((a, b) => a + b, 0) / week.length) : d.score,
  };
  return { mood, components, phrase: moodPhrase(mood, getProfile()?.tone ?? 'cute') };
}

/** Recalcula, salva o snapshot do dia (último do dia vale para a média) e avisa o renderer. */
export function refreshMood(now = new Date()): MoodInfo {
  current = computeMood(now);
  const { start, end } = dayRange(now);
  const existing = db().get<{ id: number }>('SELECT id FROM mood_snapshots WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT 1', start, end);
  if (existing) db().run('UPDATE mood_snapshots SET at = ?, mood = ?, components_json = ? WHERE id = ?', now.toISOString(), current.mood, JSON.stringify(current.components), existing.id);
  else db().run('INSERT INTO mood_snapshots (at, mood, components_json) VALUES (?, ?, ?)', now.toISOString(), current.mood, JSON.stringify(current.components));
  emit('mood:changed', current);
  return current;
}

export function currentMood(): MoodInfo {
  return current ?? computeMood();
}

