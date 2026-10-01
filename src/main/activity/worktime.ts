// Horas trabalhadas = sessões de foco ∪ blocos de trabalho/cliente − distrações − ociosidade − pausas (seção 9.2).
// Usa baldes de 10s num intervalo para evitar contar o mesmo tempo duas vezes.
import type { ActivityCategory } from '@shared/types';

const BUCKET_MS = 10_000;

export interface Interval {
  start: number;
  end: number;
}

export interface BlockLike extends Interval {
  category: ActivityCategory;
  idle: boolean;
}

export interface WorkTime {
  workedMin: number;
  distractedMin: number;
  meetingMin: number;
}

export function computeWorkTime(range: Interval, blocks: BlockLike[], focus: Interval[], focusBreaks: Interval[] = []): WorkTime {
  const n = Math.max(0, Math.ceil((range.end - range.start) / BUCKET_MS));
  const worked = new Uint8Array(n);
  const removed = new Uint8Array(n);
  const meeting = new Uint8Array(n);
  const distracted = new Uint8Array(n);

  const mark = (arr: Uint8Array, iv: Interval): void => {
    const s = Math.max(0, Math.floor((Math.max(iv.start, range.start) - range.start) / BUCKET_MS));
    const e = Math.min(n, Math.ceil((Math.min(iv.end, range.end) - range.start) / BUCKET_MS));
    for (let i = s; i < e; i++) arr[i] = 1;
  };

  for (const b of blocks) {
    if (b.idle || b.category === 'idle') mark(removed, b);
    else if (b.category === 'distraction') {
      mark(removed, b);
      mark(distracted, b);
    } else if (b.category === 'meeting') mark(meeting, b);
    else mark(worked, b);
  }
  for (const f of focus) mark(worked, f);
  for (const p of focusBreaks) mark(removed, p);

  let w = 0;
  let d = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (worked[i] && !removed[i] && !meeting[i]) w++;
    if (distracted[i]) d++;
    if (meeting[i]) m++;
  }
  const toMin = (x: number): number => (x * BUCKET_MS) / 60_000;
  return { workedMin: toMin(w), distractedMin: toMin(d), meetingMin: toMin(m) };
}
