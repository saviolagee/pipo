import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import type { DayReview as Review, TimeReportRow } from '@shared/types';
import { Button } from '../components/Button';
import { t } from '../i18n/pt-BR';
import { api, fmtHM, fmtTime } from '../lib/api';
import { Mascot } from '../mascot/Mascot';
import { useData } from '../store/data';
import { useUi } from '../store/ui';

const r = t.review;

function Bars({ rows, total }: { rows: TimeReportRow[]; total: number }): React.JSX.Element {
  if (!rows.length) return <p className="text-[12px] text-fg-3">{r.empty}</p>;
  return (
    <div className="flex flex-col gap-[6px]">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-[8px] text-[12px]">
          <span className="w-[110px] shrink-0 truncate text-fg-2">{row.label}</span>
          <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div className="h-full rounded-full" style={{ background: row.color ?? '#fff' }} initial={{ width: 0 }} animate={{ width: `${Math.max(3, (row.minutes / Math.max(1, total)) * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          </div>
          <span className="mono w-[48px] shrink-0 text-right text-fg">{fmtHM(row.minutes)}</span>
        </div>
      ))}
    </div>
  );
}

/** Revisão / fechamento do dia (seções 9.5 e 9.10). */
export function DayReview(): React.JSX.Element {
  const [data, setData] = useState<Review | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const clients = useData((s) => s.clients);
  const claudeOk = useData((s) => s.claude.state === 'ok');

  const load = useCallback(async () => setData(await api.invoke('stats:dayReview')), []);
  useEffect(() => {
    void load();
    return api.on('stats:changed', () => void load());
  }, [load]);

  if (!data) return <div className="h-[372px]" />;
  const { stats } = data;
  const maxClient = Math.max(...data.byClient.map((x) => x.minutes), 1);
  const maxApp = Math.max(...data.byApp.map((x) => x.minutes), 1);

  const exportCsv = async (): Promise<void> => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const p = await api.invoke('activity:exportCsv', from, new Date().toISOString());
    if (p) setMsg(p);
  };

  const reschedule = async (): Promise<void> => {
    for (const task of data.pending) await api.invoke('tasks:snooze', task.id);
    setMsg(r.rescheduled(data.pending.length));
    void load();
  };

  return (
    <div className="flex h-[372px] gap-[10px] px-[10px] pb-[10px]">
      <div className="flex w-[200px] shrink-0 flex-col items-center justify-center rounded-[16px] p-[12px] text-center" style={{ background: 'var(--bg-card)' }}>
        <Mascot state={data.goalReached ? 'celebrating' : 'sleepy'} size={62} />
        <div className="mono mt-[10px] text-[22px] font-semibold">{fmtHM(stats.workedMin)}</div>
        <div className="text-[12px] text-fg-2">{r.ofGoal(fmtHM(stats.goalMin))}</div>
        <div className="mt-[10px] flex flex-col gap-[2px] text-[11.5px] text-fg-3">
          <span>{r.focusSessions(stats.focusSessionsCompleted)}</span>
          <span>{r.distracted(fmtHM(stats.distractedMin))}</span>
          <span>{r.meetings(fmtHM(stats.meetingMin))}</span>
        </div>
        <div className="mt-[12px] flex flex-col gap-[6px]">
          <Button size="sm" onClick={() => void exportCsv()}>
            {r.exportCsv}
          </Button>
          {claudeOk && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                void api.invoke('agent:send', { conversationId: null, text: 'Fecha o meu dia: resumo curto, horas vs meta, o que ficou pendente e sugestão de cliente para os blocos sem cliente.' });
                useUi.getState().setTab('chat');
              }}
            >
              {r.closeWithPipo}
            </Button>
          )}
        </div>
        {msg && <p className="mt-[6px] max-w-full truncate text-[11px] text-fg-2">{msg}</p>}
      </div>
      <div className="scroll-thin flex min-w-0 flex-1 flex-col gap-[14px] overflow-y-auto rounded-[16px] p-[14px]" style={{ background: 'var(--bg-card)' }}>
        <section>
          <h3 className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{r.byClient}</h3>
          <Bars rows={data.byClient} total={maxClient} />
        </section>
        <section>
          <h3 className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{r.byApp}</h3>
          <Bars rows={data.byApp} total={maxApp} />
        </section>
        {data.unclassified.length > 0 && clients.length > 0 && (
          <section>
            <h3 className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{r.unclassified}</h3>
            {data.unclassified.slice(0, 8).map((b) => (
              <div key={b.id} className="flex items-center gap-[8px] py-[2px] text-[12px]">
                <span className="mono w-[42px] text-fg-3">{fmtTime(b.startedAt)}</span>
                <span className="min-w-0 flex-1 truncate text-fg-2">
                  {b.app} · {b.title}
                </span>
                <select
                  aria-label={r.assignClient}
                  className="rounded-[6px] bg-[var(--bg-input)] px-[6px] py-[2px] text-[12px] outline-none"
                  defaultValue=""
                  onChange={async (e) => {
                    await api.invoke('activity:classify', [{ blockId: b.id, clientId: e.target.value ? Number(e.target.value) : null }]);
                    void load();
                  }}
                >
                  <option value="">{r.noClient}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </section>
        )}
        <section>
          <div className="mb-[8px] flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.04em] text-fg-3">{r.pending(data.pending.length)}</h3>
            {data.pending.length > 0 && (
              <Button size="sm" variant="tertiary" onClick={() => void reschedule()}>
                {r.reschedule}
              </Button>
            )}
          </div>
          {data.pending.map((task) => (
            <div key={task.id} className="truncate py-[2px] text-[12px] text-fg-2">
              • {task.title}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
