// Configurações → Modelo → Decisões dos Pipos: os exemplos de cada atividade do passo `decide` e o
// modelo local (Laya) de cada uma, que só liga com o ajuste fino dela e depois de conferido.
import { useEffect, useState } from 'react';
import { CHECK, type ActivityInfo, type CheckResult } from '@shared/decide';
import { Button } from '../components/Button';
import { Label, NumberField, TextField } from '../components/Form';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';

const d = t.decide;

function errText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
}

function LocalForm({ activity, onDone }: { activity: ActivityInfo; onDone: (r: CheckResult | null) => void }): React.JSX.Element {
  const [url, setUrl] = useState(activity.local?.url ?? 'http://127.0.0.1:8000');
  const [task, setTask] = useState(activity.local?.task ?? '');
  const [min, setMin] = useState(Math.round((activity.local?.minConfidence ?? 0.8) * 100));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const check = async (): Promise<void> => {
    setBusy(true);
    setResult(d.checking);
    try {
      const r = await api.invoke('decide:setLocal', activity.activity, { url, task: task || undefined, minConfidence: min / 100 });
      setResult(!r ? null : r.error ? r.error : r.ok ? d.passed(r.agree, r.total, r.avgMs) : d.failed(r.agree, r.total, CHECK.minRate));
      if (r?.ok) onDone(r);
    } catch (e) {
      setResult(errText(e));
    }
    setBusy(false);
  };

  return (
    <div className="mt-[8px] rounded-[12px] p-[10px]" style={{ background: 'var(--bg-card-hover)' }}>
      <div className="flex items-end gap-[8px]">
        <div className="min-w-0 flex-1">
          <Label>{d.url}</Label>
          <TextField value={url} onChange={setUrl} className="mono w-full text-[12px]" pinKey="decide-url" />
        </div>
        <div className="w-[150px]">
          <Label>{d.task}</Label>
          <TextField value={task} onChange={setTask} className="mono w-full text-[12px]" pinKey="decide-task" ariaLabel={`${d.task}: ${d.taskHint}`} />
        </div>
      </div>
      <div className="mt-[8px] flex items-center gap-[10px]">
        <span className="text-[12px] text-fg-2" title={d.minConfidenceHint}>
          {d.minConfidence}
        </span>
        <NumberField value={min} onChange={setMin} min={50} max={99} suffix="%" ariaLabel={d.minConfidence} />
        <span className="flex-1" />
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void check()}>
          {d.check}
        </Button>
      </div>
      {result && <p className="mt-[8px] text-[11.5px] text-fg-2">{result}</p>}
    </div>
  );
}

export function DecideSettings({ onMsg }: { onMsg: (m: string) => void }): React.JSX.Element {
  const [list, setList] = useState<ActivityInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const reload = async (): Promise<void> => setList(await api.invoke('decide:activities'));
  useEffect(() => {
    void reload();
  }, []);

  const exportExamples = async (a: ActivityInfo): Promise<void> => {
    if (!a.teacher) return onMsg(d.nothingToExport);
    const path = await api.invoke('decide:export', a.activity);
    if (path) onMsg(d.exported(path));
  };
  const turnOff = async (a: ActivityInfo): Promise<void> => {
    await api.invoke('decide:setLocal', a.activity, null);
    onMsg(d.turnedOff);
    await reload();
  };

  return (
    <div className="mb-[16px]">
      <Label>{d.title}</Label>
      <p className="mb-[10px] text-[11.5px] leading-[1.45] text-fg-3">{d.intro}</p>
      {!list.length && <p className="text-[12px] text-fg-2">{d.empty}</p>}
      {list.map((a) => (
        <div key={a.activity} className="mb-[8px] rounded-[12px] px-[12px] py-[9px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-[10px]">
            <div className="min-w-0 flex-1">
              <span className="mono block truncate text-[12.5px] text-fg">{a.activity}</span>
              <span className="block text-[11px] text-fg-3">
                {d.examples(a.examples, a.teacher)} · <span style={a.local ? { color: 'var(--status-done)' } : undefined}>{a.local ? d.byLocal(a.local.agreement) : d.byClaude}</span>
              </span>
            </div>
            <Button size="sm" variant="tertiary" onClick={() => void exportExamples(a)}>
              {d.export}
            </Button>
            {a.local ? (
              <Button size="sm" variant="secondary" onClick={() => void turnOff(a)}>
                {d.turnOff}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setOpen(open === a.activity ? null : a.activity)}>
                {d.turnOn}
              </Button>
            )}
          </div>
          {open === a.activity && !a.local && (
            <LocalForm
              activity={a}
              onDone={() => {
                setOpen(null);
                void reload();
              }}
            />
          )}
        </div>
      ))}
      {list.length > 0 && <p className="mt-[6px] text-[11px] leading-[1.45] text-fg-3">{d.howTo}</p>}
    </div>
  );
}
