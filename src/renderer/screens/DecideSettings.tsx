// Configurações → Agente (IA) → Decisões dos Pipos: os exemplos de cada atividade do passo `decide`
// e o modelo local de cada uma. O do próprio Pipo treina aqui mesmo; o Laya é para quem já o tem.
import { useEffect, useState } from 'react';
import { ACTIVITY_NAME, CHECK, type ActivityInfo, type CheckResult } from '@shared/decide';
import { Button } from '../components/Button';
import { Label, NumberField, TextField } from '../components/Form';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { useLocalModel } from '../local/embed';

const d = t.decide;
const pct = (v: number): number => Math.round(v * 100);

function errText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
}

/** Ligar o Laya numa atividade (para quem já treinou e está rodando o laya-serve). */
function LayaForm({ activity, onDone }: { activity: ActivityInfo; onDone: (r: CheckResult | null) => void }): React.JSX.Element {
  const [url, setUrl] = useState(activity.local?.url ?? 'http://127.0.0.1:8000');
  const [task, setTask] = useState(activity.local?.task ?? '');
  const [min, setMin] = useState(pct(activity.local?.minConfidence ?? 0.8));
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
      <p className="mb-[8px] text-[11px] leading-[1.45] text-fg-3">{d.howTo}</p>
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

function ActivityRow({ a, onMsg, reload }: { a: ActivityInfo; onMsg: (m: string) => void; reload: () => Promise<void> }): React.JSX.Element {
  const [laya, setLaya] = useState(false);
  const [training, setTraining] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const download = useLocalModel((s) => s.download);

  const train = async (): Promise<void> => {
    setTraining(true);
    setNote(null);
    try {
      const r = await api.invoke('decide:trainOwn', a.activity);
      setNote(r.ok ? d.ownPassed(pct(r.accuracy), pct(r.coverage), r.total) : r.error);
    } catch (e) {
      setNote(errText(e));
    }
    setTraining(false);
    await reload();
  };
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    await fn();
    if (ok) onMsg(ok);
    await reload();
  };
  const status = a.local ? d.byLocal(a.local.agreement) : a.own?.enabled ? d.byOwn(pct(a.own.accuracy), pct(a.own.coverage)) : a.own?.paused ? d.ownPaused : d.byClaude;
  const local = !!a.local || !!a.own?.enabled;

  return (
    <div className="mb-[8px] rounded-[12px] px-[12px] py-[9px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-[8px]">
        <div className="min-w-0 flex-1">
          <span className="mono block truncate text-[12.5px] text-fg">{a.activity}</span>
          <span className="block truncate text-[11px] text-fg-3">{d.examples(a.examples, a.teacher)}</span>
          <span className="block truncate text-[11px]" style={{ color: local ? 'var(--status-done)' : 'var(--text-muted)' }}>
            {status}
          </span>
        </div>
        {a.own ? (
          <Button size="sm" variant="secondary" onClick={() => void run(() => api.invoke('decide:removeOwn', a.activity), d.turnedOff)}>
            {d.turnOff}
          </Button>
        ) : (
          <Button size="sm" variant="primary" disabled={training || !a.fixedOptions} title={a.fixedOptions ? d.trainHint : d.notFixed} onClick={() => void train()}>
            {training ? d.training : d.train}
          </Button>
        )}
      </div>
      {training && <p className="mt-[6px] text-[11.5px] text-fg-2">{download !== null ? d.downloading(download) : d.trainingNote}</p>}
      {!training && (note ?? a.own?.paused) && <p className="mt-[6px] text-[11.5px] text-fg-2">{note ?? a.own?.paused}</p>}
      {!a.fixedOptions && !a.own && <p className="mt-[6px] text-[11px] text-fg-3">{d.notFixed}</p>}
      <div className="mt-[6px] flex items-center gap-[2px]">
        <Button size="sm" variant="ghost" className="!px-[6px]" onClick={() => void run(async () => onMsg(d.imported(await api.invoke('decide:import', a.activity))))}>
          {d.import}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="!px-[6px]"
          onClick={() =>
            void run(async () => {
              if (!a.teacher) return onMsg(d.nothingToExport);
              const path = await api.invoke('decide:export', a.activity);
              if (path) onMsg(d.exported(path));
            })
          }
        >
          {d.export}
        </Button>
        <span className="flex-1" />
        {a.local ? (
          <Button size="sm" variant="ghost" className="!px-[6px]" onClick={() => void run(() => api.invoke('decide:setLocal', a.activity, null), d.turnedOff)}>
            {d.layaOff}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="!px-[6px]" onClick={() => setLaya((v) => !v)}>
            {d.layaOn}
          </Button>
        )}
      </div>
      {laya && !a.local && (
        <LayaForm
          activity={a}
          onDone={() => {
            setLaya(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

export function DecideSettings({ onMsg }: { onMsg: (m: string) => void }): React.JSX.Element {
  const [list, setList] = useState<ActivityInfo[]>([]);
  const [name, setName] = useState('');
  const reload = async (): Promise<void> => setList(await api.invoke('decide:activities'));
  useEffect(() => {
    void reload();
  }, []);

  const importNew = async (): Promise<void> => {
    if (!ACTIVITY_NAME.test(name)) return onMsg(d.badName);
    onMsg(d.imported(await api.invoke('decide:import', name)));
    setName('');
    await reload();
  };

  return (
    <div className="mb-[16px]">
      <Label>{d.title}</Label>
      <p className="mb-[10px] text-[11.5px] leading-[1.45] text-fg-3">{d.intro}</p>
      {!list.length && <p className="mb-[8px] text-[12px] text-fg-2">{d.empty}</p>}
      {list.map((a) => (
        <ActivityRow key={a.activity} a={a} onMsg={onMsg} reload={reload} />
      ))}
      <div className="mt-[10px] flex items-center gap-[8px]">
        <TextField value={name} onChange={setName} onEnter={() => void importNew()} placeholder={d.newActivity} className="mono h-[28px] min-w-0 flex-1 text-[12px]" pinKey="decide-new" />
        <Button size="sm" variant="secondary" onClick={() => void importNew()}>
          {d.importNew}
        </Button>
      </div>
      <p className="mt-[6px] text-[11px] leading-[1.45] text-fg-3">{d.importHint}</p>
    </div>
  );
}
