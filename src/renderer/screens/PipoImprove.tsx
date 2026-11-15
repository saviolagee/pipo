// Seção "Aprimoramento" no detalhe de um Pipo: a sugestão pendente (com o porquê de cada mudança),
// o estudo em andamento, o último resultado e a chave "Aprimorar sozinho".
import { useEffect, useState } from 'react';
import type { PipoImprovement } from '@shared/improve';
import { Button } from '../components/Button';
import { YesNo } from '../components/Form';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';

const ti = t.team.improve;
const errText = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function lastLine(x: PipoImprovement): string {
  if (x.status === 'kept') return ti.kept(x.note);
  if (x.status === 'applied') return ti.applied(x.baseVersion + 1);
  if (x.status === 'rejected') return ti.rejected;
  if (x.status === 'failed') return ti.failed(x.note);
  return '';
}

export function ImproveSection({ pipoId, color }: { pipoId: number; color: string }): React.JSX.Element {
  const [d, setD] = useState<{ list: PipoImprovement[]; auto: boolean; busy: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const load = (): void => void api.invoke('pipos:improvements', pipoId).then(setD);
  useEffect(() => {
    load();
    return api.on('pipos:improvement', (e) => e.pipoId === pipoId && load());
  }, [pipoId]);

  const last = d?.list[0] ?? null;
  const working = last?.status === 'working';
  const pending = d?.list.find((x) => x.status === 'pending') ?? null;
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setErr(null);
    setActing(true);
    try {
      await fn();
      load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="mb-[12px]">
      <div className="mb-[5px] flex items-center justify-between">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-fg-3">{ti.title}</h3>
        {d && (
          <span className="flex items-center gap-[6px] text-[11px] text-fg-3" title={ti.autoHint}>
            {ti.auto}
            <YesNo value={d.auto} onChange={(on) => void run(() => api.invoke('pipos:setAutoImprove', pipoId, on))} />
          </span>
        )}
      </div>
      {pending ? (
        <div className="rounded-[10px] px-[10px] py-[8px]" style={{ background: 'var(--bg-card-hover)', boxShadow: `inset 2px 0 0 ${color}` }}>
          <div className="mb-[4px] text-[12px] font-medium text-fg">{ti.suggested(pending.changes.length)}</div>
          <div className="flex flex-col gap-[5px]">
            {pending.changes.map((c, i) => (
              <div key={i} className="text-[11.5px] leading-[1.4]">
                <div className="text-fg">• {c.mudanca}</div>
                <div className="pl-[10px] text-fg-3" title={c.evidencia}>
                  {c.porque}
                </div>
              </div>
            ))}
            {pending.rules.map((r, i) => (
              <div key={`r${i}`} className="text-[11.5px] text-fg-2">
                {ti.newRule}: {r}
              </div>
            ))}
          </div>
          <div className="mt-[8px] flex justify-end gap-[6px]">
            <Button size="sm" variant="tertiary" disabled={acting} onClick={() => void run(() => api.invoke('pipos:decideImprovement', pending.id, 'reject'))}>
              {ti.reject}
            </Button>
            <Button size="sm" variant="primary" disabled={acting} onClick={() => void run(() => api.invoke('pipos:decideImprovement', pending.id, 'apply'))}>
              {ti.apply}
            </Button>
          </div>
        </div>
      ) : working ? (
        <p className="text-[12px] text-fg-2">
          <span className="mr-[6px] inline-block h-[6px] w-[6px] animate-pulse rounded-full align-middle" style={{ background: color }} />
          {ti.working}
        </p>
      ) : (
        <>
          <p className="text-[11.5px] leading-[1.45] text-fg-3">{last ? lastLine(last) : ti.intro}</p>
          <div className="mt-[6px]">
            <Button size="sm" disabled={acting || !!d?.busy} onClick={() => void run(() => api.invoke('pipos:improve', pipoId))}>
              {ti.now}
            </Button>
          </div>
        </>
      )}
      {err && <p className="mt-[4px] text-[11px] text-attention">{err}</p>}
    </section>
  );
}
