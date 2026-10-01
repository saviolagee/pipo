// Dados simulados de 4 semanas (painel de debug) para validar humor, sequência e padrões.
import { db } from '../db';
import { getProfile } from '../db/repos/profile';
import { addDays } from '../time';

function at(day: Date, h: number, m = 0): string {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/**
 * Semanas 1–2: dias fracos (pouco foco, muita distração). Semanas 3–4: dias bons, batendo a meta
 * nos últimos 8 dias úteis (desbloqueia cachecol e óculos). Quartas mais distraídas. Tarefas de
 * "financeiro" adiadas toda semana.
 */
export function seedFourWeeks(now = new Date()): { days: number } {
  const p = getProfile();
  const workDays = p?.workDays ?? [1, 2, 3, 4, 5];
  const goal = p?.dailyGoalMin ?? 360;
  const d = db();
  let count = 0;
  d.tx(() => {
    d.run('DELETE FROM activity_blocks WHERE started_at < ?', at(now, 0));
    d.run('DELETE FROM focus_sessions WHERE started_at < ?', at(now, 0));
    d.run('DELETE FROM mood_snapshots WHERE at < ?', at(now, 0));
    const ins = (s: string, e: string, app: string, title: string, cat: string): void => {
      d.run('INSERT INTO activity_blocks (started_at, ended_at, app, title, url, category, client_id, idle) VALUES (?, ?, ?, ?, NULL, ?, NULL, 0)', s, e, app, title, cat);
    };
    for (let i = 28; i >= 1; i--) {
      const day = addDays(now, -i);
      if (!workDays.includes(day.getDay() as (typeof workDays)[number])) continue;
      count++;
      const good = i <= 12;
      const wednesday = day.getDay() === 3;
      // Minutos de trabalho: bons dias ~ meta, fracos ~ metade.
      const workMin = good ? goal + 10 : Math.round(goal * 0.5);
      const distractMin = wednesday ? 90 : good ? 15 : 60;
      let t = 9 * 60;
      const chunk = (min: number, app: string, title: string, cat: string): void => {
        ins(at(day, Math.floor(t / 60), t % 60), at(day, Math.floor((t + min) / 60), (t + min) % 60), app, title, cat);
        t += min;
      };
      chunk(Math.round(workMin * 0.4), 'Code', 'projeto — index.ts', 'work');
      chunk(Math.round(distractMin / 2), 'Google Chrome', 'vídeos - YouTube', 'distraction');
      chunk(Math.round(workMin * 0.3), 'Figma', 'Landing', 'work');
      chunk(Math.round(distractMin / 2), 'Google Chrome', 'Instagram', 'distraction');
      chunk(workMin - Math.round(workMin * 0.4) - Math.round(workMin * 0.3), 'Excel', 'Planilha', 'work');
      // Focos: dias bons 3 completos às 9h; fracos 1 abandonado.
      const sessions = good ? [9, 10, 14] : [16];
      for (const h of sessions) {
        d.run(
          "INSERT INTO focus_sessions (task_id, started_at, ended_at, preset_json, cycles_done, focused_sec, distracted_sec, status) VALUES (NULL, ?, ?, '{}', ?, ?, ?, ?)",
          at(day, h),
          at(day, h + 1, 40),
          good ? 4 : 1,
          good ? 6000 : 900,
          good ? 120 : 900,
          good ? 'completed' : 'abandoned',
        );
      }
    }
    // Tarefas de financeiro adiadas várias vezes.
    const now2 = now.toISOString();
    d.run("INSERT INTO tasks (title, status, snooze_count, source, is_today, position, created_at, updated_at, priority) VALUES ('Conciliar financeiro de setembro', 'todo', 4, 'manual', 0, 900, ?, ?, 2)", now2, now2);
    d.run("INSERT INTO tasks (title, status, snooze_count, source, is_today, position, created_at, updated_at, priority) VALUES ('Fechar relatório financeiro', 'todo', 3, 'manual', 0, 901, ?, ?, 2)", now2, now2);
  });
  return { days: count };
}
