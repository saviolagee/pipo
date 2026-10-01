// Escolha da próxima tarefa (Começar foco / destravar): prioridade × prazo × energia do horário × estimativa.
import type { EnergyPeak, Task } from './types';

export function inEnergyPeak(peak: EnergyPeak, now: Date): boolean {
  const h = now.getHours();
  if (peak === 'morning') return h >= 7 && h < 12;
  if (peak === 'afternoon') return h >= 13 && h < 18;
  if (peak === 'evening') return h >= 18 && h < 23;
  return true;
}

export function scoreTask(t: Task, now: Date, peak: EnergyPeak, preferShort = false): number {
  let s = t.priority * 10;
  if (t.isToday) s += 15;
  if (t.dueAt) {
    const hours = (Date.parse(t.dueAt) - now.getTime()) / 3_600_000;
    if (hours < 0) s += 30;
    else if (hours < 3) s += 25;
    else if (hours < 24) s += 12;
    else if (hours < 72) s += 5;
  }
  const est = t.estimateMin ?? 30;
  const peakNow = inEnergyPeak(peak, now);
  // No pico: favorece tarefas difíceis (alta prioridade e longas). Fora dele: tarefas curtas.
  if (peakNow && !preferShort) s += Math.min(10, est / 9) + (t.priority === 3 ? 5 : 0);
  else s += Math.max(0, 10 - est / 6);
  if (preferShort) s += est <= 15 ? 10 : 0;
  // Ordem manual da lista de Hoje como desempate leve.
  s -= t.position * 0.01;
  return s;
}

export function pickNextTask(tasks: Task[], now: Date, peak: EnergyPeak, preferShort = false): Task | null {
  const open = tasks.filter((t) => t.status !== 'done');
  if (!open.length) return null;
  const today = open.filter((t) => t.isToday || (t.dueAt && Date.parse(t.dueAt) < new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()));
  const pool = today.length ? today : open;
  return [...pool].sort((a, b) => scoreTask(b, now, peak, preferShort) - scoreTask(a, now, peak, preferShort))[0] ?? null;
}
